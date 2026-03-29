import { create, insertMultiple, search as searchOrama } from '@orama/orama'
import type {
  CatalogEntry,
  CatalogSearchResult,
  SearchCatalog,
  SearchRecord
} from './search-index'
import type { ShopifyqlCatalog } from './search-shopifyql'

interface SearchToolRuntimeOptions {
  kind?: CatalogEntry['kind']
  strictKind?: boolean
  limit?: number
}

function collectCatalogEntries(catalog: SearchCatalog): CatalogEntry[] {
  return [
    ...Object.values(catalog.queries),
    ...Object.values(catalog.mutations),
    ...Object.values(catalog.types.objects),
    ...Object.values(catalog.types.inputs),
    ...Object.values(catalog.types.enums),
    ...Object.values(catalog.types.interfaces),
    ...Object.values(catalog.types.unions),
    ...Object.values(catalog.domains).map((domain) => ({
      kind: 'domain' as const,
      name: domain.name,
      description: domain.description,
      docPath: domain.docPath
    }))
  ]
}

const SHOPIFYQL_DOC_PATH = 'shopify-graphql/queries/shopifyqlQuery.md'
const APPLE_APPLICATION_DOC_PATH = 'shopify-graphql/types/objects/AppleApplication.md'
const MOBILE_PLATFORM_APPLICATION_DOC_PATH = 'shopify-graphql/queries/mobilePlatformApplication.md'
const MOBILE_PLATFORM_APPLICATIONS_DOC_PATH = 'shopify-graphql/queries/mobilePlatformApplications.md'
const SUBSCRIPTIONS_DOMAIN_DOC_PATH = 'shopify-graphql/references/subscriptions.md'
const DISCOUNT_CODE_BASIC_CREATE_DOC_PATH = 'shopify-graphql/mutations/discountCodeBasicCreate.md'
const SHOPIFYQL_SIGNAL_PATTERNS = [
  /\bshopifyql\b/,
  /\banalytics?\b/,
  /\breports?\b/,
  /\bsegment(?:ation)? query language\b/,
  /\bcustomer segmentation\b/,
  /\bmatches\b/,
  /\btimeseries\b/,
  /\bvisuali[sz]e\b/,
  /\bcompare to\b/,
  /\bparseerrors?\b/,
  /\btabledata\b/
]
const ACTION_INTENT_PATTERNS = [
  /\bcreate\b/,
  /\badd\b/,
  /\bupdate\b/,
  /\bedit\b/,
  /\bdelete\b/,
  /\bremove\b/,
  /\bpublish\b/,
  /\bunpublish\b/,
  /\bcancel\b/,
  /\binstall\b/,
  /\bregister\b/
]
const ALIAS_EXPANSIONS = [
  { pattern: /\bblog post\b/, expansions: ['article', 'articleCreate'] },
  { pattern: /\btags?\b/, expansions: ['tagsAdd', 'tagsRemove', 'productTags'] },
  { pattern: /\bnavigation\b/, expansions: ['menu'] },
  { pattern: /\b(?:app install|install app)\b/, expansions: ['appInstallation', 'appInstallations'] },
  { pattern: /\bcheckout flow\b/, expansions: ['abandonedCheckouts', 'draftOrder', 'order'] },
  { pattern: /\bdomains?\b/, expansions: ['Domain', 'shop'] },
  {
    pattern: /\bdiscount code\b/,
    expansions: ['discountCodeBasicCreate', 'discountCodeBxgyCreate', 'discountCodeAppCreate']
  },
  { pattern: /\btranslations?\b/, expansions: ['translationsRegister', 'translatableResources'] },
  {
    pattern: /\binventory\b/,
    expansions: ['inventoryLevel', 'inventoryItem', 'inventoryAdjustQuantities']
  },
  {
    pattern: /\bsubscription\b/,
    expansions: ['subscriptionBillingCycle', 'subscriptionBillingCycleCharge', 'appSubscription']
  },
  {
    pattern: /\bcustomer segment(?:ation)?\b/,
    expansions: ['segments', 'customerSegmentMembersQuery']
  }
]

function normalizeTerm(term: string): string {
  return String(term)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/[_/:-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function expandSearchTerm(term: string): string {
  const expansions = [term]
  for (const alias of ALIAS_EXPANSIONS) {
    if (alias.pattern.test(term)) {
      expansions.push(...alias.expansions)
    }
  }
  return normalizeTerm(expansions.join(' '))
}

function isShopifyqlSearchTerm(term: string): boolean {
  return SHOPIFYQL_SIGNAL_PATTERNS.some((pattern) => pattern.test(term))
}

function isActionIntentSearchTerm(term: string): boolean {
  return ACTION_INTENT_PATTERNS.some((pattern) => pattern.test(term))
}

function isAppleSpecificSearchTerm(term: string): boolean {
  return /\bapple\b|\bapplication\b|\bmobile\b|\bplatform\b/.test(term)
}

function isDiscountCodeCreateSearchTerm(term: string): boolean {
  return /\bcreate\b/.test(term) && /\bdiscount code\b/.test(term)
}

function isSubscriptionSearchTerm(term: string): boolean {
  return /\bsubscription\b/.test(term)
}

function createSearchDatabase() {
  return create({
    schema: {
      id: 'string',
      recordType: 'enum',
      kind: 'enum',
      typeGroup: 'string',
      name: 'string',
      domain: 'string',
      docPath: 'string',
      title: 'string',
      description: 'string',
      returnType: 'string',
      sectionName: 'string',
      text: 'string'
    }
  })
}

function compareByScore(left: CatalogSearchResult, right: CatalogSearchResult): number {
  return right.score - left.score || left.name.localeCompare(right.name)
}

function searchShopifyqlCatalog(catalog: ShopifyqlCatalog, term: string, limit = 5) {
  const normalizedTerm = normalizeTerm(term)
  if (!normalizedTerm) {
    return []
  }

  return catalog.topics
    .map((topic) => {
      const haystack = normalizeTerm(
        [topic.title, topic.description, ...topic.keywords, topic.content ?? ''].join(' ')
      )
      let score = 0
      if (haystack.includes(normalizedTerm)) {
        score += 100
      }
      for (const token of normalizedTerm.split(' ')) {
        if (token.length > 1 && haystack.includes(token)) {
          score += 8
        }
      }
      return { ...topic, score }
    })
    .filter((topic) => topic.score > 0)
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, Math.max(1, Math.min(limit, 10)))
}

export async function createCatalogRuntime(
  catalogData: SearchCatalog,
  searchRecords: SearchRecord[],
  shopifyqlCatalog: ShopifyqlCatalog
) {
  const allEntries = collectCatalogEntries(catalogData)
  const entriesByDocPath = new Map(allEntries.map((entry) => [entry.docPath, entry]))
  const searchDb = createSearchDatabase()

  await insertMultiple(searchDb, searchRecords)

  function search(term: string, options: SearchToolRuntimeOptions = {}) {
    const normalizedTerm = normalizeTerm(term)
    if (!normalizedTerm) {
      return []
    }

    const expandedTerm = expandSearchTerm(normalizedTerm)
    const shopifyqlSearch = isShopifyqlSearchTerm(normalizedTerm)
    const actionIntentSearch = isActionIntentSearchTerm(normalizedTerm)
    const appleSpecificSearch = isAppleSpecificSearchTerm(normalizedTerm)
    const discountCodeCreateSearch = isDiscountCodeCreateSearchTerm(normalizedTerm)
    const subscriptionSearch = isSubscriptionSearchTerm(normalizedTerm)
    const aggregated = new Map<string, CatalogSearchResult>()

    for (const entry of allEntries) {
      if (options.strictKind && options.kind && entry.kind !== options.kind) {
        continue
      }

      if (normalizeTerm(entry.name) === normalizedTerm) {
        aggregated.set(entry.docPath, { ...entry, score: 10_000 })
      }
    }

    const results = searchOrama(searchDb, {
      term: expandedTerm,
      properties: ['name', 'title', 'description', 'text', 'domain'],
      boost: {
        name: 8,
        title: 6,
        description: 4,
        text: 3,
        domain: 2
      },
      limit: 100
    }) as Awaited<ReturnType<typeof searchOrama>>

    for (const hit of results.hits) {
      const document = hit.document as SearchRecord
      const entry = entriesByDocPath.get(document.docPath)
      if (!entry || (options.strictKind && options.kind && entry.kind !== options.kind)) {
        continue
      }

      const exactBoost = document.recordType === 'doc' && normalizeTerm(entry.name) === normalizedTerm ? 1000 : 0
      const shopifyqlBoost = shopifyqlSearch && document.docPath === SHOPIFYQL_DOC_PATH ? 180 : 0
      const kindPreferenceBoost = options.kind && entry.kind === options.kind ? 80 : 0
      const kindPreferencePenalty =
        options.kind && entry.kind !== options.kind ? (actionIntentSearch ? 18 : 35) : 0
      const actionIntentBoost =
        actionIntentSearch && entry.kind === 'mutation'
          ? 120
          : actionIntentSearch && entry.kind === 'query'
            ? 12
            : 0
      const actionIntentPenalty =
        actionIntentSearch && (entry.kind === 'domain' || entry.kind === 'type') ? 28 : 0
      const appleNoisePenalty =
        !appleSpecificSearch && document.docPath === APPLE_APPLICATION_DOC_PATH ? 140 : 0
      const mobileApplicationNoisePenalty =
        !appleSpecificSearch &&
        (document.docPath === MOBILE_PLATFORM_APPLICATION_DOC_PATH ||
          document.docPath === MOBILE_PLATFORM_APPLICATIONS_DOC_PATH)
          ? 120
          : 0
      const discountCodeBoost =
        discountCodeCreateSearch && document.docPath === DISCOUNT_CODE_BASIC_CREATE_DOC_PATH
          ? 220
          : 0
      const subscriptionsDomainBoost =
        subscriptionSearch && document.docPath === SUBSCRIPTIONS_DOMAIN_DOC_PATH ? 120 : 0
      const nextScore =
        hit.score +
        exactBoost +
        shopifyqlBoost +
        discountCodeBoost +
        subscriptionsDomainBoost +
        kindPreferenceBoost +
        actionIntentBoost -
        kindPreferencePenalty -
        appleNoisePenalty -
        mobileApplicationNoisePenalty -
        actionIntentPenalty
      const current = aggregated.get(document.docPath)

      if (!current || nextScore > current.score) {
        aggregated.set(document.docPath, { ...entry, score: nextScore })
      }
    }

    const limit = Math.max(1, Math.min(Number(options.limit ?? 10), 25))
    return [...aggregated.values()].sort(compareByScore).slice(0, limit)
  }

  return {
    ...catalogData,
    search,
    hydrate(target: unknown, options: unknown = {}) {
      return { __searchOp: 'hydrate', target, options }
    },
    get(docPath: string) {
      return { __searchOp: 'get', docPath }
    },
    shopifyql: {
      overview: shopifyqlCatalog.overview,
      datasets: shopifyqlCatalog.datasets,
      search(term: string, options: { limit?: number } = {}) {
        return searchShopifyqlCatalog(shopifyqlCatalog, term, options.limit)
      }
    }
  }
}
