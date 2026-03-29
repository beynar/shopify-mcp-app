import { useMemo, useState } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { requireEnv } from "../env.server";
import {
  ensureMcpConnectionForShop,
  listMcpSecretSummariesForShop,
  type McpSecretSummary,
} from "../mcp-connection.server";
import { ensureMcpConnectionSchema } from "../mcp-schema.server";
import { buildMcpUrl } from "../mcp.server";
import { authenticate, sessionStorage } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await sessionStorage.storeSession(session);
  await ensureMcpConnectionSchema();

  const connection = await ensureMcpConnectionForShop(session.shop, session.id);
  const appUrl = requireEnv("SHOPIFY_APP_URL");

  return {
    mcpUrl: buildMcpUrl(appUrl, connection.connectionKey),
    secrets: await listMcpSecretSummariesForShop(session.shop),
    shopDomain: session.shop,
  };
};

const cardStyle = {
  background: "var(--p-color-bg-surface, #ffffff)",
  border: "1px solid var(--p-color-border-secondary, #dfe3e8)",
  borderRadius: "14px",
  boxShadow: "0 1px 0 rgba(17, 24, 39, 0.04), 0 10px 28px rgba(17, 24, 39, 0.06)",
  padding: "24px",
} as const;

const fieldShellStyle = {
  background: "var(--p-color-bg-surface-secondary, #f6f6f7)",
  border: "1px solid var(--p-color-border-secondary, #dfe3e8)",
  borderRadius: "10px",
  padding: "12px 14px",
} as const;

const inputStyle = {
  border: "1px solid var(--p-color-border-secondary, #c9cccf)",
  borderRadius: "10px",
  background: "var(--p-color-bg-surface, #fff)",
  color: "var(--p-color-text, #1f2937)",
  fontSize: "14px",
  padding: "10px 12px",
  width: "100%",
} as const;

const copyButtonStyle = {
  border: "1px solid var(--p-color-border-secondary, #c9cccf)",
  borderRadius: "10px",
  background: "var(--p-color-bg-surface, #fff)",
  color: "var(--p-color-text, #1f2937)",
  cursor: "pointer",
  fontSize: "14px",
  fontWeight: 600,
  minWidth: "88px",
  padding: "10px 14px",
} as const;

const primaryButtonStyle = {
  border: "1px solid #0f7a44",
  borderRadius: "10px",
  background: "#108043",
  color: "#ffffff",
  cursor: "pointer",
  fontSize: "14px",
  fontWeight: 700,
  padding: "10px 14px",
} as const;

const secondaryButtonStyle = {
  border: "1px solid var(--p-color-border-secondary, #c9cccf)",
  borderRadius: "10px",
  background: "transparent",
  color: "var(--p-color-text, #1f2937)",
  cursor: "pointer",
  fontSize: "14px",
  fontWeight: 600,
  padding: "10px 14px",
} as const;

const dangerButtonStyle = {
  ...secondaryButtonStyle,
  color: "#a61b1b",
  borderColor: "#e0b4b4",
} as const;

const codeTextStyle = {
  fontFamily:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  fontSize: "13px",
  lineHeight: 1.5,
  margin: 0,
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
} as const;

function formatDate(value: Date | string | null) {
  if (!value) {
    return "—";
  }

  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

type SecretsResponse = {
  error?: string;
  mcpSecret?: string | null;
  mcpUrl?: string | null;
  secretId?: string | null;
  secrets?: McpSecretSummary[];
};

export default function Index() {
  const loaderData = useLoaderData<typeof loader>();
  const [mcpUrl, setMcpUrl] = useState(loaderData.mcpUrl);
  const [secrets, setSecrets] = useState(loaderData.secrets);
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, string>>({});
  const [newSecretLabel, setNewSecretLabel] = useState("");
  const [isMutatingMcpUrl, setIsMutatingMcpUrl] = useState(false);
  const [activeSecretAction, setActiveSecretAction] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const activeSecretsCount = useMemo(
    () => secrets.filter((secret) => secret.revokedAt === null).length,
    [secrets],
  );

  async function copyValue(field: string, value: string | null) {
    if (!value) {
      return;
    }

    await navigator.clipboard.writeText(value);
    setCopiedField(field);
    window.setTimeout(() => {
      setCopiedField((current) => (current === field ? null : current));
    }, 1400);
  }

  async function mutateConnection() {
    setIsMutatingMcpUrl(true);

    try {
      const response = await fetch("/api/mcp-connection", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({ intent: "regenerate" }),
      });

      const payload = (await response.json()) as SecretsResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? `Request failed with status ${response.status}`);
      }

      if (payload.mcpUrl) {
        setMcpUrl(payload.mcpUrl);
      }
      setSecrets(payload.secrets ?? []);
      setCopiedField(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      window.alert(`MCP URL regeneration failed: ${message}`);
    } finally {
      setIsMutatingMcpUrl(false);
    }
  }

  async function mutateSecret(intent: "create" | "reveal" | "revoke", secretId?: string) {
    const actionKey = secretId ? `${intent}:${secretId}` : intent;
    setActiveSecretAction(actionKey);

    try {
      const response = await fetch("/api/mcp-secrets", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          intent,
          label: intent === "create" ? newSecretLabel : undefined,
          secretId,
        }),
      });

      const payload = (await response.json()) as SecretsResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? `Request failed with status ${response.status}`);
      }

      if (payload.mcpUrl) {
        setMcpUrl(payload.mcpUrl);
      }
      if (payload.secrets) {
        setSecrets(payload.secrets);
      }
      if (intent === "create") {
        setNewSecretLabel("");
      }
      if (payload.secretId && payload.mcpSecret) {
        setRevealedSecrets((current) => ({
          ...current,
          [payload.secretId!]: payload.mcpSecret!,
        }));
      }
      if (intent === "revoke" && secretId) {
        setRevealedSecrets((current) => {
          const next = { ...current };
          delete next[secretId];
          return next;
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      window.alert(`Secret action failed: ${message}`);
    } finally {
      setActiveSecretAction(null);
    }
  }

  return (
    <s-page heading="Shopify MCP">
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "20px",
          maxWidth: "900px",
        }}
      >
        <div style={cardStyle}>
          <div style={{ display: "grid", gap: "16px" }}>
            <div style={{ display: "grid", gap: "6px" }}>
              <h2 style={{ fontSize: "24px", lineHeight: 1.2, margin: 0 }}>What this MCP does</h2>
              <p style={{ color: "#5c5f62", fontSize: "15px", lineHeight: 1.5, margin: 0 }}>
                This server lets your AI client talk to Shopify Admin for{" "}
                <strong>{loaderData.shopDomain}</strong>.
              </p>
            </div>

            <div style={{ display: "grid", gap: "12px" }}>
              <div style={fieldShellStyle}>
                <strong style={{ display: "block", marginBottom: "6px" }}>Use it when you want to:</strong>
                <ul style={{ margin: 0, paddingLeft: "18px", lineHeight: 1.55 }}>
                  <li>search the Shopify Admin GraphQL schema</li>
                  <li>run Shopify Admin queries and mutations from your AI client</li>
                  <li>issue multiple store secrets for different employees or machines</li>
                </ul>
              </div>

              <div style={fieldShellStyle}>
                <strong style={{ display: "block", marginBottom: "6px" }}>How sign-in works</strong>
                <ol style={{ margin: 0, paddingLeft: "18px", lineHeight: 1.55 }}>
                  <li>Paste the MCP URL into Claude Desktop, Claude Code, or another MCP client.</li>
                  <li>You will be redirected to an authorization page.</li>
                  <li>Paste any active store secret to finish the connection.</li>
                </ol>
              </div>
            </div>
          </div>
        </div>

        <div style={cardStyle}>
          <div style={{ display: "grid", gap: "16px" }}>
            <div style={{ display: "grid", gap: "6px" }}>
              <h2 style={{ fontSize: "24px", lineHeight: 1.2, margin: 0 }}>Install in your client</h2>
              <p style={{ color: "#5c5f62", fontSize: "15px", lineHeight: 1.5, margin: 0 }}>
                Copy the MCP URL into your client. Use one of the active store secrets during login.
              </p>
            </div>

            <div style={{ ...fieldShellStyle, display: "grid", gap: "10px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center" }}>
                <strong>MCP server URL</strong>
                <button
                  type="button"
                  onClick={() => void copyValue("url", mcpUrl)}
                  disabled={!mcpUrl}
                  style={{ ...copyButtonStyle, opacity: mcpUrl ? 1 : 0.5 }}
                >
                  {copiedField === "url" ? "Copied" : "Copy"}
                </button>
              </div>
              <pre style={codeTextStyle}>{mcpUrl}</pre>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
              <button
                type="button"
                onClick={() => void mutateConnection()}
                disabled={isMutatingMcpUrl}
                style={secondaryButtonStyle}
              >
                {isMutatingMcpUrl ? "Regenerating..." : "Regenerate MCP URL"}
              </button>
            </div>
          </div>
        </div>

        <div style={cardStyle}>
          <div style={{ display: "grid", gap: "16px" }}>
            <div style={{ display: "grid", gap: "6px" }}>
              <h2 style={{ fontSize: "24px", lineHeight: 1.2, margin: 0 }}>Store secrets</h2>
              <p style={{ color: "#5c5f62", fontSize: "15px", lineHeight: 1.5, margin: 0 }}>
                Active secrets keep working until you revoke them. Create one per employee or machine.
              </p>
            </div>

            <div style={{ ...fieldShellStyle, display: "grid", gap: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center" }}>
                <strong>Create new secret</strong>
                <span style={{ color: "#5c5f62", fontSize: "13px" }}>
                  {activeSecretsCount} active{activeSecretsCount === 1 ? "" : " secrets"}
                </span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
                <input
                  type="text"
                  value={newSecretLabel}
                  onChange={(event) => setNewSecretLabel(event.currentTarget.value)}
                  placeholder="Employee name or device label"
                  style={{ ...inputStyle, flex: "1 1 280px" }}
                />
                <button
                  type="button"
                  onClick={() => void mutateSecret("create")}
                  disabled={activeSecretAction === "create" || newSecretLabel.trim().length === 0}
                  style={primaryButtonStyle}
                >
                  {activeSecretAction === "create" ? "Creating..." : "Create new secret"}
                </button>
              </div>
            </div>

            <div style={{ display: "grid", gap: "12px" }}>
              {secrets.map((secret) => {
                const revealedSecret = revealedSecrets[secret.id] ?? null;
                const isRevoked = secret.revokedAt !== null;
                return (
                  <div key={secret.id} style={{ ...fieldShellStyle, display: "grid", gap: "12px" }}>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        justifyContent: "space-between",
                        gap: "12px",
                        alignItems: "center",
                      }}
                    >
                      <div style={{ display: "grid", gap: "4px" }}>
                        <strong>{secret.label}</strong>
                        <div style={{ color: "#5c5f62", fontSize: "13px" }}>
                          Created {formatDate(secret.createdAt)} ·{" "}
                          {isRevoked ? `Revoked ${formatDate(secret.revokedAt)}` : "Active"}
                        </div>
                      </div>
                      <div
                        style={{
                          alignSelf: "flex-start",
                          borderRadius: "999px",
                          background: isRevoked ? "#f1f2f3" : "#edf8f3",
                          color: isRevoked ? "#5c5f62" : "#0b6b3a",
                          fontSize: "12px",
                          fontWeight: 700,
                          padding: "6px 10px",
                        }}
                      >
                        {isRevoked ? "Revoked" : "Active"}
                      </div>
                    </div>

                    <pre style={codeTextStyle}>
                      {revealedSecret
                        ? revealedSecret
                        : secret.canReveal
                          ? "Hidden. Use Reveal to load the plaintext secret from secure storage."
                          : "Imported legacy secret. Plaintext is not recoverable; create a new secret instead."}
                    </pre>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
                      <button
                        type="button"
                        onClick={() => void mutateSecret("reveal", secret.id)}
                        disabled={isRevoked || !secret.canReveal || activeSecretAction === `reveal:${secret.id}`}
                        style={{ ...secondaryButtonStyle, opacity: isRevoked || !secret.canReveal ? 0.5 : 1 }}
                      >
                        {activeSecretAction === `reveal:${secret.id}` ? "Revealing..." : "Reveal"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void copyValue(`secret:${secret.id}`, revealedSecret)}
                        disabled={!revealedSecret || isRevoked}
                        style={{ ...copyButtonStyle, opacity: revealedSecret && !isRevoked ? 1 : 0.5 }}
                      >
                        {copiedField === `secret:${secret.id}` ? "Copied" : "Copy"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Revoke secret "${secret.label}"? Existing clients using it will stop working.`)) {
                            void mutateSecret("revoke", secret.id);
                          }
                        }}
                        disabled={isRevoked || activeSecretAction === `revoke:${secret.id}`}
                        style={{ ...dangerButtonStyle, opacity: isRevoked ? 0.5 : 1 }}
                      >
                        {activeSecretAction === `revoke:${secret.id}` ? "Revoking..." : "Revoke"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
