import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { drizzle } from "drizzle-orm/d1";
import { pushSQLiteSchema } from "drizzle-kit/api";
import { Miniflare } from "miniflare";
import { LOCAL_D1_BINDING_NAME } from "./db/local-config";
import { createBindingDb } from "./db.server";
import * as schema from "./db/schema";
import { ensureSessionTokenForExecute } from "./shopify-token.server";

async function createTestDb() {
  const miniflare = new Miniflare({
    modules: true,
    script: "",
    d1Persist: path.join(
      os.tmpdir(),
      "mcp-shopify-app-token-tests",
      `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ),
    d1Databases: {
      [LOCAL_D1_BINDING_NAME]: `token-test-${Date.now()}`,
    },
  });

  const binding = await miniflare.getD1Database(LOCAL_D1_BINDING_NAME);
  const pushResult = await pushSQLiteSchema(schema, drizzle(binding) as any);
  if (pushResult.statementsToExecute.length > 0) {
    await pushResult.apply();
  }

  return { binding, db: createBindingDb(binding), miniflare };
}

test("ensureSessionTokenForExecute refreshes an invalid token and persists the result", async () => {
  const { binding, db, miniflare } = await createTestDb();
  const previousEnv = globalThis.__appRuntimeEnv;
  const originalFetch = globalThis.fetch;

  try {
    await db.insert(schema.sessions).values({
      id: "offline_test-shop.myshopify.com",
      shop: "test-shop.myshopify.com",
      state: "offline",
      isOnline: false,
      accessToken: "expired-token",
      refreshToken: "refresh-token",
    });

    const session = await db.select().from(schema.sessions).get();
    assert.ok(session);

    let fetchCount = 0;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return new Response(JSON.stringify({ errors: "[API] Invalid API key or access token" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }

      assert.equal(init?.method, "POST");
      return new Response(
        JSON.stringify({
          access_token: "fresh-token",
          refresh_token: "fresh-refresh-token",
          expires_in: 3600,
          refresh_token_expires_in: 7200,
          scope: "read_products",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;

    globalThis.__appRuntimeEnv = {
      DB: binding,
      SHOPIFY_API_KEY: "test-key",
      SHOPIFY_API_SECRET: "test-secret",
    };

    const refreshed = await ensureSessionTokenForExecute(session, "2026-04");
    assert.equal(refreshed.accessToken, "fresh-token");
    assert.equal(refreshed.refreshToken, "fresh-refresh-token");
    assert.equal(refreshed.scope, "read_products");
    assert.ok(refreshed.expires);
    assert.ok(refreshed.refreshTokenExpires);

    const persisted = await db.select().from(schema.sessions).get();

    assert.equal(persisted?.accessToken, "fresh-token");
    assert.equal(persisted?.refreshToken, "fresh-refresh-token");
    assert.equal(persisted?.scope, "read_products");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.__appRuntimeEnv = previousEnv;
    await miniflare.dispose();
  }
});
