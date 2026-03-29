import type { WorkerEnv } from "./mcp.server";
import { extractMcpKeyFromUrl } from "./mcp.server";
import {
  getMcpConnectionBySecret,
  getMcpConnectionByKey,
  getSessionById,
  verifyMcpSecretForKey,
} from "./mcp-connection.server";
import { hashIdentifier } from "./mcp-secret.server";

type OAuthProviderHelpers = {
  parseAuthRequest(request: Request): Promise<{
    clientId: string;
    redirectUri: string;
    resource?: string | string[];
    scope: string[];
    state: string;
    responseType: string;
    codeChallenge?: string;
    codeChallengeMethod?: string;
  }>;
  lookupClient(clientId: string): Promise<{ clientName?: string; client_name?: string } | null>;
  completeAuthorization(options: {
    request: unknown;
    userId: string;
    metadata: unknown;
    scope: string[];
    props: unknown;
    revokeExistingGrants?: boolean;
  }): Promise<{ redirectTo: string }>;
  listUserGrants(
    userId: string,
    options?: { cursor?: string; limit?: number },
  ): Promise<{ items: Array<{ id: string }>; cursor?: string }>;
  revokeGrant(grantId: string, userId: string): Promise<void>;
};

const AUTHORIZE_ATTEMPT_LIMIT = 5;
const AUTHORIZE_ATTEMPT_TTL_SECONDS = 10 * 60;

function getOauthUserId(shop: string) {
  return `shop/${encodeURIComponent(shop)}`;
}

function getOauthHelpers(env: WorkerEnv) {
  return env.OAUTH_PROVIDER as OAuthProviderHelpers;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderAuthorizePage(options: {
  clientName: string;
  error?: string;
}) {
  const errorBlock = options.error
    ? `<div class="alert alert-error">${escapeHtml(options.error)}</div>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="alternate icon" href="/favicon.ico" />
    <title>Authorize MCP Client</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f1f8f5;
        --surface: #ffffff;
        --surface-border: #d4ddd7;
        --text: #202223;
        --muted: #616161;
        --green: #008060;
        --green-dark: #006e52;
        --input-border: #8c9196;
        --shadow: 0 18px 40px rgba(0, 0, 0, 0.08);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: var(--text);
        background:
          radial-gradient(circle at top, rgba(0, 128, 96, 0.10), transparent 36%),
          linear-gradient(180deg, #f7fbf8 0%, var(--bg) 100%);
      }
      main {
        width: min(100%, 540px);
        background: var(--surface);
        border: 1px solid var(--surface-border);
        border-radius: 12px;
        padding: 28px;
        box-shadow: var(--shadow);
      }
      .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 16px;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(0, 128, 96, 0.10);
        color: var(--green-dark);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 34px;
        line-height: 1.05;
        letter-spacing: -0.03em;
      }
      p {
        margin: 0;
        color: var(--muted);
        line-height: 1.55;
      }
      .stack {
        display: flex;
        flex-direction: column;
        gap: 18px;
      }
      .meta {
        display: flex;
        gap: 8px;
        font-size: 14px;
      }
      .meta strong {
        color: var(--text);
      }
      .alert {
        padding: 12px 14px;
        border-radius: 10px;
        font-size: 14px;
      }
      .alert-error {
        background: #fff1f1;
        border: 1px solid #e7b2b2;
        color: #8e1f1f;
      }
      form {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      label {
        display: block;
        font-size: 13px;
        font-weight: 700;
        color: var(--text);
      }
      input {
        width: 100%;
        padding: 13px 14px;
        border-radius: 10px;
        border: 1px solid var(--input-border);
        font-size: 15px;
        color: var(--text);
        background: #fff;
      }
      input:focus {
        outline: 2px solid rgba(0, 128, 96, 0.18);
        outline-offset: 1px;
        border-color: var(--green);
      }
      button {
        margin-top: 6px;
        width: 100%;
        padding: 14px 16px;
        border: none;
        border-radius: 10px;
        background: linear-gradient(180deg, #0a8f6a 0%, var(--green) 100%);
        color: white;
        font-size: 15px;
        font-weight: 700;
        cursor: pointer;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.18);
      }
      button:hover { background: linear-gradient(180deg, #0a8362 0%, var(--green-dark) 100%); }
    </style>
  </head>
  <body>
    <main>
      <div class="eyebrow">Shopify MCP</div>
      <div class="stack">
        <div class="stack" style="gap: 10px;">
          <h1>Authorize client</h1>
          <div class="meta"><strong>Client:</strong> <span>${escapeHtml(options.clientName)}</span></div>
          <p>Paste the store secret generated in the Shopify app to connect this MCP client.</p>
        </div>
        ${errorBlock}
        <form method="post">
          <label for="secret">Store secret</label>
          <input id="secret" name="secret" type="password" autocomplete="one-time-code" required />
          <button type="submit">Authorize</button>
        </form>
      </div>
    </main>
  </body>
</html>`;
}

function renderAuthorizeSuccessPage(options: {
  clientName: string;
  shopDomain: string;
  redirectTo: string;
}) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="no-referrer" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="alternate icon" href="/favicon.ico" />
    <title>MCP Authorized</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f1f8f5;
        --surface: #ffffff;
        --surface-border: #d4ddd7;
        --text: #202223;
        --muted: #616161;
        --green: #008060;
        --green-dark: #006e52;
        --shadow: 0 18px 40px rgba(0, 0, 0, 0.08);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: var(--text);
        background:
          radial-gradient(circle at top, rgba(0, 128, 96, 0.10), transparent 36%),
          linear-gradient(180deg, #f7fbf8 0%, var(--bg) 100%);
      }
      main {
        width: min(100%, 540px);
        background: var(--surface);
        border: 1px solid var(--surface-border);
        border-radius: 12px;
        padding: 28px;
        box-shadow: var(--shadow);
      }
      .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 16px;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(0, 128, 96, 0.10);
        color: var(--green-dark);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 34px;
        line-height: 1.05;
        letter-spacing: -0.03em;
      }
      p {
        margin: 0;
        color: var(--muted);
        line-height: 1.55;
      }
      code {
        display: inline-block;
        margin-top: 4px;
        padding: 4px 8px;
        border-radius: 8px;
        background: #f1f8f5;
        color: var(--green-dark);
      }
      .stack {
        display: flex;
        flex-direction: column;
        gap: 18px;
      }
      .meta {
        display: flex;
        gap: 8px;
        font-size: 14px;
      }
      .meta strong {
        color: var(--text);
      }
      .success {
        padding: 14px;
        border-radius: 10px;
        border: 1px solid #b7dfcf;
        background: #edf8f3;
        color: var(--green-dark);
        font-weight: 600;
      }
    </style>
  </head>
  <body>
    <main>
      <div class="eyebrow">Shopify MCP</div>
      <div class="stack">
        <div class="stack" style="gap: 10px;">
          <h1>Connection approved</h1>
        <div class="meta"><strong>Client:</strong> <span>${escapeHtml(options.clientName)}</span></div>
        <div class="meta"><strong>Store:</strong> <span><code>${escapeHtml(options.shopDomain)}</code></span></div>
        </div>
        <div class="success">Authorization succeeded. Returning to your MCP client now.</div>
      </div>
    </main>
    <script>
      window.setTimeout(() => {
        window.location.replace(${JSON.stringify(options.redirectTo)});
      }, 1200);
    </script>
  </body>
</html>`;
}

function getConnectionKeyFromResource(resource: string | string[] | undefined) {
  const candidates = Array.isArray(resource) ? resource : resource ? [resource] : [];
  for (const candidate of candidates) {
    const key = extractMcpKeyFromUrl(candidate);
    if (key) {
      return key;
    }
  }

  return undefined;
}

function getConnectionKeyFromSearchParams(request: Request) {
  return getConnectionKeyFromUserInput(new URL(request.url).searchParams.get("connection_key"));
}

function getConnectionKeyFromCookie(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.match(/(?:^|;\s*)mcp_authorize_key=([^;]+)/u);
  return getConnectionKeyFromUserInput(match?.[1] ? decodeURIComponent(match[1]) : undefined);
}

function getConnectionKeyFromUserInput(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  const keyFromUrl = extractMcpKeyFromUrl(trimmed);
  return keyFromUrl ?? trimmed;
}

async function enforceAuthorizeRateLimit(env: WorkerEnv, connectionKey: string, ip: string) {
  const ipFingerprint = await hashIdentifier(ip);
  const kvKey = `authorize-rate:${connectionKey}:${ipFingerprint}`;
  const current = await env.OAUTH_KV.get(kvKey, { type: "json" }) as { count?: number } | null;
  const count = (current?.count ?? 0) + 1;

  await env.OAUTH_KV.put(kvKey, JSON.stringify({ count }), {
    expirationTtl: AUTHORIZE_ATTEMPT_TTL_SECONDS,
  });

  if (count > AUTHORIZE_ATTEMPT_LIMIT) {
    throw new Error("Too many failed authorization attempts. Try again later.");
  }
}

async function resetAuthorizeRateLimit(env: WorkerEnv, connectionKey: string, ip: string) {
  const ipFingerprint = await hashIdentifier(ip);
  await env.OAUTH_KV.delete(`authorize-rate:${connectionKey}:${ipFingerprint}`);
}

async function parseAuthorizeContext(request: Request, env: WorkerEnv) {
  const oauth = getOauthHelpers(env);
  const oauthRequest = await oauth.parseAuthRequest(request);
  const connectionKey =
    getConnectionKeyFromResource(oauthRequest.resource) ??
    getConnectionKeyFromSearchParams(request) ??
    getConnectionKeyFromCookie(request);
  const clientInfo = await oauth.lookupClient(oauthRequest.clientId);
  const connection = connectionKey ? await getMcpConnectionByKey(connectionKey) : null;

  return {
    oauth,
    oauthRequest,
    connectionKey,
    clientName: clientInfo?.clientName ?? clientInfo?.client_name ?? oauthRequest.clientId,
    connection,
  };
}

export async function handleAuthorizePageRequest(request: Request, env: WorkerEnv) {
  try {
    const { clientName } = await parseAuthorizeContext(request, env);
    return new Response(renderAuthorizePage({ clientName }), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  } catch (error) {
    return new Response(
      renderAuthorizePage({
        clientName: "Unknown client",
        error: error instanceof Error ? error.message : "Unable to start authorization.",
      }),
      {
        status: 400,
        headers: { "content-type": "text/html; charset=utf-8" },
      },
    );
  }
}

export async function handleAuthorizeSubmitRequest(request: Request, env: WorkerEnv) {
  const forwardedFor = request.headers.get("cf-connecting-ip") ?? "unknown";

  try {
    const { oauth, oauthRequest, connectionKey, clientName } = await parseAuthorizeContext(request, env);
    const formData = await request.formData();
    const secret = formData.get("secret")?.toString() ?? "";
    const connectionFromSecret = await getMcpConnectionBySecret(secret);
    const resolvedConnectionKey = connectionKey ?? connectionFromSecret?.connectionKey;

    if (!resolvedConnectionKey) {
      await enforceAuthorizeRateLimit(env, "unknown", forwardedFor);
      return new Response(
        renderAuthorizePage({
          clientName,
          error: "Authorization failed. Verify the store secret and try again.",
        }),
        {
          status: 401,
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      );
    }

    const connection = connectionKey ? await getMcpConnectionByKey(resolvedConnectionKey) : connectionFromSecret;
    if (!connection) {
      await enforceAuthorizeRateLimit(env, resolvedConnectionKey, forwardedFor);
      return new Response(
        renderAuthorizePage({
          clientName,
          error: "Authorization failed. Verify the store secret and try again.",
        }),
        {
          status: 401,
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      );
    }

    const secretMatches = connectionKey ? await verifyMcpSecretForKey(resolvedConnectionKey, secret) : true;
    if (!secretMatches) {
      await enforceAuthorizeRateLimit(env, resolvedConnectionKey, forwardedFor);
      return new Response(
        renderAuthorizePage({
          clientName,
          error: "Authorization failed. Verify the store secret and try again.",
        }),
        {
          status: 401,
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      );
    }

    await resetAuthorizeRateLimit(env, resolvedConnectionKey, forwardedFor);

    const session = await getSessionById(connection.sessionId);
    if (!session) {
      throw new Error("This MCP connection is not attached to an active Shopify session.");
    }

    const { redirectTo } = await oauth.completeAuthorization({
      request: oauthRequest,
      userId: getOauthUserId(connection.shop),
      metadata: {
        shop: connection.shop,
        connectionKey: resolvedConnectionKey,
      },
      scope: oauthRequest.scope.length > 0 ? oauthRequest.scope : ["mcp"],
      props: {
        shop: connection.shop,
        connectionKey: resolvedConnectionKey,
        sessionId: session.id,
      },
      revokeExistingGrants: false,
    });

    console.info(
      JSON.stringify({
        event: "mcp_oauth_authorized",
        shop: connection.shop,
        keyFingerprint: resolvedConnectionKey.slice(0, 8),
      }),
    );

    return new Response(
      renderAuthorizeSuccessPage({
        clientName,
        shopDomain: connection.shop,
        redirectTo,
      }),
      {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
          "set-cookie": "mcp_authorize_key=; Max-Age=0; Path=/oauth/authorize; Secure; HttpOnly; SameSite=Lax",
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Authorization failed.";
    return new Response(
      renderAuthorizePage({
        clientName: "Unknown client",
        error: message,
      }),
      {
        status: 400,
        headers: { "content-type": "text/html; charset=utf-8" },
      },
    );
  }
}

export async function revokeOauthGrantsForShop(env: WorkerEnv, shop: string) {
  const oauth = getOauthHelpers(env);
  const userId = getOauthUserId(shop);
  let cursor: string | undefined;

  do {
    const page = await oauth.listUserGrants(userId, { cursor });
    await Promise.all(page.items.map((grant) => oauth.revokeGrant(grant.id, userId)));
    cursor = page.cursor;
  } while (cursor);
}
