import { WorkerEntrypoint } from "cloudflare:workers";
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { createRequestHandler } from "@react-router/cloudflare";
import { Hono } from "hono";
import { requireEnv, setRuntimeEnv } from "./app/env.server";
import { buildMcpUrl, handleAuthorizedMcpRequest, type McpOAuthGrantProps, type WorkerEnv } from "./app/mcp.server";
import { authenticate, sessionStorage } from "./app/shopify.server";
import {
  createMcpSecretForShop,
  ensureMcpConnectionForShop,
  listMcpSecretSummariesForShop,
  regenerateMcpConnectionForShop,
  revealMcpSecretForShop,
  revokeMcpSecretForShop,
} from "./app/mcp-connection.server";
import { ensureMcpConnectionSchema } from "./app/mcp-schema.server";
import {
  handleAuthorizePageRequest,
  handleAuthorizeSubmitRequest,
  revokeOauthGrantsForShop,
} from "./app/mcp-oauth.server";
import { action as complianceWebhookAction } from "./app/routes/webhooks.compliance";
import { action as appUninstalledWebhookAction } from "./app/routes/webhooks.app.uninstalled";
import { action as appScopesUpdateWebhookAction } from "./app/routes/webhooks.app.scopes_update";

const AUTHORIZE_KEY_COOKIE = "mcp_authorize_key";
const AUTHORIZE_KEY_COOKIE_TTL_SECONDS = 10 * 60;
let requestHandlerPromise: Promise<ReturnType<typeof createRequestHandler<WorkerEnv>>> | undefined;

async function getRequestHandler() {
  if (!requestHandlerPromise) {
    requestHandlerPromise = (async () => {
      const build = await import("./build/server/index.js");

      return createRequestHandler<WorkerEnv>({
        build: build as any,
        mode: process.env.NODE_ENV,
        getLoadContext({ context }) {
          setRuntimeEnv(context.cloudflare.env);
          return {
            cloudflare: context.cloudflare,
          };
        },
      });
    })();
  }

  return requestHandlerPromise;
}

function getAppUrl() {
  return requireEnv("SHOPIFY_APP_URL");
}

const api = new Hono<{ Bindings: WorkerEnv }>();

function toRouteContext(env: WorkerEnv, ctx: ExecutionContext) {
  return {
    cloudflare: {
      env,
      ctx,
    },
  };
}

api.all("/webhooks/compliance", async (c: any) =>
  complianceWebhookAction({
    request: c.req.raw,
    context: toRouteContext(c.env, c.executionCtx),
    params: {},
  } as any),
);

api.all("/webhooks/app/uninstalled", async (c: any) =>
  appUninstalledWebhookAction({
    request: c.req.raw,
    context: toRouteContext(c.env, c.executionCtx),
    params: {},
  } as any),
);

api.all("/webhooks/app/scopes_update", async (c: any) =>
  appScopesUpdateWebhookAction({
    request: c.req.raw,
    context: toRouteContext(c.env, c.executionCtx),
    params: {},
  } as any),
);

async function loadMcpAdminState(shop: string, currentSessionId?: string) {
  const connection = await ensureMcpConnectionForShop(shop, currentSessionId);
  return {
    mcpUrl: buildMcpUrl(getAppUrl(), connection.connectionKey),
    secrets: await listMcpSecretSummariesForShop(shop),
  };
}

api.get("/api/mcp-connection", async (c: any) => {
  try {
    await ensureMcpConnectionSchema();
    const { session } = await authenticate.admin(c.req.raw);
    await sessionStorage.storeSession(session);
    const state = await loadMcpAdminState(session.shop, session.id);
    return c.json(state);
  } catch (error) {
    console.error("Failed to load MCP connection", error);
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

api.post("/api/mcp-connection", async (c: any) => {
  try {
    await ensureMcpConnectionSchema();
    const { session } = await authenticate.admin(c.req.raw);
    await sessionStorage.storeSession(session);

    const contentType = c.req.header("content-type") ?? "";
    const intent =
      contentType.includes("application/json")
        ? ((await c.req.json()) as { intent?: string }).intent
        : (await c.req.formData()).get("intent")?.toString();

    if (intent === "regenerate") {
      const connection = await regenerateMcpConnectionForShop(session.shop, session.id);
      await revokeOauthGrantsForShop(c.env, session.shop);
      return c.json({
        mcpUrl: buildMcpUrl(getAppUrl(), connection.connectionKey),
        secrets: await listMcpSecretSummariesForShop(session.shop),
      });
    }

    if (intent) {
      throw new Error(`Unsupported MCP connection intent: ${intent}`);
    }

    return c.json(await loadMcpAdminState(session.shop, session.id));
  } catch (error) {
    console.error("Failed to mutate MCP connection", error);
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

api.post("/api/mcp-secrets", async (c: any) => {
  try {
    await ensureMcpConnectionSchema();
    const { session } = await authenticate.admin(c.req.raw);
    await sessionStorage.storeSession(session);

    const payload = c.req.header("content-type")?.includes("application/json")
      ? ((await c.req.json()) as { intent?: string; label?: string; secretId?: string })
      : {
          intent: (await c.req.formData()).get("intent")?.toString(),
          label: (await c.req.formData()).get("label")?.toString(),
          secretId: (await c.req.formData()).get("secretId")?.toString(),
        };

    if (payload.intent === "create") {
      const result = await createMcpSecretForShop(session.shop, payload.label ?? "", session.id);
      return c.json({
        ...(await loadMcpAdminState(session.shop, session.id)),
        mcpSecret: result.secret,
        secretId: result.secretSummary?.id ?? null,
      });
    }

    if (payload.intent === "reveal") {
      if (!payload.secretId) {
        throw new Error("Secret id is required.");
      }

      const result = await revealMcpSecretForShop(payload.secretId, session.shop);
      return c.json({
        ...(await loadMcpAdminState(session.shop, session.id)),
        mcpSecret: result.secret,
        secretId: result.secretSummary.id,
      });
    }

    if (payload.intent === "revoke") {
      if (!payload.secretId) {
        throw new Error("Secret id is required.");
      }

      return c.json({
        ...(await loadMcpAdminState(session.shop, session.id)),
        secrets: await revokeMcpSecretForShop(payload.secretId, session.shop),
      });
    }

    throw new Error(`Unsupported MCP secret intent: ${payload.intent ?? "unknown"}`);
  } catch (error) {
    console.error("Failed to mutate MCP secret", error);
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

async function handleAppRequest(request: Request, env: WorkerEnv, ctx: ExecutionContext) {
  setRuntimeEnv(env);

  if (new URL(request.url).pathname === "/oauth/authorize") {
    return request.method === "POST"
      ? handleAuthorizeSubmitRequest(request, env)
      : handleAuthorizePageRequest(request, env);
  }

  if (new URL(request.url).pathname.startsWith("/api/mcp-connection")) {
    return api.fetch(request, env, ctx);
  }

  if (new URL(request.url).pathname.startsWith("/api/mcp-secrets")) {
    return api.fetch(request, env, ctx);
  }

  if (new URL(request.url).pathname.startsWith("/webhooks/")) {
    return api.fetch(request, env, ctx);
  }

  const assetResponse = await env.ASSETS.fetch(request);
  if (assetResponse.status !== 404) {
    return assetResponse;
  }

  const handler = await getRequestHandler();

  return handler({
    request: request as any,
    env,
    params: {},
    data: {},
    functionPath: "/",
    waitUntil: ctx.waitUntil.bind(ctx),
    passThroughOnException: ctx.passThroughOnException.bind(ctx),
    next: async () => new Response("Not Found", { status: 404 }),
  });
}

class ProtectedMcpHandler extends WorkerEntrypoint<WorkerEnv, McpOAuthGrantProps> {
  fetch(request: Request) {
    setRuntimeEnv(this.env);
    return handleAuthorizedMcpRequest(request, this.env, this.ctx as any, this.ctx.props);
  }
}

const oauthProvider = new OAuthProvider<WorkerEnv>({
  apiRoute: "/mcp/",
  apiHandler: ProtectedMcpHandler,
  defaultHandler: {
    fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext) {
      return handleAppRequest(request, env, ctx);
    },
  },
  authorizeEndpoint: "/oauth/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",
  scopesSupported: ["mcp"],
  resourceMetadata: {
    scopes_supported: ["mcp"],
    resource_name: "Shopify MCP",
  },
  allowPlainPKCE: false,
  accessTokenTTL: 3600,
  refreshTokenTTL: 30 * 24 * 60 * 60,
});

function buildAuthorizeKeyCookie(request: Request) {
  const pathname = new URL(request.url).pathname.replace(/\/+$/u, "");
  const match = pathname.match(/^\/mcp\/([A-Za-z0-9]+)$/u);
  if (!match?.[1]) {
    return null;
  }

  return `${AUTHORIZE_KEY_COOKIE}=${encodeURIComponent(match[1])}; Max-Age=${AUTHORIZE_KEY_COOKIE_TTL_SECONDS}; Path=/oauth/authorize; Secure; HttpOnly; SameSite=Lax`;
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext) {
    setRuntimeEnv(env);

    const response = await oauthProvider.fetch(request, env, ctx);
    const shouldPersistAuthorizeKey =
      request.method === "GET" &&
      new URL(request.url).pathname.startsWith("/mcp/") &&
      !request.headers.get("authorization") &&
      response.status === 401;

    if (!shouldPersistAuthorizeKey) {
      return response;
    }

    const cookie = buildAuthorizeKeyCookie(request);
    if (!cookie) {
      return response;
    }

    const nextHeaders = new Headers(response.headers);
    nextHeaders.append("set-cookie", cookie);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: nextHeaders,
    });
  },
};
