import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCodeExecutor, createSearchExecutor } from '../executor'

describe('Shopify executor', () => {
  let mockEnv: Env
  let mockCtx: ExecutionContext & {
    exports: {
      GlobalOutbound: ReturnType<typeof vi.fn>
    }
  }
  let mockEntrypoint: { evaluate: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    mockEntrypoint = {
      evaluate: vi.fn().mockResolvedValue({ result: {}, err: undefined })
    }

    mockEnv = {
      SHOPIFY_SHOP_DOMAIN: 'example.myshopify.com',
      SHOPIFY_ADMIN_API_VERSION: '2026-04',
      SHOPIFY_ADMIN_ACCESS_TOKEN: 'shpat_test',
      LOADER: {
        get: vi.fn((_id: string, factory: () => unknown) => {
          factory()
          return {
            getEntrypoint: () => mockEntrypoint
          }
        })
      }
    } as unknown as Env

    mockCtx = {
      exports: {
        GlobalOutbound: vi.fn(() => ({ fetch: vi.fn() }))
      }
    } as unknown as typeof mockCtx
  })

  it('injects the Shopify helper into worker code', async () => {
    const executor = createCodeExecutor(mockEnv, mockCtx)
    await executor('async () => ({ ok: true })')

    const loader = mockEnv.LOADER.get as unknown as ReturnType<typeof vi.fn>
    const workerConfig = loader.mock.calls[0][1]()
    const workerCode = workerConfig.modules['worker.js']

    expect(workerCode).toContain('const shopify = {')
    expect(workerCode).toContain('async graphql(options)')
    expect(workerCode).toContain('https://example.myshopify.com/admin/api/2026-04/graphql.json')
  })

  it('wires the local GlobalOutbound entrypoint into the worker loader', async () => {
    const outboundBinding = { fetch: vi.fn() }
    mockCtx.exports.GlobalOutbound.mockReturnValue(outboundBinding)

    const executor = createCodeExecutor(mockEnv, mockCtx)
    await executor('async () => ({ ok: true })')

    const loader = mockEnv.LOADER.get as unknown as ReturnType<typeof vi.fn>
    const workerConfig = loader.mock.calls[0][1]()
    expect(mockCtx.exports.GlobalOutbound).toHaveBeenCalledWith({})
    expect(workerConfig.globalOutbound).toBe(outboundBinding)
  })
})

describe('Search executor', () => {
  it('embeds the catalog and hydrates docs', async () => {
    const mockEnv = {
      ASSETS: {
        fetch: vi.fn(async (request: Request) => {
          const path = new URL(request.url).pathname.replace(/^\/+/, '')
          const files: Record<string, string> = {
            'generated/catalog.json': JSON.stringify({
              domains: {
                products: {
                  name: 'products',
                  description: 'Products',
                  queries: 1,
                  mutations: 0,
                  docPath: 'shopify-graphql/references/products.md'
                }
              },
              queries: {
                product: {
                  kind: 'query',
                  name: 'product',
                  description: 'Load product',
                  docPath: 'shopify-graphql/queries/product.md',
                  returnType: 'Product'
                }
              },
              mutations: {},
              types: {
                objects: {
                  Product: {
                    kind: 'type',
                    name: 'Product',
                    description: 'A product',
                    docPath: 'shopify-graphql/types/objects/Product.md',
                    typeGroup: 'objects',
                    typeKind: 'OBJECT'
                  }
                },
                inputs: {},
                enums: {},
                interfaces: {},
                unions: {}
              }
            }),
            'generated/search-records.json': JSON.stringify([]),
            'shopifyql/catalog.json': JSON.stringify({
              overview: {
                queryField: 'shopifyqlQuery',
                requiredScope: 'read_reports',
                responseShape: ['tableData.rows', 'parseErrors'],
                notes: []
              },
              datasets: {},
              topics: []
            }),
            'generated/orama-runtime.js':
              'export async function createCatalogRuntime() { return { search() { return [{ kind: "query", name: "product", description: "Load product", docPath: "shopify-graphql/queries/product.md", score: 10 }] }, hydrate(target) { return { __searchOp: "hydrate", target } }, get(docPath) { return { __searchOp: "get", docPath } }, shopifyql: { overview: { queryField: "shopifyqlQuery", requiredScope: "read_reports", responseShape: [], notes: [] }, datasets: {}, search() { return [] } } } }',
            'shopify-graphql/queries/product.md': '# Query: `product`'
          }

          const content = files[path]
          if (!content) {
            return new Response('Not Found', { status: 404 })
          }
          return new Response(content, { status: 200 })
        })
      },
      LOADER: {
        get: vi.fn((_id: string, factory: () => unknown) => {
          const config = factory()
          return {
            getEntrypoint: () => ({
              evaluate: async () => ({
                result: { name: 'product', docPath: 'shopify-graphql/queries/product.md' },
                err: undefined
              }),
              config
            })
          }
        })
      }
    } as unknown as Env

    const executor = createSearchExecutor(mockEnv)
    const result = (await executor('async () => catalog.search("product")')) as Array<{
      name: string
      docPath: string
    }>

    expect(result[0].name).toBe('product')
    expect(result[0].docPath).toBe('shopify-graphql/queries/product.md')

    const workerCode = (
      (mockEnv.LOADER.get as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1]() as {
        modules: Record<string, string>
      }
    ).modules['worker.js']
    expect(workerCode).toContain('from "./orama-runtime.js"')
  })

  it('hydrates selected results on demand', async () => {
    const mockEnv = {
      ASSETS: {
        fetch: vi.fn(async (request: Request) => {
          const path = new URL(request.url).pathname.replace(/^\/+/, '')
          const files: Record<string, string> = {
            'generated/catalog.json': JSON.stringify({ domains: {}, queries: {}, mutations: {}, types: { objects: {}, inputs: {}, enums: {}, interfaces: {}, unions: {} } }),
            'generated/search-records.json': JSON.stringify([]),
            'shopifyql/catalog.json': JSON.stringify({
              overview: {
                queryField: 'shopifyqlQuery',
                requiredScope: 'read_reports',
                responseShape: ['tableData.rows', 'parseErrors'],
                notes: []
              },
              datasets: {},
              topics: []
            }),
            'generated/orama-runtime.js':
              'export async function createCatalogRuntime() { return { search() { return [] }, hydrate(target, options) { return { __searchOp: "hydrate", target, options } }, get(docPath) { return { __searchOp: "get", docPath } }, shopifyql: { overview: { queryField: "shopifyqlQuery", requiredScope: "read_reports", responseShape: [], notes: [] }, datasets: {}, search() { return [] } } } }',
            'shopify-graphql/mutations/productCreate.md': '# Mutation: `productCreate`\\n\\n## Related Types\\n\\n- [ProductCreateInput](../types/inputs/ProductCreateInput.md)\\n- [ProductCreatePayload](../types/objects/ProductCreatePayload.md)',
            'shopify-graphql/types/inputs/ProductCreateInput.md': '# Input Object: `ProductCreateInput`',
            'shopify-graphql/types/objects/ProductCreatePayload.md': '# Object: `ProductCreatePayload`'
          }

          return new Response(files[path] ?? 'Not Found', { status: files[path] ? 200 : 404 })
        })
      },
      LOADER: {
        get: vi.fn((_id: string, factory: () => unknown) => {
          factory()
          return {
            getEntrypoint: () => ({
              evaluate: async () => ({
                result: {
                  __searchOp: 'hydrate',
                  target: {
                    kind: 'mutation',
                    name: 'productCreate',
                    docPath: 'shopify-graphql/mutations/productCreate.md'
                  }
                },
                err: undefined
              })
            })
          }
        })
      }
    } as unknown as Env

    const executor = createSearchExecutor(mockEnv)
    const result = (await executor('async () => catalog.hydrate({ kind: "mutation", name: "productCreate", docPath: "shopify-graphql/mutations/productCreate.md" })')) as {
      result: { docPath: string }
      documents: Array<{ path: string; relatedDocuments: Array<{ path: string }> }>
    }

    expect(result.documents[0].path).toBe('shopify-graphql/mutations/productCreate.md')
    expect(result.documents[0].relatedDocuments.map((doc) => doc.path)).toEqual([
      'shopify-graphql/types/inputs/ProductCreateInput.md',
      'shopify-graphql/types/objects/ProductCreatePayload.md'
    ])
  })

  it('resolves nested search instructions inside returned objects', async () => {
    const mockEnv = {
      ASSETS: {
        fetch: vi.fn(async (request: Request) => {
          const path = new URL(request.url).pathname.replace(/^\/+/, '')
          const files: Record<string, string> = {
            'generated/catalog.json': JSON.stringify({ domains: {}, queries: {}, mutations: {}, types: { objects: {}, inputs: {}, enums: {}, interfaces: {}, unions: {} } }),
            'generated/search-records.json': JSON.stringify([]),
            'shopifyql/catalog.json': JSON.stringify({
              overview: {
                queryField: 'shopifyqlQuery',
                requiredScope: 'read_reports',
                responseShape: ['tableData.rows', 'parseErrors'],
                notes: []
              },
              datasets: {},
              topics: []
            }),
            'generated/orama-runtime.js':
              'export async function createCatalogRuntime() { return { search() { return [] }, hydrate(target, options) { return { __searchOp: "hydrate", target, options } }, get(docPath) { return { __searchOp: "get", docPath } }, shopifyql: { overview: { queryField: "shopifyqlQuery", requiredScope: "read_reports", responseShape: [], notes: [] }, datasets: {}, search() { return [] } } } }',
            'shopify-graphql/queries/product.md': '# Query: `product`',
            'shopify-graphql/mutations/productCreate.md': '# Mutation: `productCreate`\\n\\n## Related Types\\n\\n- [ProductCreateInput](../types/inputs/ProductCreateInput.md)',
            'shopify-graphql/types/inputs/ProductCreateInput.md': '# Input Object: `ProductCreateInput`'
          }

          return new Response(files[path] ?? 'Not Found', { status: files[path] ? 200 : 404 })
        })
      },
      LOADER: {
        get: vi.fn((_id: string, factory: () => unknown) => {
          factory()
          return {
            getEntrypoint: () => ({
              evaluate: async () => ({
                result: {
                  docs: {
                    single: {
                      __searchOp: 'get',
                      docPath: 'shopify-graphql/queries/product.md'
                    },
                    hydrated: {
                      __searchOp: 'hydrate',
                      target: {
                        kind: 'mutation',
                        name: 'productCreate',
                        docPath: 'shopify-graphql/mutations/productCreate.md'
                      }
                    }
                  }
                },
                err: undefined
              })
            })
          }
        })
      }
    } as unknown as Env

    const executor = createSearchExecutor(mockEnv)
    const result = (await executor('async () => ({ docs: { single: catalog.get("shopify-graphql/queries/product.md"), hydrated: catalog.hydrate({ kind: "mutation", name: "productCreate", docPath: "shopify-graphql/mutations/productCreate.md" }) } })')) as {
      docs: {
        single: { docPath: string; content: string }
        hydrated: { documents: Array<{ path: string; relatedDocuments: Array<{ path: string }> }> }
      }
    }

    expect(result.docs.single.docPath).toBe('shopify-graphql/queries/product.md')
    expect(result.docs.single.content).toContain('# Query: `product`')
    expect(result.docs.hydrated.documents[0].path).toBe('shopify-graphql/mutations/productCreate.md')
    expect(result.docs.hydrated.documents[0].relatedDocuments[0].path).toBe(
      'shopify-graphql/types/inputs/ProductCreateInput.md'
    )
  })
})
