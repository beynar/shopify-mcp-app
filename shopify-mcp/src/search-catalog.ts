import { readJsonAsset, readTextAsset, resolveAssetPath } from './asset-loader'
import { GENERATED_CATALOG_ASSET_PATH, type SearchCatalog } from './search-index'
import type { AssetEnv } from './runtime'

const SKILL_ROOT = 'shopify-graphql'
const DEFAULT_PRIMARY_DOCS = 1
const DEFAULT_MUTATION_PRIMARY_DOCS = 3
const MAX_PRIMARY_DOCS = 5
const DEFAULT_RELATED_DOCS = 4
const MAX_RELATED_DOCS = 8
const DEFAULT_RELATED_DEPTH = 1
const MAX_RELATED_DEPTH = 1

function getDocBasename(docPath: string): string {
  const lastSegment = docPath.split('/').pop() ?? docPath
  return lastSegment.replace(/\.md$/, '')
}

function isShopCentricRoot(rootDocPath: string): boolean {
  const basename = getDocBasename(rootDocPath).toLowerCase()
  return basename === 'shop' || basename.startsWith('shop')
}

function shouldExpandRelatedPath(path: string, rootDocPath: string): boolean {
  if (path !== 'shopify-graphql/types/objects/Shop.md') {
    return true
  }

  return isShopCentricRoot(rootDocPath)
}

export interface HydratedDocument {
  path: string
  content: string
  relatedDocuments: Array<{ path: string; content: string }>
}

export interface HydrateSearchOptions {
  includePrimaryDocs?: boolean
  includeRelatedDocs?: boolean
  maxPrimaryDocs?: number
  maxRelatedDocs?: number
  relatedDepth?: number
}

type SearchTarget =
  | string
  | {
      docPath?: string
      path?: string
      file?: string
      kind?: string
    }

function clampCount(value: number | undefined, fallback: number, max: number): number {
  return Math.max(0, Math.min(Number(value ?? fallback), max))
}

function shouldIncludeRelatedDocs(kind: string | undefined, options: HydrateSearchOptions): boolean {
  if (options.includeRelatedDocs !== undefined) {
    return options.includeRelatedDocs
  }

  return kind === 'mutation'
}

function resolvePrimaryDocLimit(kind: string | undefined, options: HydrateSearchOptions): number {
  const fallback = kind === 'mutation' ? DEFAULT_MUTATION_PRIMARY_DOCS : DEFAULT_PRIMARY_DOCS
  return clampCount(options.maxPrimaryDocs, fallback, MAX_PRIMARY_DOCS)
}

let catalogPromise: Promise<SearchCatalog> | undefined

export async function loadCatalog(env: AssetEnv): Promise<SearchCatalog> {
  if (!catalogPromise) {
    catalogPromise = readJsonAsset<SearchCatalog>(env, GENERATED_CATALOG_ASSET_PATH)
  }

  return catalogPromise
}

function getRelatedTypePaths(
  content: string,
  docPath: string,
  rootDocPath = docPath,
  limit = MAX_RELATED_DOCS
): string[] {
  const relatedSectionMatch = content.match(/## Related Types\s+([\s\S]*?)(?:\n## |\n```|$)/)
  if (!relatedSectionMatch) {
    return []
  }

  const section = relatedSectionMatch[1]
  const matches = [...section.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
  const paths = matches
    .map((match) => resolveAssetPath(docPath, match[1]))
    .filter((path) => path.startsWith(`${SKILL_ROOT}/types/`))
    .filter((path) => shouldExpandRelatedPath(path, rootDocPath))

  return [...new Set(paths)].slice(0, limit)
}

function rankRelatedPath(path: string): number {
  if (path.includes('/types/inputs/')) return 0
  if (path.includes('/types/enums/')) return 1
  if (path.includes('/types/interfaces/')) return 2
  if (path.includes('/types/unions/')) return 3
  if (path.includes('/types/objects/') && path.endsWith('Payload.md')) return 4
  if (path.includes('/types/objects/')) return 5
  return 6
}

async function collectRelatedDocuments(
  env: AssetEnv,
  initialPaths: string[],
  rootDocPath: string,
  limit = DEFAULT_RELATED_DOCS,
  maxDepth = DEFAULT_RELATED_DEPTH
): Promise<Array<{ path: string; content: string }>> {
  const queue = initialPaths
    .slice()
    .sort(
      (left, right) => rankRelatedPath(left) - rankRelatedPath(right) || left.localeCompare(right)
    )
    .map((path) => ({ path, depth: 1 }))
  const seen = new Set<string>()
  const relatedDocuments: Array<{ path: string; content: string }> = []

  while (queue.length > 0 && relatedDocuments.length < limit) {
    const current = queue.shift()
    if (!current || seen.has(current.path)) {
      continue
    }

    seen.add(current.path)
    let content: string
    try {
      content = await readTextAsset(env, current.path)
    } catch {
      continue
    }
    relatedDocuments.push({ path: current.path, content })

    if (current.depth >= maxDepth || relatedDocuments.length >= limit) {
      continue
    }

    const nestedPaths = getRelatedTypePaths(content, current.path, rootDocPath, limit)
      .filter((path) => !seen.has(path))
      .sort(
        (left, right) => rankRelatedPath(left) - rankRelatedPath(right) || left.localeCompare(right)
      )

    for (const path of nestedPaths) {
      queue.push({ path, depth: current.depth + 1 })
    }
  }

  return relatedDocuments
}

function collectDocPaths(value: unknown, docPaths = new Set<string>()): Set<string> {
  if (!value) {
    return docPaths
  }

  if (typeof value === 'string') {
    if (value.endsWith('.md') && value.startsWith(`${SKILL_ROOT}/`)) {
      docPaths.add(value)
    }
    return docPaths
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectDocPaths(item, docPaths)
    }
    return docPaths
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const docPath = record.docPath ?? record.path ?? record.file
    if (
      typeof docPath === 'string' &&
      docPath.endsWith('.md') &&
      docPath.startsWith(`${SKILL_ROOT}/`)
    ) {
      docPaths.add(docPath)
    }

    for (const nested of Object.values(record)) {
      collectDocPaths(nested, docPaths)
    }
  }

  return docPaths
}

function normalizeTarget(target: SearchTarget): { docPath: string; kind?: string } | undefined {
  if (typeof target === 'string') {
    if (target.endsWith('.md') && target.startsWith(`${SKILL_ROOT}/`)) {
      return { docPath: target }
    }
    return undefined
  }

  const docPath = target.docPath ?? target.path ?? target.file
  if (typeof docPath !== 'string' || !docPath.endsWith('.md') || !docPath.startsWith(`${SKILL_ROOT}/`)) {
    return undefined
  }

  return { docPath, kind: target.kind }
}

function collectTargets(target: unknown): Array<{ docPath: string; kind?: string }> {
  if (Array.isArray(target)) {
    const seen = new Set<string>()
    const targets: Array<{ docPath: string; kind?: string }> = []
    for (const item of target) {
      const normalized = normalizeTarget(item as SearchTarget)
      if (!normalized || seen.has(normalized.docPath)) {
        continue
      }
      seen.add(normalized.docPath)
      targets.push(normalized)
    }
    return targets
  }

  const normalized = normalizeTarget(target as SearchTarget)
  return normalized ? [normalized] : []
}

export async function getSearchDocument(env: AssetEnv, docPath: string): Promise<string> {
  return readTextAsset(env, docPath)
}

export async function hydrateSearchResult(
  env: AssetEnv,
  result: unknown,
  options: HydrateSearchOptions = {}
): Promise<{
  result: unknown
  documents: HydratedDocument[]
}> {
  const primaryPaths = [...collectDocPaths(result)].slice(
    0,
    clampCount(options.maxPrimaryDocs, DEFAULT_PRIMARY_DOCS, MAX_PRIMARY_DOCS)
  )

  const documents = await Promise.all(
    primaryPaths.map(async (path) => {
      const content = await readTextAsset(env, path)
      const relatedPaths = getRelatedTypePaths(
        content,
        path,
        path,
        clampCount(options.maxRelatedDocs, DEFAULT_RELATED_DOCS, MAX_RELATED_DOCS)
      )
      const relatedDocuments = await collectRelatedDocuments(
        env,
        relatedPaths,
        path,
        clampCount(options.maxRelatedDocs, DEFAULT_RELATED_DOCS, MAX_RELATED_DOCS),
        clampCount(options.relatedDepth, DEFAULT_RELATED_DEPTH, MAX_RELATED_DEPTH)
      )

      return {
        path,
        content,
        relatedDocuments
      }
    })
  )

  return { result, documents }
}

export async function hydrateSearchTarget(
  env: AssetEnv,
  target: SearchTarget | SearchTarget[],
  options: HydrateSearchOptions = {}
): Promise<
  | {
      result: SearchTarget
      documents: HydratedDocument[]
    }
  | {
      results: SearchTarget[]
      documents: HydratedDocument[]
    }
> {
  const targets = collectTargets(target)
  const includePrimaryDocs = options.includePrimaryDocs ?? true
  const documents: HydratedDocument[] = []

  for (const entry of targets) {
    if (!includePrimaryDocs) {
      continue
    }

    const content = await readTextAsset(env, entry.docPath)
    const includeRelated = shouldIncludeRelatedDocs(entry.kind, options)
    const relatedDocuments = includeRelated
      ? await collectRelatedDocuments(
          env,
          getRelatedTypePaths(
            content,
            entry.docPath,
            entry.docPath,
            clampCount(options.maxRelatedDocs, DEFAULT_RELATED_DOCS, MAX_RELATED_DOCS)
          ),
          entry.docPath,
          clampCount(options.maxRelatedDocs, DEFAULT_RELATED_DOCS, MAX_RELATED_DOCS),
          clampCount(options.relatedDepth, DEFAULT_RELATED_DEPTH, MAX_RELATED_DEPTH)
        )
      : []

    documents.push({
      path: entry.docPath,
      content,
      relatedDocuments
    })

    if (documents.length >= resolvePrimaryDocLimit(entry.kind, options)) {
      break
    }
  }

  if (Array.isArray(target)) {
    return { results: target, documents }
  }

  return { result: target, documents }
}

export function resetCatalogCache(): void {
  catalogPromise = undefined
}
