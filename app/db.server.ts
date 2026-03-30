import {
  drizzle as drizzleProxy,
  type AsyncBatchRemoteCallback,
  type AsyncRemoteCallback,
} from "drizzle-orm/sqlite-proxy";
import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import { getCloudflareD1Config, getRuntimeEnv, type RuntimeEnv } from "./env.server";
import {
  LOCAL_D1_BINDING_NAME,
  LOCAL_D1_PERSIST_ROOT,
  resolveLocalD1DatabaseId,
} from "./db/local-config";
import * as schema from "./db/schema";

type D1QueryBody =
  | { sql: string; params?: unknown[] }
  | { batch: { sql: string; params?: unknown[] }[] };

type D1RawResult = {
  success: boolean;
  results?: {
    columns?: string[];
    rows?: unknown[][];
  };
  meta?: Record<string, unknown>;
};

type D1QueryResult = {
  success: boolean;
  results?: Record<string, unknown>[];
  meta?: Record<string, unknown>;
};

type D1ApiResponse<T> = {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: Array<{ code: number; message: string }>;
  result: T[];
};

export type D1HttpCredentials = {
  accountId: string;
  databaseId: string;
  token: string;
};

export type DbStrategy = "binding" | "http";

function normalizeSql(sql: string) {
  return sql.trim().replace(/;+\s*$/u, "");
}

async function executeD1Request<T>(
  credentials: D1HttpCredentials,
  endpoint: "query" | "raw",
  body: D1QueryBody,
): Promise<T[]> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}/d1/database/${credentials.databaseId}/${endpoint}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${credentials.token}`,
      },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    throw new Error(`D1 HTTP request failed with status ${response.status}`);
  }

  const data = (await response.json()) as D1ApiResponse<T>;
  if (!data.success || data.errors.length > 0) {
    throw new Error(data.errors.map((error) => error.message).join(", "));
  }

  return data.result;
}

export function createD1HttpClient(credentials: D1HttpCredentials) {
  return {
    async raw(sql: string, params: unknown[] = []) {
      const [result] = await executeD1Request<D1RawResult>(credentials, "raw", {
        sql: normalizeSql(sql),
        params,
      });

      return result ?? { success: true, results: { rows: [] } };
    },
    async query(sql: string, params: unknown[] = []) {
      const [result] = await executeD1Request<D1QueryResult>(credentials, "query", {
        sql: normalizeSql(sql),
        params,
      });

      return result ?? { success: true, results: [] };
    },
    async rawBatch(statements: { sql: string; params: unknown[] }[]) {
      return executeD1Request<D1RawResult>(credentials, "raw", {
        batch: statements.map(({ sql, params }) => ({
          sql: normalizeSql(sql),
          params,
        })),
      });
    },
  };
}

export function createBindingDb(binding: D1Database) {
  return drizzleD1(binding, { schema });
}

export async function runSql(sql: string, params: unknown[] = [], env = getRuntimeEnv()) {
  if (env.DB) {
    await env.DB.prepare(normalizeSql(sql)).bind(...params).run();
    return;
  }

  const client = createD1HttpClient({
    accountId: env.CLOUDFLARE_ACCOUNT_ID ?? getCloudflareD1Config().accountId,
    databaseId: env.CLOUDFLARE_DATABASE_ID ?? getCloudflareD1Config().databaseId,
    token: env.CLOUDFLARE_D1_TOKEN ?? getCloudflareD1Config().token,
  });
  await client.query(sql, params);
}

export async function allSql<T>(
  sql: string,
  params: unknown[] = [],
  env = getRuntimeEnv(),
): Promise<T[]> {
  if (env.DB) {
    const result = await env.DB.prepare(normalizeSql(sql)).bind(...params).all<T>();
    return result.results;
  }

  const client = createD1HttpClient({
    accountId: env.CLOUDFLARE_ACCOUNT_ID ?? getCloudflareD1Config().accountId,
    databaseId: env.CLOUDFLARE_DATABASE_ID ?? getCloudflareD1Config().databaseId,
    token: env.CLOUDFLARE_D1_TOKEN ?? getCloudflareD1Config().token,
  });
  const result = await client.query(sql, params);
  return (result.results ?? []) as T[];
}

function coerceSqlParam(value: unknown) {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  return value;
}

export function createHttpDb(credentials = getCloudflareD1Config()) {
  const client = createD1HttpClient(credentials);

  const callback: AsyncRemoteCallback = async (sql, params, method) => {
    if (method === "run") {
      await client.query(sql, params.map(coerceSqlParam));
      return { rows: [] };
    }

    const result = await client.raw(sql, params.map(coerceSqlParam));
    const rows = result.results?.rows ?? [];

    if (method === "get") {
      return { rows: rows[0] ?? [] };
    }

    return { rows };
  };

  const batchCallback: AsyncBatchRemoteCallback = async (statements) => {
    const results = await client.rawBatch(
      statements.map(({ sql, params }) => ({
        sql,
        params: params.map(coerceSqlParam),
      })),
    );

    return results.map((result, index) => {
      const rows = result.results?.rows ?? [];
      return statements[index]?.method === "get" ? { rows: rows[0] ?? [] } : { rows };
    });
  };

  return drizzleProxy(callback, batchCallback, { schema });
}

function shouldUseBinding(env: RuntimeEnv) {
  return Boolean(env.DB) || (env.NODE_ENV !== "production" && Boolean(env.CLOUDFLARE_DATABASE_ID));
}

export function resolveDbStrategy(env = getRuntimeEnv()): DbStrategy {
  return shouldUseBinding(env) ? "binding" : "http";
}

let localBindingPromise: Promise<D1Database> | undefined;

async function getLocalDevelopmentBinding(databaseId: string) {
  if (!localBindingPromise) {
    localBindingPromise = (async () => {
      const [{ Miniflare }, path] = await Promise.all([import("miniflare"), import("node:path")]);

      const miniflare = new Miniflare({
        modules: true,
        script: "",
        d1Persist: path.join(path.resolve(process.cwd(), LOCAL_D1_PERSIST_ROOT), "v3", "d1"),
        d1Databases: {
          [LOCAL_D1_BINDING_NAME]: resolveLocalD1DatabaseId(databaseId),
        },
      });

      return miniflare.getD1Database(LOCAL_D1_BINDING_NAME);
    })();
  }

  return localBindingPromise;
}

export type AppDb = ReturnType<typeof createBindingDb> | ReturnType<typeof createHttpDb>;
export type AppSchema = typeof schema;

export async function resolveDb(env = getRuntimeEnv()): Promise<AppDb> {
  if (resolveDbStrategy(env) === "binding") {
    if (env.DB) {
      return createBindingDb(env.DB);
    }

    return createBindingDb(
      await getLocalDevelopmentBinding(resolveLocalD1DatabaseId(env.CLOUDFLARE_DATABASE_ID)),
    );
  }

  const config = getCloudflareD1Config();
  return createHttpDb({
    accountId: env.CLOUDFLARE_ACCOUNT_ID ?? config.accountId,
    databaseId: env.CLOUDFLARE_DATABASE_ID ?? config.databaseId,
    token: env.CLOUDFLARE_D1_TOKEN ?? config.token,
  });
}

let dbCache:
  | {
      key: string;
      db: Promise<AppDb>;
    }
  | undefined;

export function getDb(env = getRuntimeEnv()) {
  const key = JSON.stringify({
    strategy: resolveDbStrategy(env),
    nodeEnv: env.NODE_ENV,
    databaseId: env.CLOUDFLARE_DATABASE_ID,
    hasBinding: Boolean(env.DB),
  });

  if (!dbCache || dbCache.key !== key) {
    dbCache = {
      key,
      db: resolveDb(env),
    };
  }

  return dbCache.db;
}

export function resetDbCache() {
  dbCache = undefined;
  localBindingPromise = undefined;
}

export { schema };
