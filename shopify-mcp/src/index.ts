import { Hono } from "hono";
import { WorkerEntrypoint } from "cloudflare:workers";
import { createMcpResponse } from "./handler";
import type { AssetEnv, ShopifyAdminCredentials } from "./runtime";

type StaticEnv = AssetEnv & {
  MCP_API_KEY?: string;
  SHOPIFY_SHOP_DOMAIN?: string;
  SHOPIFY_ADMIN_API_VERSION?: string;
  SHOPIFY_ADMIN_ACCESS_TOKEN?: string;
};

function getConfiguredApiKey(env: StaticEnv): string | undefined {
  const trimmed = env.MCP_API_KEY?.trim();
  return trimmed ? trimmed : undefined;
}

function getRequestApiKey(request: Request): string | undefined {
  const authorization = request.headers.get("authorization");
  if (authorization) {
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]) {
      const bearerToken = match[1].trim();
      if (bearerToken) {
        return bearerToken;
      }
    }
  }

  const queryToken = new URL(request.url).searchParams.get("api_key")?.trim();
  return queryToken || undefined;
}

function createUnauthorizedResponse(): Response {
  return new Response("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": "Bearer",
    },
  });
}

function requireCredentials(env: StaticEnv): ShopifyAdminCredentials {
  if (!env.SHOPIFY_SHOP_DOMAIN || !env.SHOPIFY_ADMIN_API_VERSION || !env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
    throw new Error("Missing static Shopify bindings for standalone MCP worker");
  }

  return {
    shopDomain: env.SHOPIFY_SHOP_DOMAIN,
    apiVersion: env.SHOPIFY_ADMIN_API_VERSION,
    adminAccessToken: env.SHOPIFY_ADMIN_ACCESS_TOKEN,
  };
}

export class GlobalOutbound extends WorkerEntrypoint<StaticEnv, ShopifyAdminCredentials> {
  async fetch(request: Request): Promise<Response> {
    const props = this.ctx.props;
    const allowedHost = new URL(
      `https://${props.shopDomain}/admin/api/${props.apiVersion}/graphql.json`,
    ).hostname;
    const requestedHost = new URL(request.url).hostname;

    if (requestedHost !== allowedHost) {
      return new Response(`Forbidden: requests to ${requestedHost} are not allowed`, {
        status: 403,
      });
    }

    const headers = new Headers(request.headers);
    headers.set("X-Shopify-Access-Token", props.adminAccessToken);

    return fetch(new Request(request, { headers }));
  }
}

type AppContext = {
  Bindings: StaticEnv;
};

const app = new Hono<AppContext>();

app.post("/mcp", async (c) => {
  const configuredApiKey = getConfiguredApiKey(c.env);
  if (configuredApiKey) {
    const requestApiKey = getRequestApiKey(c.req.raw);
    if (requestApiKey !== configuredApiKey) {
      return createUnauthorizedResponse();
    }
  }

  return createMcpResponse(
    c.req.raw,
    c.env,
    c.executionCtx as ExecutionContext & {
      exports?: Record<string, (options?: { props?: unknown }) => unknown>;
    },
    requireCredentials(c.env),
  );
});

app.all("*", () => new Response("Not Found", { status: 404 }));

export default {
  fetch(request: Request, env: StaticEnv, ctx: ExecutionContext): Promise<Response> {
    return Promise.resolve(app.fetch(request, env, ctx));
  },
};
