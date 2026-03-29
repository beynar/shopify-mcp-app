import { readJsonAsset, readTextAsset } from "./asset-loader";
import { getSearchDocument, hydrateSearchTarget, loadCatalog } from "./search-catalog";
import {
  GENERATED_ORAMA_RUNTIME_ASSET_PATH,
  GENERATED_SEARCH_RECORDS_ASSET_PATH,
  type SearchRecord,
} from "./search-index";
import { SHOPIFYQL_CATALOG_ASSET_PATH, type ShopifyqlCatalog } from "./search-shopifyql";
import type { AssetEnv, ShopifyAdminCredentials } from "./runtime";

interface CodeExecutorEntrypoint {
  evaluate(): Promise<{ result: unknown; err?: string; stack?: string }>;
}

interface SearchExecutorEntrypoint {
  evaluate(): Promise<{ result: unknown; err?: string; stack?: string }>;
}

type SearchInstruction =
  | {
      __searchOp: "hydrate";
      target: unknown;
      options?: Record<string, unknown>;
    }
  | {
      __searchOp: "get";
      docPath: string;
    };

function isSearchInstruction(value: unknown): value is SearchInstruction {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    "__searchOp" in (value as Record<string, unknown>) &&
    (((value as Record<string, unknown>).__searchOp === "hydrate" &&
      "target" in (value as Record<string, unknown>)) ||
      ((value as Record<string, unknown>).__searchOp === "get" &&
        typeof (value as Record<string, unknown>).docPath === "string"))
  );
}

async function resolveSearchInstruction(
  env: AssetEnv,
  instruction: SearchInstruction
): Promise<unknown> {
  if (instruction.__searchOp === "hydrate") {
    return hydrateSearchTarget(
      env,
      instruction.target as Parameters<typeof hydrateSearchTarget>[1],
      instruction.options
    );
  }

  return {
    docPath: instruction.docPath,
    content: await getSearchDocument(env, instruction.docPath),
  };
}

async function resolveSearchResultValue(env: AssetEnv, value: unknown): Promise<unknown> {
  if (isSearchInstruction(value)) {
    return resolveSearchInstruction(env, value);
  }

  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => resolveSearchResultValue(env, item)));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const entries = await Promise.all(
    Object.entries(value).map(async ([key, nestedValue]) => [
      key,
      await resolveSearchResultValue(env, nestedValue),
    ])
  );

  return Object.fromEntries(entries);
}

function escapeForModuleSource(code: string): string {
  return code
    .replaceAll("\\", "\\\\")
    .replaceAll("`", "\\`")
    .replaceAll("${", "\\${");
}

export function createCodeExecutor(
  env: AssetEnv,
  _ctx: ExecutionContext & { exports?: Record<string, (options?: { props?: unknown }) => unknown> },
  credentials: ShopifyAdminCredentials,
) {
  const graphqlUrl = `https://${credentials.shopDomain}/admin/api/${credentials.apiVersion}/graphql.json`;
  const adminAccessToken = credentials.adminAccessToken;

  return async (code: string): Promise<unknown> => {
    const workerId = `shopify-admin-${crypto.randomUUID()}`;

    const embeddedCode = escapeForModuleSource(code);

    const worker = env.LOADER.get(workerId, () => ({
      compatibilityDate: "2026-01-12",
      mainModule: "worker.js",
      modules: {
        "worker.js": `
import { WorkerEntrypoint } from "cloudflare:workers";

const graphqlUrl = ${JSON.stringify(graphqlUrl)};
const adminAccessToken = ${JSON.stringify(adminAccessToken)};

export default class CodeExecutor extends WorkerEntrypoint {
  async evaluate() {
    function normalizeErrors(payload) {
      if (Array.isArray(payload?.errors)) {
        return payload.errors;
      }

      if (typeof payload?.errors === "string") {
        return [{ message: payload.errors }];
      }

      if (payload?.errors && typeof payload.errors === "object") {
        return [{ message: JSON.stringify(payload.errors) }];
      }

      return [];
    }

    const shopify = {
      async graphql(options) {
        const { query, variables, operationName } = options;
        const response = await fetch(graphqlUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": adminAccessToken
          },
          body: JSON.stringify({
            query,
            variables,
            operationName
          })
        });

        const text = await response.text();
        let payload;
        try {
          payload = text ? JSON.parse(text) : {};
        } catch {
          throw new Error("Shopify Admin API returned a non-JSON response: " + text);
        }

        const errors = normalizeErrors(payload);
        const hasData = payload.data !== null && payload.data !== undefined;
        const normalized = {
          success: response.ok && errors.length === 0,
          status: response.status,
          data: payload.data,
          errors,
          extensions: payload.extensions
        };

        if (!response.ok && !hasData) {
          const message = errors.map((error) => error.message).filter(Boolean).join(", ") || text || ("HTTP " + response.status);
          throw new Error("Shopify Admin API error: " + message);
        }

        if (errors.length > 0 && !hasData) {
          throw new Error("GraphQL error: " + errors.map((error) => error.message).join(", "));
        }

        if (!response.ok && hasData) {
          normalized.success = false;
        }

        return normalized;
      }
    };

    try {
      const userFn = ${embeddedCode};
      const result = await userFn();
      return { result, err: undefined };
    } catch (err) {
      return { result: undefined, err: err.message, stack: err.stack };
    }
  }
}
        `,
      },
    }));

    const entrypoint =
      worker.getEntrypoint() as unknown as CodeExecutorEntrypoint;
    const response = await entrypoint.evaluate();

    if (response.err) {
      console.error(response);
      throw new Error(response.err);
    }

    return response.result;
  };
}

export function createSearchExecutor(env: AssetEnv) {
  return async (code: string): Promise<unknown> => {
    const [catalog, searchRecords, runtimeModule, shopifyqlCatalog] = await Promise.all([
      loadCatalog(env),
      readJsonAsset<SearchRecord[]>(env, GENERATED_SEARCH_RECORDS_ASSET_PATH),
      readTextAsset(env, GENERATED_ORAMA_RUNTIME_ASSET_PATH),
      readJsonAsset<ShopifyqlCatalog>(env, SHOPIFYQL_CATALOG_ASSET_PATH),
    ]);
    const workerId = `shopify-search-${crypto.randomUUID()}`;

    const embeddedCode = escapeForModuleSource(code);

    const worker = env.LOADER.get(workerId, () => ({
      compatibilityDate: "2026-01-12",
      globalOutbound: null,
      mainModule: "worker.js",
      modules: {
        "orama-runtime.js": runtimeModule,
        "worker.js": `
import { WorkerEntrypoint } from "cloudflare:workers";
import { createCatalogRuntime } from "./orama-runtime.js";

const catalogData = ${JSON.stringify(catalog)};
const searchRecords = ${JSON.stringify(searchRecords)};
const shopifyqlCatalog = ${JSON.stringify(shopifyqlCatalog)};
const catalog = await createCatalogRuntime(catalogData, searchRecords, shopifyqlCatalog);

export default class SearchExecutor extends WorkerEntrypoint {
  async evaluate() {
    try {
      const userFn = ${embeddedCode};
      const result = await userFn();
      return { result, err: undefined };
    } catch (err) {
      return { result: undefined, err: err.message, stack: err.stack };
    }
  }
}
        `,
      },
    }));

    const entrypoint =
      worker.getEntrypoint() as unknown as SearchExecutorEntrypoint;
    const response = await entrypoint.evaluate();

    if (response.err) {
      throw new Error(response.err);
    }

    return resolveSearchResultValue(env, response.result);
  };
}
