import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { pushSQLiteSchema } from "drizzle-kit/api";
import { Miniflare } from "miniflare";
import { createBindingDb, resetDbCache, resolveDbStrategy } from "./db.server";
import { LOCAL_D1_BINDING_NAME } from "./db/local-config";
import * as schema from "./db/schema";

test("resolveDbStrategy prefers a bound D1 database in production", () => {
  const fakeBinding = {
    prepare() {
      throw new Error("not used");
    },
  } as unknown as D1Database;

  assert.equal(resolveDbStrategy({ NODE_ENV: "development", DB: fakeBinding }), "binding");
  assert.equal(
    resolveDbStrategy({
      NODE_ENV: "production",
      DB: fakeBinding,
      CLOUDFLARE_ACCOUNT_ID: "account",
      CLOUDFLARE_DATABASE_ID: "database",
      CLOUDFLARE_D1_TOKEN: "token",
    }),
    "binding",
  );
});

test("resolveDbStrategy falls back to http in production without a binding", () => {
  assert.equal(
    resolveDbStrategy({
      NODE_ENV: "production",
      CLOUDFLARE_ACCOUNT_ID: "account",
      CLOUDFLARE_DATABASE_ID: "database",
      CLOUDFLARE_D1_TOKEN: "token",
    }),
    "http",
  );
});

test("resolveDbStrategy uses a local binding in development when only the database id is present", () => {
  assert.equal(
    resolveDbStrategy({
      NODE_ENV: "development",
      CLOUDFLARE_DATABASE_ID: "database",
    }),
    "binding",
  );
});

test("createBindingDb works against a local D1 binding", async () => {
  resetDbCache();

  const miniflare = new Miniflare({
    modules: true,
    script: "",
    d1Persist: path.join(
      os.tmpdir(),
      "app-test-d1-tests",
      `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ),
    d1Databases: {
      [LOCAL_D1_BINDING_NAME]: `test-local-db-${Date.now()}`,
    },
  });

  try {
    const binding = await miniflare.getD1Database(LOCAL_D1_BINDING_NAME);
    const db = createBindingDb(binding);
    const pushResult = await pushSQLiteSchema(schema, drizzle(binding) as any);

    if (pushResult.statementsToExecute.length > 0) {
      await pushResult.apply();
    }

    await db.insert(schema.sessions).values({
      id: "offline_test-shop.myshopify.com",
      shop: "test-shop.myshopify.com",
      state: "state",
      isOnline: false,
      accessToken: "token",
    });

    const row = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, "offline_test-shop.myshopify.com"))
      .get();

    assert.equal(row?.shop, "test-shop.myshopify.com");
    assert.equal(row?.accessToken, "token");
  } finally {
    await miniflare.dispose();
  }
});
