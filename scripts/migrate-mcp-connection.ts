import "dotenv/config";
import path from "node:path";
import process from "node:process";
import { Miniflare } from "miniflare";
import { ensureMcpConnectionSchema } from "../app/mcp-schema.server";
import {
  LOCAL_D1_BINDING_NAME,
  LOCAL_D1_PERSIST_ROOT,
  resolveLocalD1DatabaseId,
} from "../app/db/local-config";

async function main() {
  const mode = process.argv.includes("--local") ? "local" : "remote";

  if (mode === "local") {
    const miniflare = new Miniflare({
      modules: true,
      script: "",
      d1Persist: path.join(path.resolve(process.cwd(), LOCAL_D1_PERSIST_ROOT), "v3", "d1"),
      d1Databases: {
        [LOCAL_D1_BINDING_NAME]: resolveLocalD1DatabaseId(process.env.CLOUDFLARE_DATABASE_ID),
      },
    });

    try {
      const binding = await miniflare.getD1Database(LOCAL_D1_BINDING_NAME);
      globalThis.__appRuntimeEnv = {
        ...globalThis.__appRuntimeEnv,
        DB: binding,
        CLOUDFLARE_DATABASE_ID: process.env.CLOUDFLARE_DATABASE_ID,
        CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
        CLOUDFLARE_D1_TOKEN: process.env.CLOUDFLARE_D1_TOKEN,
      };
      await ensureMcpConnectionSchema();
      console.log("Local McpConnection schema repaired.");
    } finally {
      await miniflare.dispose();
    }

    return;
  }

  globalThis.__appRuntimeEnv = {
    ...globalThis.__appRuntimeEnv,
    CLOUDFLARE_DATABASE_ID: process.env.CLOUDFLARE_DATABASE_ID,
    CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_D1_TOKEN: process.env.CLOUDFLARE_D1_TOKEN,
  };
  await ensureMcpConnectionSchema();
  console.log("Remote McpConnection schema repaired.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
