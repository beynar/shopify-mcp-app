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
import { createMcpSecretForShop } from "./mcp-connection.server";

const TEST_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

process.env.SHOPIFY_API_KEY ??= "test-key";
process.env.SHOPIFY_API_SECRET ??= "test-secret";
process.env.SHOPIFY_APP_URL ??= "https://example.com";
process.env.SCOPES ??= "read_products";

async function loadWebhookModules() {
  const [{ authenticate }, { authenticateWebhookRequest }, { action: complianceAction }, { action: scopesUpdateAction }, { action: uninstalledAction }] =
    await Promise.all([
      import("./shopify.server"),
      import("./webhook-auth.server"),
      import("./routes/webhooks.compliance"),
      import("./routes/webhooks.app.scopes_update"),
      import("./routes/webhooks.app.uninstalled"),
    ]);

  return {
    authenticate,
    authenticateWebhookRequest,
    complianceAction,
    scopesUpdateAction,
    uninstalledAction,
  };
}

async function createTestDb() {
  const miniflare = new Miniflare({
    modules: true,
    script: "",
    d1Persist: path.join(
      os.tmpdir(),
      "mcp-shopify-app-webhook-tests",
      `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ),
    d1Databases: {
      [LOCAL_D1_BINDING_NAME]: `webhook-test-${Date.now()}`,
    },
  });

  const binding = await miniflare.getD1Database(LOCAL_D1_BINDING_NAME);
  const pushResult = await pushSQLiteSchema(schema, drizzle(binding) as any);
  if (pushResult.statementsToExecute.length > 0) {
    await pushResult.apply();
  }

  return { binding, db: createBindingDb(binding), miniflare };
}

function setTestRuntimeEnv(dbBinding?: D1Database) {
  globalThis.__appRuntimeEnv = {
    DB: dbBinding,
    MCP_SECRET_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
  };
}

function setWebhookStub(
  authenticate: Awaited<ReturnType<typeof loadWebhookModules>>["authenticate"],
  stub: typeof authenticate.webhook,
) {
  const auth = authenticate as { webhook: typeof authenticate.webhook };
  const original = auth.webhook;
  auth.webhook = stub;
  return () => {
    auth.webhook = original;
  };
}

test("authenticateWebhookRequest returns thrown Shopify auth responses unchanged", async () => {
  const { authenticate, authenticateWebhookRequest } = await loadWebhookModules();
  const restore = setWebhookStub(authenticate, async () => {
    throw new Response(undefined, { status: 401, statusText: "Unauthorized" });
  });

  try {
    const result = await authenticateWebhookRequest(new Request("https://example.com/webhooks/compliance", { method: "POST" }));
    assert.ok(result instanceof Response);
    assert.equal(result.status, 401);
    assert.equal(result.statusText, "Unauthorized");
  } finally {
    restore();
  }
});

test("authenticateWebhookRequest rethrows non-Response failures", async () => {
  const { authenticate, authenticateWebhookRequest } = await loadWebhookModules();
  const restore = setWebhookStub(authenticate, async () => {
    throw new Error("boom");
  });

  try {
    await assert.rejects(
      () => authenticateWebhookRequest(new Request("https://example.com/webhooks/compliance", { method: "POST" })),
      /boom/,
    );
  } finally {
    restore();
  }
});

test("compliance webhook returns 401 for invalid HMAC and 405 for non-POST", async () => {
  const { authenticate, complianceAction } = await loadWebhookModules();
  const restore = setWebhookStub(authenticate, async (request: Request) => {
    if (request.method !== "POST") {
      throw new Response(undefined, { status: 405, statusText: "Method not allowed" });
    }
    throw new Response(undefined, { status: 401, statusText: "Unauthorized" });
  });

  try {
    const invalid = await complianceAction({
      request: new Request("https://example.com/webhooks/compliance", { method: "POST" }),
      context: {},
      params: {},
    } as any);
    assert.equal(invalid.status, 401);

    const wrongMethod = await complianceAction({
      request: new Request("https://example.com/webhooks/compliance", { method: "GET" }),
      context: {},
      params: {},
    } as any);
    assert.equal(wrongMethod.status, 405);
  } finally {
    restore();
  }
});

test("compliance webhook returns 400 for malformed webhook requests", async () => {
  const { authenticate, complianceAction } = await loadWebhookModules();
  const restore = setWebhookStub(authenticate, async () => {
    throw new Response(undefined, { status: 400, statusText: "Bad Request" });
  });

  try {
    const response = await complianceAction({
      request: new Request("https://example.com/webhooks/compliance", { method: "POST" }),
      context: {},
      params: {},
    } as any);
    assert.equal(response.status, 400);
  } finally {
    restore();
  }
});

test("shop/redact compliance webhook returns 200 and purges shop-scoped retained data", async () => {
  const { authenticate, complianceAction } = await loadWebhookModules();
  const { binding, db, miniflare } = await createTestDb();
  const previousEnv = globalThis.__appRuntimeEnv;
  const restore = setWebhookStub(authenticate, async () => ({
    shop: "test-shop.myshopify.com",
    topic: "shop/redact",
  } as any));

  try {
    setTestRuntimeEnv(binding);
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

    const response = await complianceAction({
      request: new Request("https://example.com/webhooks/compliance", { method: "POST" }),
      context: {},
      params: {},
    } as any);

    assert.equal(response.status, 200);

    const remainingSessions = await db.select().from(schema.sessions).all();
    const remainingConnections = await db.select().from(schema.mcpConnections).all();
    const remainingSecrets = await db.select().from(schema.mcpSecrets).all();

    assert.deepEqual(remainingSessions.map((row) => row.shop), ["other-shop.myshopify.com"]);
    assert.deepEqual(remainingConnections.map((row) => row.shop), ["other-shop.myshopify.com"]);
    assert.deepEqual(remainingSecrets.map((row) => row.shop), ["other-shop.myshopify.com"]);
  } finally {
    restore();
    globalThis.__appRuntimeEnv = previousEnv;
    await miniflare.dispose();
  }
});

test("other webhook routes preserve Shopify auth failures", async () => {
  const { authenticate, scopesUpdateAction, uninstalledAction } = await loadWebhookModules();
  const restore = setWebhookStub(authenticate, async () => {
    throw new Response(undefined, { status: 401, statusText: "Unauthorized" });
  });

  try {
    const uninstalled = await uninstalledAction({
      request: new Request("https://example.com/webhooks/app/uninstalled", { method: "POST" }),
      context: {},
      params: {},
    } as any);
    assert.equal(uninstalled.status, 401);

    const scopesUpdate = await scopesUpdateAction({
      request: new Request("https://example.com/webhooks/app/scopes_update", { method: "POST" }),
      context: {},
      params: {},
    } as any);
    assert.equal(scopesUpdate.status, 401);
  } finally {
    restore();
  }
});
