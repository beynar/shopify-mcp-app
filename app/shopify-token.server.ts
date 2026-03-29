import { requireEnv } from "./env.server";
import { updateSessionAuth } from "./mcp-connection.server";
import type { SessionRow } from "./db/schema";

const TOKEN_VALIDATION_QUERY = `query McpTokenValidation { shop { id myshopifyDomain } }`;
const AUTH_ERROR_PATTERN = /invalid api key or access token|unrecognized login or wrong password/i;

type ShopifyTokenRefreshResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

function shortSessionId(sessionId: string) {
  return sessionId.slice(0, 12);
}

function isAuthFailure(status: number, payloadText: string) {
  return status === 401 || AUTH_ERROR_PATTERN.test(payloadText);
}

async function validateAccessToken(session: SessionRow, apiVersion: string) {
  const response = await fetch(`https://${session.shop}/admin/api/${apiVersion}/graphql.json`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-shopify-access-token": session.accessToken,
    },
    body: JSON.stringify({ query: TOKEN_VALIDATION_QUERY }),
  });

  const text = await response.text();
  if (response.ok) {
    return { ok: true as const };
  }

  return {
    ok: false as const,
    authFailure: isAuthFailure(response.status, text),
    message: text || `HTTP ${response.status}`,
  };
}

async function refreshAccessToken(session: SessionRow) {
  if (!session.refreshToken) {
    throw new Error(`Session ${shortSessionId(session.id)} has no refresh token`);
  }

  console.info(
    JSON.stringify({
      event: "mcp_token_refresh_attempt",
      shop: session.shop,
      sessionId: shortSessionId(session.id),
    }),
  );

  const response = await fetch(`https://${session.shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      client_id: requireEnv("SHOPIFY_API_KEY"),
      client_secret: requireEnv("SHOPIFY_API_SECRET"),
      grant_type: "refresh_token",
      refresh_token: session.refreshToken,
    }),
  });

  const payload = (await response.json()) as ShopifyTokenRefreshResponse;
  if (!response.ok || !payload.access_token) {
    const message = payload.error_description ?? payload.error ?? `HTTP ${response.status}`;
    console.warn(
      JSON.stringify({
        event: "mcp_token_refresh_failed",
        shop: session.shop,
        sessionId: shortSessionId(session.id),
        status: response.status,
      }),
    );
    throw new Error(`Shopify token refresh failed: ${message}`);
  }

  const refreshedSession = await updateSessionAuth(session.id, {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? session.refreshToken ?? null,
    refreshTokenExpires:
      typeof payload.refresh_token_expires_in === "number"
        ? new Date(Date.now() + payload.refresh_token_expires_in * 1000)
        : session.refreshTokenExpires,
    expires:
      typeof payload.expires_in === "number" ? new Date(Date.now() + payload.expires_in * 1000) : null,
    scope: payload.scope ?? session.scope ?? null,
  });

  if (!refreshedSession) {
    throw new Error(`Failed to persist refreshed Shopify session ${shortSessionId(session.id)}`);
  }

  console.info(
    JSON.stringify({
      event: "mcp_token_refresh_succeeded",
      shop: refreshedSession.shop,
      sessionId: shortSessionId(refreshedSession.id),
    }),
  );

  return refreshedSession;
}

export async function ensureSessionTokenForExecute(session: SessionRow, apiVersion: string) {
  const validation = await validateAccessToken(session, apiVersion);
  if (validation.ok) {
    return session;
  }

  if (!validation.authFailure) {
    throw new Error(`Shopify token validation failed: ${validation.message}`);
  }

  if (!session.refreshToken) {
    throw new Error(`Stored Shopify session for ${session.shop} is invalid and cannot be refreshed`);
  }

  const refreshed = await refreshAccessToken(session);
  return refreshed;
}
