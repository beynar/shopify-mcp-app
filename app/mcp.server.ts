import { apiVersion } from "./shopify.server";
import { createMcpResponse } from "../shopify-mcp/src/handler";
import { getMcpConnectionForShop, resolveMcpSessionByKey } from "./mcp-connection.server";
import { ensureSessionTokenForExecute } from "./shopify-token.server";
import { ensureMcpConnectionSchema } from "./mcp-schema.server";

export type WorkerEnv = {
  ASSETS: Fetcher;
  LOADER: WorkerLoader;
  DB?: D1Database;
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER?: unknown;
  SHOPIFY_API_KEY?: string;
  SHOPIFY_API_SECRET?: string;
  SHOPIFY_APP_URL?: string;
  SCOPES?: string;
  SHOP_CUSTOM_DOMAIN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_DATABASE_ID?: string;
  CLOUDFLARE_D1_TOKEN?: string;
};

export function extractMcpKeyFromUrl(url: string) {
  try {
    const pathname = new URL(url).pathname.replace(/\/+$/u, "");
    const match = pathname.match(/^\/mcp\/([A-Za-z0-9]+)$/u);
    return match?.[1];
  } catch {
    return undefined;
  }
}

export function buildMcpUrl(baseUrl: string, key: string) {
  return new URL(`/mcp/${key}`, baseUrl).toString();
}

export type McpOAuthGrantProps = {
  shop: string;
  connectionKey: string;
  sessionId: string;
};

export async function getMcpUrlForShop(shop: string, baseUrl: string) {
  const connection = await getMcpConnectionForShop(shop);
  return connection?.connectionKey ? buildMcpUrl(baseUrl, connection.connectionKey) : null;
}

export async function handleAuthorizedMcpRequest(
  request: Request,
  env: WorkerEnv,
  ctx: ExecutionContext & { exports?: Record<string, (options?: { props?: unknown }) => unknown> },
  oauthGrant: McpOAuthGrantProps,
) {
  await ensureMcpConnectionSchema();
  const key = extractMcpKeyFromUrl(request.url);
  if (!key) {
    return new Response("Invalid MCP URL", { status: 404 });
  }

  const resolved = await resolveMcpSessionByKey(key);
  const apiVersionString = String(apiVersion);
  const keyFingerprint = key.slice(0, 8);

  if (!resolved.connection) {
    console.warn(JSON.stringify({ event: "mcp_key_lookup_failed", keyFingerprint }));
    return new Response("Unknown MCP key", { status: 404 });
  }

  if (
    oauthGrant.connectionKey !== key ||
    oauthGrant.shop !== resolved.connection.shop ||
    oauthGrant.sessionId !== resolved.connection.sessionId
  ) {
    console.warn(
      JSON.stringify({
        event: "mcp_oauth_grant_mismatch",
        keyFingerprint,
        shop: resolved.connection.shop,
      }),
    );
    return new Response("OAuth grant does not match this MCP connection", { status: 403 });
  }

  if (!resolved.session) {
    console.warn(
      JSON.stringify({
        event: "mcp_session_missing",
        keyFingerprint,
        shop: resolved.connection.shop,
      }),
    );
    return new Response("MCP key is not attached to an active Shopify session", { status: 401 });
  }

  let session = resolved.session;
  if (await isExecuteToolRequest(request)) {
    session = await ensureSessionTokenForExecute(session, apiVersionString);
  }

  console.info(
    JSON.stringify({
      event: "mcp_key_lookup_succeeded",
      keyFingerprint,
      shop: session.shop,
    }),
  );

  return createMcpResponse(request, env, ctx, {
    shopDomain: session.shop,
    adminAccessToken: session.accessToken,
    apiVersion: apiVersionString,
  });
}

async function isExecuteToolRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return false;
  }

  try {
    const payload = (await request.clone().json()) as {
      method?: string;
      params?: { name?: string };
    };
    return payload.method === "tools/call" && payload.params?.name === "execute";
  } catch {
    return false;
  }
}
