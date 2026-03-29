import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Miniflare } from "miniflare";
import { LOCAL_D1_BINDING_NAME } from "./db/local-config";
import { __mcpSchema, ensureMcpConnectionSchema } from "./mcp-schema.server";

async function createBinding() {
  const miniflare = new Miniflare({
    modules: true,
    script: "",
    d1Persist: path.join(
      os.tmpdir(),
      "mcp-shopify-app-schema-tests",
      `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ),
    d1Databases: {
      [LOCAL_D1_BINDING_NAME]: `schema-test-${Date.now()}`,
    },
  });

  const binding = await miniflare.getD1Database(LOCAL_D1_BINDING_NAME);
  return { binding, miniflare };
}

test("ensureMcpConnectionSchema rebuilds McpConnection with unique shop and deduplicates rows", async () => {
  const { binding, miniflare } = await createBinding();
  const previousEnv = globalThis.__appRuntimeEnv;
  __mcpSchema.reset();

  try {
    await binding
      .prepare(
        `create table McpConnection (
          key text primary key not null,
          shop text not null,
          sessionId text not null,
          createdAt integer not null,
          updatedAt integer not null
        )`,
      )
      .run();

    await binding
      .prepare(
        `insert into McpConnection (key, shop, sessionId, createdAt, updatedAt)
         values
         ('old-key', 'shop-a.myshopify.com', 'session-a-1', 1000, 1000),
         ('new-key', 'shop-a.myshopify.com', 'session-a-2', 2000, 3000),
         ('shop-b-key', 'shop-b.myshopify.com', 'session-b', 1500, 1500)`,
      )
      .run();

    globalThis.__appRuntimeEnv = { DB: binding };
    await ensureMcpConnectionSchema();

    const schemaResult = (await binding
      .prepare(`select sql from sqlite_master where type = 'table' and name = 'McpConnection'`)
      .first()) as { sql: string } | null;
    assert.ok(schemaResult?.sql.toLowerCase().includes("shop text not null unique"));

    const rows = (await binding
      .prepare(`select key, shop, sessionId from McpConnection order by shop asc`)
      .all()) as { results: Array<{ key: string; shop: string; sessionId: string }> };

    assert.equal(rows.results.length, 2);
    assert.deepEqual(rows.results[0], {
      key: "new-key",
      shop: "shop-a.myshopify.com",
      sessionId: "session-a-2",
    });
    assert.deepEqual(rows.results[1], {
      key: "shop-b-key",
      shop: "shop-b.myshopify.com",
      sessionId: "session-b",
    });
  } finally {
    globalThis.__appRuntimeEnv = previousEnv;
    __mcpSchema.reset();
    await miniflare.dispose();
  }
});

test("ensureMcpConnectionSchema imports legacy secret hashes into McpSecret", async () => {
  const { binding, miniflare } = await createBinding();
  const previousEnv = globalThis.__appRuntimeEnv;
  __mcpSchema.reset();

  try {
    await binding
      .prepare(
        `create table McpConnection (
          key text primary key not null,
          shop text not null,
          sessionId text not null,
          secretHash text,
          createdAt integer not null,
          updatedAt integer not null
        )`,
      )
      .run();

    await binding
      .prepare(
        `insert into McpConnection (key, shop, sessionId, secretHash, createdAt, updatedAt)
         values ('legacy-key', 'legacy-shop.myshopify.com', 'offline_legacy-shop.myshopify.com', 'legacy-hash', 1000, 2000)`,
      )
      .run();

    globalThis.__appRuntimeEnv = { DB: binding };
    await ensureMcpConnectionSchema();

    const rows = (await binding
      .prepare(
        `select connectionKey, shop, label, secretCiphertext, secretHash, revokedAt
         from McpSecret`,
      )
      .all()) as {
      results: Array<{
        connectionKey: string;
        shop: string;
        label: string;
        secretCiphertext: string | null;
        secretHash: string;
        revokedAt: number | null;
      }>;
    };

    assert.equal(rows.results.length, 1);
    assert.deepEqual(rows.results[0], {
      connectionKey: "legacy-key",
      shop: "legacy-shop.myshopify.com",
      label: "Imported secret",
      secretCiphertext: null,
      secretHash: "legacy-hash",
      revokedAt: null,
    });
  } finally {
    globalThis.__appRuntimeEnv = previousEnv;
    __mcpSchema.reset();
    await miniflare.dispose();
  }
});
