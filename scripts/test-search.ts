import { readFile } from "node:fs/promises";
import path from "node:path";

import { resetAssetCache } from "../shopify-mcp/src/asset-loader";
import { hydrateSearchResult, resetCatalogCache } from "../shopify-mcp/src/search-catalog";
import {
  buildSearchAssets,
  searchCatalogWithOrama,
  type CatalogEntry,
  type CatalogSearchResult,
  type SearchIndexManifests,
} from "../shopify-mcp/src/search-index";
import type { AssetEnv } from "../shopify-mcp/src/runtime";

type SearchCase = {
  label: string;
  term: string;
  expectedPath: string;
  maxRank: number;
  requiredSnippets: string[];
};

const repoRoot = process.cwd();
const assetsRoot = path.join(repoRoot, "shopify-mcp/assets");
const skillRoot = path.join(assetsRoot, "shopify-graphql");
const searchCasesPath = path.join(repoRoot, "scripts/fixtures/search-cases.json");
const CURRENT_API_VERSION = "2026-04";
const PROJECT_OWNED_VERSION_FILES = [
  path.join(repoRoot, "shopify-mcp/assets/shopify-graphql/queries/shopifyqlQuery.md"),
  path.join(repoRoot, "shopify-mcp/assets/shopifyql/catalog.json"),
  path.join(repoRoot, "shopify-mcp/package.json"),
] as const;
const STALE_CURRENT_VERSION_MARKERS = ["2025-10", "2026-01"] as const;

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function loadManifests(): Promise<SearchIndexManifests> {
  return {
    domains: await readJsonFile(path.join(skillRoot, "references/_domains.json")),
    queries: await readJsonFile(path.join(skillRoot, "queries/_index.json")),
    mutations: await readJsonFile(path.join(skillRoot, "mutations/_index.json")),
    objects: await readJsonFile(path.join(skillRoot, "types/objects/_index.json")),
    inputs: await readJsonFile(path.join(skillRoot, "types/inputs/_index.json")),
    enums: await readJsonFile(path.join(skillRoot, "types/enums/_index.json")),
    interfaces: await readJsonFile(path.join(skillRoot, "types/interfaces/_index.json")),
    unions: await readJsonFile(path.join(skillRoot, "types/unions/_index.json")),
  };
}

async function loadSearchCases(): Promise<SearchCase[]> {
  return readJsonFile<SearchCase[]>(searchCasesPath);
}

async function assertCurrentVersionMessaging(): Promise<void> {
  for (const filePath of PROJECT_OWNED_VERSION_FILES) {
    const content = await readFile(filePath, "utf8");

    if (!content.includes(CURRENT_API_VERSION)) {
      throw new Error(`Version check failed: ${filePath} does not mention ${CURRENT_API_VERSION}`);
    }

    for (const marker of STALE_CURRENT_VERSION_MARKERS) {
      if (content.includes(marker)) {
        throw new Error(`Version check failed: ${filePath} still contains stale current-version marker ${marker}`);
      }
    }
  }
}

function createFilesystemAssetEnv(rootDir: string): AssetEnv {
  return {
    ASSETS: {
      async fetch(request: Request | string | URL) {
        const url = new URL(
          typeof request === "string" ? request : request instanceof URL ? request.href : request.url,
        );
        const filePath = path.join(rootDir, url.pathname.replace(/^\/+/, ""));

        try {
          const content = await readFile(filePath, "utf8");
          return new Response(content, { status: 200 });
        } catch {
          return new Response("Not Found", { status: 404 });
        }
      },
    } as Fetcher,
    LOADER: {} as WorkerLoader,
  };
}

function formatHit(hit: CatalogSearchResult): string {
  return `${hit.score.toFixed(2).padStart(8)}  ${hit.kind.padEnd(8)}  ${hit.docPath}`;
}

function summarizeDocument(content: string): string {
  const firstHeading = content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "Untitled";
  const firstParagraph = content
    .replace(/^#.*$/m, "")
    .split("\n\n")
    .map((block) => block.trim())
    .find(Boolean);

  return `${firstHeading}${firstParagraph ? ` — ${firstParagraph.slice(0, 120)}` : ""}`;
}

async function runCase(
  env: AssetEnv,
  catalog: Awaited<ReturnType<typeof buildSearchAssets>>["catalog"],
  snapshot: Awaited<ReturnType<typeof buildSearchAssets>>["oramaSnapshot"],
  testCase: SearchCase,
): Promise<{ ok: true; rank: number } | { ok: false; error: string }> {
  const hits = await searchCatalogWithOrama(catalog, snapshot, testCase.term, {
    kind: "query",
    limit: 5,
  });

  if (hits.length === 0) {
    return { ok: false, error: `No search hits for "${testCase.term}"` };
  }

  const rank = hits.findIndex((hit) => hit.docPath === testCase.expectedPath);
  if (rank === -1 || rank + 1 > testCase.maxRank) {
    return {
      ok: false,
      error: [
        `Unexpected ranking for "${testCase.term}"`,
        `Expected within top ${testCase.maxRank}: ${testCase.expectedPath}`,
        `Received rank: ${rank === -1 ? "not in top 5" : rank + 1}`,
        "Top hits:",
        ...hits.map((hit) => `  ${formatHit(hit)}`),
      ].join("\n"),
    };
  }

  const matchedHit = hits[rank];
  const hydration = await hydrateSearchResult(env, matchedHit as CatalogEntry);
  const primaryDocument = hydration.documents[0];
  if (!primaryDocument) {
    return {
      ok: false,
      error: `Search hit "${matchedHit.docPath}" did not hydrate any documents`,
    };
  }

  for (const snippet of testCase.requiredSnippets) {
    if (!primaryDocument.content.includes(snippet)) {
      return {
        ok: false,
        error: `Hydrated document "${primaryDocument.path}" is missing required snippet "${snippet}"`,
      };
    }
  }

  console.log(`\n[PASS] ${testCase.label}`);
  console.log(`term: ${testCase.term}`);
  console.log(`rank: ${rank + 1}`);
  console.log(`hit:  ${matchedHit.docPath}`);
  console.log(`doc:  ${summarizeDocument(primaryDocument.content)}`);
  console.log("hits:");
  for (const hit of hits) {
    console.log(`  ${formatHit(hit)}`);
  }

  return { ok: true, rank: rank + 1 };
}

async function main(): Promise<void> {
  resetAssetCache();
  resetCatalogCache();

  const searchCases = await loadSearchCases();
  await assertCurrentVersionMessaging();
  const manifests = await loadManifests();
  const assets = await buildSearchAssets(manifests, async (docPath) => {
    const filePath = path.join(assetsRoot, docPath);
    return readFile(filePath, "utf8");
  });
  const env = createFilesystemAssetEnv(assetsRoot);

  console.log(`Built ${assets.searchRecords.length} search records from local assets.`);
  const failures: string[] = [];
  let exactTopPasses = 0;

  for (const testCase of searchCases) {
    const result = await runCase(env, assets.catalog, assets.oramaSnapshot, testCase);
    if (!result.ok) {
      failures.push(`[FAIL] ${testCase.label}\n${result.error}`);
      continue;
    }

    if (result.rank === 1) {
      exactTopPasses += 1;
    }
  }

  if (failures.length > 0) {
    console.error(`\n${failures.join("\n\n")}`);
    console.error(`\n${failures.length} of ${searchCases.length} search cases failed.`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nAll ${searchCases.length} search cases passed.`);
  console.log(`${exactTopPasses}/${searchCases.length} cases returned the expected document at rank 1.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
