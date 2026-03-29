/// <reference types="vite/client" />
/// <reference types="@cloudflare/workers-types" />

declare module "./build/server/index.js" {
  const build: any;
  export default build;
}

declare module "./shopify-mcp/node_modules/hono/dist/hono.js" {
  export const Hono: any;
}
