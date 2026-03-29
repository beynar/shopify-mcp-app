export const LOCAL_D1_BINDING_NAME = "DB";
export const LOCAL_D1_PERSIST_ROOT = ".wrangler/state";
export const LOCAL_D1_FALLBACK_DATABASE_ID = "local-development-db";

export function resolveLocalD1DatabaseId(databaseId?: string) {
  return databaseId || LOCAL_D1_FALLBACK_DATABASE_ID;
}
