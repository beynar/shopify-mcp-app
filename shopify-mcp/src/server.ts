import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { createCodeExecutor, createSearchExecutor } from './executor'
import type { AssetEnv, ShopifyAdminCredentials } from './runtime'

type WorkerExecutionContext = ExecutionContext<unknown>

const SHOPIFY_TYPES = `
interface ShopifyGraphQLOptions {
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
}

interface ShopifyGraphQLError {
  message: string;
  path?: Array<string | number>;
  extensions?: Record<string, unknown>;
}

interface ShopifyGraphQLResponse<T = unknown> {
  success: boolean;
  status: number;
  data?: T;
  errors: ShopifyGraphQLError[];
  extensions?: Record<string, unknown>;
}

declare const shopify: {
  graphql<T = unknown>(options: ShopifyGraphQLOptions): Promise<ShopifyGraphQLResponse<T>>;
};
`

const SEARCH_TYPES = `
interface DomainEntry {
  name: string;
  description: string;
  queries: number;
  mutations: number;
  docPath: string;
}

interface CatalogEntry {
  kind: "query" | "mutation" | "type" | "domain";
  name: string;
  description: string;
  docPath: string;
  returnType?: string;
  typeGroup?: "objects" | "inputs" | "enums" | "interfaces" | "unions";
  typeKind?: string;
  domain?: string;
}

interface CatalogSearchResult extends CatalogEntry {
  score: number;
}

interface SearchHydrateOptions {
  includePrimaryDocs?: boolean;
  includeRelatedDocs?: boolean;
  maxPrimaryDocs?: number;
  maxRelatedDocs?: number;
  relatedDepth?: number;
}

interface ShopifyqlOverview {
  queryField: string;
  requiredScope: string;
  responseShape: string[];
  notes: string[];
}

interface ShopifyqlDataset {
  description: string;
  metrics: string[];
  dimensions: string[];
}

interface ShopifyqlSearchResult {
  id: string;
  title: string;
  description: string;
  category: string;
  keywords: string[];
  score: number;
  content?: string;
}

declare const catalog: {
  domains: Record<string, DomainEntry>;
  queries: Record<string, CatalogEntry>;
  mutations: Record<string, CatalogEntry>;
  types: {
    objects: Record<string, CatalogEntry>;
    inputs: Record<string, CatalogEntry>;
    enums: Record<string, CatalogEntry>;
    interfaces: Record<string, CatalogEntry>;
    unions: Record<string, CatalogEntry>;
  };
  search(term: string, options?: { kind?: CatalogEntry["kind"]; strictKind?: boolean; limit?: number }): CatalogSearchResult[];
  hydrate(
    target: CatalogSearchResult | string | Array<CatalogSearchResult | string>,
    options?: SearchHydrateOptions
  ): unknown;
  get(docPath: string): unknown;
  shopifyql: {
    overview: ShopifyqlOverview;
    datasets: Record<string, ShopifyqlDataset>;
    search(term: string, options?: { limit?: number }): ShopifyqlSearchResult[];
  };
};
`

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function createServer(
  env: AssetEnv,
  ctx: WorkerExecutionContext & { exports?: Record<string, (options?: { props?: unknown }) => unknown> },
  credentials: ShopifyAdminCredentials
): Promise<McpServer> {
  const server = new McpServer({
    name: 'shopify-admin-graphql',
    version: '0.1.0'
  })

  const executeCode = createCodeExecutor(env, ctx, credentials)
  const executeSearch = createSearchExecutor(env)

  server.registerTool(
    'search',
    {
      description: `Search the Shopify Admin GraphQL skill corpus bundled as Worker assets.

Use compact search first, then hydrate only the hit you actually need. For Shopify analytics syntax, use catalog.shopifyql instead of forcing everything through GraphQL docs.

Search strategy:
- Search exact Shopify names when you know them, for example: productCreate, pageCreate, menuCreate, themes, shop.
- If you do not know the exact name, search short intent phrases such as: create product, blog post, theme template, customer account, menu navigation.
- If naming is uncertain, do multi-search yourself by trying several nearby terms and comparing results, for example: blog post, article, articleCreate.
- Prefer searching operations first, then hydrate the selected hit.
- Use kind as a preference. Add strictKind: true only if you truly want hard filtering.

Useful Shopify term mappings:
- blog post -> article
- web page -> page
- navigation or menu -> menu
- theme file or template -> theme, themes, themeUpdate, themeFilesUpsert
- legal policy -> shopPolicy, shopPolicies
- customer account -> customer, customerAccounts

Available in your code:
${SEARCH_TYPES}

Examples:

// Find an operation by name
async () => {
  return catalog.search('productCreate', { limit: 3 })
}

// Action intent naturally boosts mutations
async () => {
  return catalog.search('create discount code', { limit: 5 })
}

// Hydrate only the selected mutation with input and payload docs
async () => {
  const hits = catalog.search('blog post', { limit: 3 })
  return catalog.hydrate(hits[0])
}

// Read one markdown doc directly by path
async () => {
  return catalog.get('shopify-graphql/queries/product.md')
}

// ShopifyQL analytics discovery
async () => {
  return {
    datasets: Object.keys(catalog.shopifyql.datasets),
    matches: catalog.shopifyql.search('matches products purchased', { limit: 3 })
  }
}

// ShopifyQL response shape reminder:
// parseErrors is a scalar string array, not an object with subfields.
// Correct selection shape:
// shopifyqlQuery(query: $q) { parseErrors tableData { columns { name dataType displayName } rows } }
}`,
      inputSchema: {
        code: z
          .string()
          .describe('JavaScript async arrow function to search the Shopify skill catalog')
      }
    },
    async ({ code }) => {
      try {
        const result = await executeSearch(code)
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        }
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${formatError(error)}` }],
          isError: true
        }
      }
    }
  )

  server.registerTool(
    'execute',
    {
      description: `Execute JavaScript against the Shopify Admin GraphQL API. First use the 'search' tool to discover the right operations and related types, then call the API with the injected shopify helper.

Configured target:
- Shop: ${credentials.shopDomain}
- API version: ${credentials.apiVersion}

Available in your code:
${SHOPIFY_TYPES}

Your code must be an async arrow function that returns the result.

Example query:
async () => {
  return shopify.graphql({
    query: \`query Products($first: Int!) {
      products(first: $first) {
        nodes {
          id
          title
        }
      }
    }\`,
    variables: { first: 5 }
  })
}

Example mutation:
async () => {
  return shopify.graphql({
    query: \`mutation ProductCreate($product: ProductCreateInput) {
      productCreate(product: $product) {
        product {
          id
          title
        }
        userErrors {
          field
          message
        }
      }
    }\`,
    variables: {
      product: { title: "New product" }
    }
  })
}

Example ShopifyQL query:
async () => {
  return shopify.graphql({
    query: "query ShopifyQL($q: String!) { shopifyqlQuery(query: $q) { parseErrors tableData { columns { name dataType displayName } rows } } }",
    variables: {
      q: "FROM sales SHOW total_sales, orders GROUP BY day SINCE -7d UNTIL today ORDER BY day ASC"
    }
  })
}

Runtime Constraints:
- No template literals. Backtick-quoted strings (\`...\`) cause "Invalid or unexpected token" errors. Use double-quoted strings only.
- Use GraphQL variables for any query containing inner quotes or special characters. Do NOT try to embed ShopifyQL queries, search filters like created_at:>2026-04-01, or other quoted substrings directly inside a GraphQL query string. Instead, declare a variable in the query signature (for example $q: String!) and pass the value through the variables object.
- Pagination pattern. For cursor-based pagination, declare $cursor: String (nullable) in the query signature and pass it via variables. On the first call, omit the cursor variable or pass null. Do not concatenate cursor values into the query string.
- String concatenation inside query strings breaks silently. Never build GraphQL queries via "... " + variable + " ...". Always use GraphQL variables.
- When generating code or templates that include multiline user-facing copy, do not write literal \\n sequences into the final text. Prefer arrays of lines joined with "\\n", for example ["Line 1", "Line 2"].join("\\n"). Second choice: use a template literal in the generated output only if the target language/file supports it. The tool code you send here must still use double-quoted strings.

Example pagination:
async () => {
  var allItems = [];
  var cursor = null;
  var hasNext = true;
  while (hasNext) {
    var vars = { q: "created_at:>2026-02-24" };
    if (cursor) vars.cursor = cursor;
    var res = await shopify.graphql({
      query: "query Orders($q: String, $cursor: String) { orders(first: 50, query: $q, after: $cursor) { edges { cursor node { id name } } pageInfo { hasNextPage } } }",
      variables: vars
    });
    var edges = res.data.orders.edges;
    edges.forEach(function(e) { allItems.push(e.node); });
    hasNext = res.data.orders.pageInfo.hasNextPage;
    if (edges.length > 0) cursor = edges[edges.length - 1].cursor;
  }
  return allItems;
}`,
      inputSchema: {
        code: z.string().describe('JavaScript async arrow function to execute')
      }
    },
    async ({ code }) => {
      try {
        const result = await executeCode(code)
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${formatError(error)}` }],
          isError: true
        }
      }
    }
  )

  return server
}
