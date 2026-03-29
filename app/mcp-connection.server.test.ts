import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { drizzle } from "drizzle-orm/d1";
import { pushSQLiteSchema } from "drizzle-kit/api";
import { Miniflare } from "miniflare";
import { createBindingDb } from "./db.server";
import { LOCAL_D1_BINDING_NAME } from "./db/local-config";
import {
  createMcpSecretForShop,
  ensureMcpConnectionForShop,
  getMcpConnectionBySecret,
  listMcpSecretSummariesForShop,
  purgeShopData,
  regenerateMcpConnectionForShop,
  revealMcpSecretForShop,
  revokeMcpSecretForShop,
  resolveMcpSessionByKey,
  synchronizeMcpConnectionForShop,
  verifyMcpSecretForKey,
} from "./mcp-connection.server";
import * as schema from "./db/schema";

const TEST_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

async function createTestDb() {
  const miniflare = new Miniflare({
    modules: true,
    script: "",
    d1Persist: path.join(
      os.tmpdir(),
      "mcp-shopify-app-tests",
      `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ),
    d1Databases: {
      [LOCAL_D1_BINDING_NAME]: `test-local-db-${Date.now()}`,
    },
  });

  const binding = await miniflare.getD1Database(LOCAL_D1_BINDING_NAME);
  const pushResult = await pushSQLiteSchema(schema, drizzle(binding) as any);
  if (pushResult.statementsToExecute.length > 0) {
    await pushResult.apply();
  }

  return { db: createBindingDb(binding), miniflare };
}

function setTestRuntimeEnv(dbBinding?: D1Database) {
  globalThis.__appRuntimeEnv = {
    DB: dbBinding,
    MCP_SECRET_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
  };
}

test("ensureMcpConnectionForShop prefers an offline session", async () => {
  const { db, miniflare } = await createTestDb();
  const previousEnv = globalThis.__appRuntimeEnv;

  try {
    setTestRuntimeEnv();
    await db.insert(schema.sessions).values([
      {
        id: "online_test-shop.myshopify.com_1",
        shop: "test-shop.myshopify.com",
        state: "online",
        isOnline: true,
        accessToken: "online-token",
      },
      {
        id: "offline_test-shop.myshopify.com",
        shop: "test-shop.myshopify.com",
        state: "offline",
        isOnline: false,
        accessToken: "offline-token",
      },
    ]);

    const connection = await ensureMcpConnectionForShop(
      "test-shop.myshopify.com",
      "online_test-shop.myshopify.com_1",
      db,
    );

    assert.equal(connection.shop, "test-shop.myshopify.com");
    assert.equal(connection.sessionId, "offline_test-shop.myshopify.com");
    assert.ok(connection.connectionKey.length > 32);
  } finally {
    globalThis.__appRuntimeEnv = previousEnv;
    await miniflare.dispose();
  }
});

test("regenerateMcpConnectionForShop rotates the key and keeps one record per shop", async () => {
  const { db, miniflare } = await createTestDb();
  const previousEnv = globalThis.__appRuntimeEnv;

  try {
    setTestRuntimeEnv();
    await db.insert(schema.sessions).values({
      id: "offline_test-shop.myshopify.com",
      shop: "test-shop.myshopify.com",
      state: "offline",
      isOnline: false,
      accessToken: "offline-token",
    });

    const first = await ensureMcpConnectionForShop("test-shop.myshopify.com", undefined, db);
    const second = await regenerateMcpConnectionForShop("test-shop.myshopify.com", undefined, db);
    const rows = await db.select().from(schema.mcpConnections);

    assert.notEqual(first.connectionKey, second.connectionKey);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.shop, "test-shop.myshopify.com");
  } finally {
    globalThis.__appRuntimeEnv = previousEnv;
    await miniflare.dispose();
  }
});

test("resolveMcpSessionByKey fails cleanly when the attached session is missing", async () => {
  const { db, miniflare } = await createTestDb();
  const previousEnv = globalThis.__appRuntimeEnv;

  try {
    setTestRuntimeEnv();
    await db.insert(schema.mcpConnections).values({
      connectionKey: "mcp-key",
      shop: "test-shop.myshopify.com",
      sessionId: "missing-session",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const resolved = await resolveMcpSessionByKey("mcp-key", db);
    assert.equal(resolved.connection?.shop, "test-shop.myshopify.com");
    assert.equal(resolved.session, undefined);
  } finally {
    globalThis.__appRuntimeEnv = previousEnv;
    await miniflare.dispose();
  }
});

test("synchronizeMcpConnectionForShop updates the stored session without rotating the key", async () => {
  const { db, miniflare } = await createTestDb();
  const previousEnv = globalThis.__appRuntimeEnv;

  try {
    setTestRuntimeEnv();
    await db.insert(schema.sessions).values([
      {
        id: "online_test-shop.myshopify.com_1",
        shop: "test-shop.myshopify.com",
        state: "online-1",
        isOnline: true,
        accessToken: "online-token-1",
      },
      {
        id: "online_test-shop.myshopify.com_2",
        shop: "test-shop.myshopify.com",
        state: "online-2",
        isOnline: true,
        accessToken: "online-token-2",
      },
    ]);

    const initial = await ensureMcpConnectionForShop(
      "test-shop.myshopify.com",
      "online_test-shop.myshopify.com_1",
      db,
    );
    const updated = await synchronizeMcpConnectionForShop(
      "test-shop.myshopify.com",
      "online_test-shop.myshopify.com_2",
      db,
    );

    assert.equal(updated?.connectionKey, initial.connectionKey);
    assert.equal(updated?.sessionId, "online_test-shop.myshopify.com_2");
  } finally {
    globalThis.__appRuntimeEnv = previousEnv;
    await miniflare.dispose();
  }
});

test("createMcpSecretForShop keeps multiple active secrets and revoke is per-secret", async () => {
  const { db, miniflare } = await createTestDb();
  const previousEnv = globalThis.__appRuntimeEnv;

  try {
    setTestRuntimeEnv();
    await db.insert(schema.sessions).values({
      id: "offline_test-shop.myshopify.com",
      shop: "test-shop.myshopify.com",
      state: "offline",
      isOnline: false,
      accessToken: "offline-token",
    });

    const first = await createMcpSecretForShop("test-shop.myshopify.com", "Arnaud laptop", undefined, db);
    const second = await createMcpSecretForShop("test-shop.myshopify.com", "Ops desktop", undefined, db);

    assert.notEqual(first.secret, second.secret);
    assert.equal(await verifyMcpSecretForKey(first.connection.connectionKey, first.secret, db), true);
    assert.equal(await verifyMcpSecretForKey(first.connection.connectionKey, second.secret, db), true);

    const revealed = await revealMcpSecretForShop(second.secretSummary.id, "test-shop.myshopify.com", db);
    assert.equal(revealed.secret, second.secret);

    const updatedSecrets = await revokeMcpSecretForShop(second.secretSummary.id, "test-shop.myshopify.com", db);
    assert.equal(updatedSecrets.length, 2);
    assert.equal(updatedSecrets.filter((secret) => secret.revokedAt === null).length, 1);
    assert.equal(await verifyMcpSecretForKey(first.connection.connectionKey, first.secret, db), true);
    assert.equal(await verifyMcpSecretForKey(first.connection.connectionKey, second.secret, db), false);
    const firstSecretConnection = await getMcpConnectionBySecret(first.secret, db);
    assert.equal(firstSecretConnection?.shop, "test-shop.myshopify.com");
    assert.equal(await getMcpConnectionBySecret(second.secret, db), undefined);
  } finally {
    globalThis.__appRuntimeEnv = previousEnv;
    await miniflare.dispose();
  }
});

test("regenerateMcpConnectionForShop preserves existing secrets by rebinding them to the new key", async () => {
  const { db, miniflare } = await createTestDb();
  const previousEnv = globalThis.__appRuntimeEnv;

  try {
    setTestRuntimeEnv();
    await db.insert(schema.sessions).values({
      id: "offline_test-shop.myshopify.com",
      shop: "test-shop.myshopify.com",
      state: "offline",
      isOnline: false,
      accessToken: "offline-token",
    });

    const firstConnection = await ensureMcpConnectionForShop("test-shop.myshopify.com", undefined, db);
    const created = await createMcpSecretForShop("test-shop.myshopify.com", "Primary desktop", undefined, db);
    const regenerated = await regenerateMcpConnectionForShop("test-shop.myshopify.com", undefined, db);
    const secretRows = await db.select().from(schema.mcpSecrets).all();

    assert.notEqual(firstConnection.connectionKey, regenerated.connectionKey);
    assert.equal(await verifyMcpSecretForKey(regenerated.connectionKey, created.secret, db), true);
    assert.equal(secretRows[0]?.connectionKey, regenerated.connectionKey);
    assert.deepEqual(
      (await listMcpSecretSummariesForShop("test-shop.myshopify.com", db)).map((secret) => secret.label),
      ["Primary desktop"],
    );
  } finally {
    globalThis.__appRuntimeEnv = previousEnv;
    await miniflare.dispose();
  }
});

test("purgeShopData removes retained shop-scoped sessions, connections, and secrets", async () => {
  const { db, miniflare } = await createTestDb();
  const previousEnv = globalThis.__appRuntimeEnv;

  try {
    setTestRuntimeEnv();
    await db.insert(schema.sessions).values([
      {
        id: "offline_test-shop.myshopify.com",
        shop: "test-shop.myshopify.com",
        state: "offline",
        isOnline: false,
        accessToken: "offline-token",
      },
      {
        id: "offline_other-shop.myshopify.com",
        shop: "other-shop.myshopify.com",
        state: "offline",
        isOnline: false,
        accessToken: "other-token",
      },
    ]);

    await createMcpSecretForShop("test-shop.myshopify.com", "Primary desktop", undefined, db);
    await createMcpSecretForShop("other-shop.myshopify.com", "Other desktop", undefined, db);

    await purgeShopData("test-shop.myshopify.com", db);

    const remainingSessions = await db.select().from(schema.sessions).all();
    const remainingConnections = await db.select().from(schema.mcpConnections).all();
    const remainingSecrets = await db.select().from(schema.mcpSecrets).all();

    assert.deepEqual(
      remainingSessions.map((row) => row.shop),
      ["other-shop.myshopify.com"],
    );
    assert.deepEqual(
      remainingConnections.map((row) => row.shop),
      ["other-shop.myshopify.com"],
    );
    assert.deepEqual(
      remainingSecrets.map((row) => row.shop),
      ["other-shop.myshopify.com"],
    );
  } finally {
    globalThis.__appRuntimeEnv = previousEnv;
    await miniflare.dispose();
  }
});
