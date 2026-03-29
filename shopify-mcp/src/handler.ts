import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createServer } from "./server";
import type { AssetEnv, ShopifyAdminCredentials } from "./runtime";

type WorkerExecutionContext = ExecutionContext & {
  exports?: Record<string, (options?: { props?: unknown }) => unknown>;
};

export async function createMcpResponse(
  request: Request,
  env: AssetEnv,
  ctx: WorkerExecutionContext,
  credentials: ShopifyAdminCredentials,
): Promise<Response> {
  const server = await createServer(env, ctx, credentials);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    retryInterval: 1000,
  });

  await server.connect(transport);
  const response = await transport.handleRequest(request);
  ctx.waitUntil(transport.close());

  return response;
}
