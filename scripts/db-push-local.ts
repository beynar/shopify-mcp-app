import "dotenv/config";
import path from "node:path";
import process from "node:process";
import { drizzle } from "drizzle-orm/d1";
import { pushSQLiteSchema } from "drizzle-kit/api";
import { Miniflare } from "miniflare";
import {
  LOCAL_D1_BINDING_NAME,
  LOCAL_D1_PERSIST_ROOT,
  resolveLocalD1DatabaseId,
} from "../app/db/local-config";
import * as schema from "../app/db/schema";

async function main() {
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
    const result = await pushSQLiteSchema(schema, drizzle(binding) as any);

    if (result.warnings.length > 0) {
      console.warn(result.warnings.join("\n"));
    }

    if (result.hasDataLoss) {
      console.error("Local schema push stopped because Drizzle reported data-loss warnings.");
      for (const statement of result.statementsToExecute) {
        console.error(statement);
      }
      process.exitCode = 1;
      return;
    }

    if (result.statementsToExecute.length === 0) {
      console.log("Local D1 schema is already up to date.");
      return;
    }

    await result.apply();
    console.log(
      `Applied ${result.statementsToExecute.length} statement(s) to the local D1 database.`,
    );
  } finally {
    await miniflare.dispose();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
