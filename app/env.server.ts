export type RuntimeEnv = {
  NODE_ENV?: string;
  SHOPIFY_API_KEY?: string;
  SHOPIFY_API_SECRET?: string;
  SHOPIFY_APP_URL?: string;
  MCP_SECRET_ENCRYPTION_KEY?: string;
  SCOPES?: string;
  SHOP_CUSTOM_DOMAIN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_DATABASE_ID?: string;
  CLOUDFLARE_D1_TOKEN?: string;
  CLOUDFLARE_API_TOKEN?: string;
  DB?: D1Database;
};

declare global {
  var __appRuntimeEnv: RuntimeEnv | undefined;
}

const ENV_KEYS = [
  "NODE_ENV",
  "SHOPIFY_API_KEY",
  "SHOPIFY_API_SECRET",
  "SHOPIFY_APP_URL",
  "MCP_SECRET_ENCRYPTION_KEY",
  "SCOPES",
  "SHOP_CUSTOM_DOMAIN",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_DATABASE_ID",
  "CLOUDFLARE_D1_TOKEN",
  "CLOUDFLARE_API_TOKEN",
] as const;

type EnvKey = (typeof ENV_KEYS)[number];

function getEnvStore(): RuntimeEnv {
  if (!globalThis.__appRuntimeEnv) {
    globalThis.__appRuntimeEnv = {};
  }

  return globalThis.__appRuntimeEnv;
}

export function setRuntimeEnv(env: Record<string, unknown>) {
  const nextValues = Object.fromEntries(
    ENV_KEYS.flatMap((key) => {
      const value = env[key];
      return typeof value === "string" && value.length > 0 ? [[key, value]] : [];
    }),
  ) as Record<EnvKey, string | undefined>;

  Object.assign(getEnvStore(), nextValues);

  if (isD1Database(env.DB)) {
    getEnvStore().DB = env.DB;
  }

  if (typeof process !== "undefined") {
    for (const [key, value] of Object.entries(nextValues)) {
      process.env[key as EnvKey] = value;
    }
  }
}

export function getRuntimeEnv(): RuntimeEnv {
  const store = getEnvStore();
  const resolved: RuntimeEnv = { ...store };
  const resolvedStrings = resolved as Record<EnvKey, string | undefined>;

  if (typeof process !== "undefined") {
    for (const key of ENV_KEYS) {
      if (!resolvedStrings[key] && process.env[key]) {
        resolvedStrings[key] = process.env[key];
      }
    }
  }

  return resolved;
}

function isD1Database(value: unknown): value is D1Database {
  return typeof value === "object" && value !== null && "prepare" in value;
}

export function requireEnv<K extends EnvKey>(key: K): string {
  const env = getRuntimeEnv();
  const value = env[key];

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

export function getShopifyConfig() {
  return {
    apiKey: requireEnv("SHOPIFY_API_KEY"),
    apiSecretKey: requireEnv("SHOPIFY_API_SECRET"),
    appUrl: requireEnv("SHOPIFY_APP_URL"),
    scopes: requireEnv("SCOPES")
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean),
    customShopDomain: getRuntimeEnv().SHOP_CUSTOM_DOMAIN,
  };
}

export function getCloudflareD1Config() {
  return {
    accountId: requireEnv("CLOUDFLARE_ACCOUNT_ID"),
    databaseId: requireEnv("CLOUDFLARE_DATABASE_ID"),
    token: requireEnv("CLOUDFLARE_D1_TOKEN"),
  };
}
