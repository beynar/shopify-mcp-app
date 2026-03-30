import { ApiVersion, AppDistribution, shopifyApp } from "@shopify/shopify-app-react-router/server";
import { getShopifyConfig } from "./env.server";
import sessionStorage from "./session-storage.server";

const apiVersion = ApiVersion.April26;

let shopifyCache:
  | {
      cacheKey: string;
      app: ReturnType<typeof shopifyApp>;
    }
  | undefined;

function createShopifyApp() {
  const config = getShopifyConfig();

  return shopifyApp({
    apiKey: config.apiKey,
    apiSecretKey: config.apiSecretKey,
    apiVersion,
    scopes: config.scopes,
    appUrl: config.appUrl,
    authPathPrefix: "/auth",
    sessionStorage,
    distribution: AppDistribution.AppStore,
    future: {
      expiringOfflineAccessTokens: true,
    },
    ...(config.customShopDomain ? { customShopDomains: [config.customShopDomain] } : {}),
  });
}

export function getShopify() {
  const config = getShopifyConfig();
  const cacheKey = JSON.stringify(config);

  if (!shopifyCache || shopifyCache.cacheKey !== cacheKey) {
    shopifyCache = {
      cacheKey,
      app: createShopifyApp(),
    };
  }

  return shopifyCache.app;
}

export default getShopify;
export { apiVersion };

export const addDocumentResponseHeaders = (
  ...args: Parameters<ReturnType<typeof getShopify>["addDocumentResponseHeaders"]>
) => getShopify().addDocumentResponseHeaders(...args);

export const authenticate = {
  admin: ((...args: any[]) => (getShopify().authenticate.admin as any).apply(null, args)) as any,
  flow: ((...args: any[]) => (getShopify().authenticate.flow as any).apply(null, args)) as any,
  fulfillmentService: ((...args: any[]) =>
    (getShopify().authenticate.fulfillmentService as any).apply(null, args)) as any,
  pos: ((...args: any[]) => (getShopify().authenticate.pos as any).apply(null, args)) as any,
  public: ((...args: any[]) => (getShopify().authenticate.public as any).apply(null, args)) as any,
  webhook: ((...args: any[]) =>
    (getShopify().authenticate.webhook as any).apply(null, args)) as any,
} satisfies ReturnType<typeof getShopify>["authenticate"];

export const unauthenticated = {
  admin: ((...args: any[]) => (getShopify().unauthenticated.admin as any).apply(null, args)) as any,
  storefront: ((...args: any[]) =>
    (getShopify().unauthenticated.storefront as any).apply(null, args)) as any,
} satisfies ReturnType<typeof getShopify>["unauthenticated"];

export const login = (...args: Parameters<ReturnType<typeof getShopify>["login"]>) =>
  getShopify().login(...args);

export const registerWebhooks = (
  ...args: Parameters<ReturnType<typeof getShopify>["registerWebhooks"]>
) => getShopify().registerWebhooks(...args);

export { sessionStorage };
