import { readJsonAsset } from './asset-loader'
import { normalizeSearchText } from './search-index'
import type { AssetEnv } from './runtime'

export const SHOPIFYQL_CATALOG_ASSET_PATH = 'shopifyql/catalog.json'

export interface ShopifyqlTopicEntry {
  id: string
  title: string
  description: string
  category:
    | 'dataset'
    | 'keyword-order'
    | 'time-filter'
    | 'matches'
    | 'visualization'
    | 'segment'
    | 'overview'
  keywords: string[]
  content?: string
}

export interface ShopifyqlOverview {
  queryField: string
  requiredScope: string
  responseShape: string[]
  notes: string[]
}

export interface ShopifyqlCatalog {
  overview: ShopifyqlOverview
  datasets: Record<string, { description: string; metrics: string[]; dimensions: string[] }>
  topics: ShopifyqlTopicEntry[]
}

export interface ShopifyqlSearchResult extends ShopifyqlTopicEntry {
  score: number
}

function pluralizeKeyword(keyword: string): string | undefined {
  if (keyword.endsWith('s')) {
    return undefined
  }

  if (keyword.endsWith('y')) {
    return `${keyword.slice(0, -1)}ies`
  }

  return `${keyword}s`
}

function toPhraseVariants(value: string): string[] {
  const normalized = normalizeSearchText(value)
  if (!normalized) {
    return []
  }

  const variants = new Set<string>([
    normalized,
    normalized.replaceAll('_', ' ').replaceAll('-', ' ')
  ])

  for (const token of normalized.split(' ')) {
    const plural = pluralizeKeyword(token)
    if (plural) {
      variants.add(normalized.replace(token, plural))
    }
  }

  return [...variants]
}

function buildDatasetTopics(catalog: ShopifyqlCatalog): ShopifyqlTopicEntry[] {
  return Object.entries(catalog.datasets).map(([name, dataset]) => {
    const metrics = dataset.metrics.flatMap((metric) => toPhraseVariants(metric))
    const dimensions = dataset.dimensions.flatMap((dimension) => toPhraseVariants(dimension))

    return {
      id: `dataset:${name}`,
      title: `${name} dataset`,
      description: dataset.description,
      category: 'dataset',
      keywords: [
        name,
        `${name} dataset`,
        `${name} analytics`,
        `${name} metrics`,
        `${name} dimensions`,
        ...metrics,
        ...dimensions
      ],
      content: `Metrics: ${metrics.join(', ')}. Dimensions: ${dimensions.join(', ')}.`
    }
  })
}

let shopifyqlCatalogPromise: Promise<ShopifyqlCatalog> | undefined

export async function loadShopifyqlCatalog(env: AssetEnv): Promise<ShopifyqlCatalog> {
  if (!shopifyqlCatalogPromise) {
    shopifyqlCatalogPromise = readJsonAsset<ShopifyqlCatalog>(env, SHOPIFYQL_CATALOG_ASSET_PATH)
  }

  return shopifyqlCatalogPromise
}

export function searchShopifyqlCatalog(
  catalog: ShopifyqlCatalog,
  term: string,
  limit = 5
): ShopifyqlSearchResult[] {
  const normalizedTerm = normalizeSearchText(term)
  if (!normalizedTerm) {
    return []
  }

  const queryLooksConcrete =
    /\b(metric|metrics|dimension|dimensions|dataset|performance|revenue|sales|payment|payments|conversion|bounce|discount|traffic|session|customer|order)\b/.test(
      normalizedTerm
    )
  const queryLooksLikeWarningLookup =
    /\b(invalid|broken|unsupported|error|fails?|why|not valid|does not work)\b/.test(normalizedTerm)

  const results = [...buildDatasetTopics(catalog), ...catalog.topics]
    .map((topic) => {
      const haystack = normalizeSearchText(
        [topic.title, topic.description, ...topic.keywords, topic.content ?? ''].join(' ')
      )
      let score = 0

      if (haystack.includes(normalizedTerm)) {
        score += 100
      }

      for (const token of normalizedTerm.split(' ')) {
        if (token.length < 2) {
          continue
        }

        if (haystack.includes(token)) {
          score += 8
        }
      }

      if (topic.category === 'dataset') {
        score += 16

        const datasetName = normalizeSearchText(topic.title.replace(/ dataset$/, ''))
        if (normalizedTerm.includes(datasetName)) {
          score += 80
        }

        if (queryLooksConcrete) {
          score += 22
        }
      }

      const isWarningTopic =
        topic.id === 'invalid-datasets' ||
        /\bbroken\b|\binvalid\b|\bunsupported\b/.test(normalizeSearchText(topic.title))

      if (isWarningTopic && !queryLooksLikeWarningLookup) {
        score -= 32
      }

      return { ...topic, score }
    })
    .filter((topic) => topic.score > 0)
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))

  return results.slice(0, Math.max(1, Math.min(limit, 10)))
}

export function resetShopifyqlCatalogCache(): void {
  shopifyqlCatalogPromise = undefined
}
