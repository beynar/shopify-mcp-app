# Developer Guide

This guide explains how to work with this starter as an engineer.

It is focused on:

- the main entry points
- where to add routes and components
- how local and remote database workflows differ
- which files should not be touched casually

## Mental Model

This is an embedded Shopify app hosted on Cloudflare Workers.

There are five cooperating layers:

1. Shopify app configuration
2. Worker hosting and request entry
3. React Router routes and UI
4. Shopify auth and webhooks
5. Drizzle persistence over:
   - local D1 binding in development
   - remote D1 HTTP in deployed environments

Most feature work lives in layer 3.

## Stack Model

Application stack:

- React Router
- Shopify App Bridge / Shopify app server package
- Cloudflare Workers
- Cloudflare D1
- Drizzle ORM

Tooling stack:

- TypeScript
- Oxlint
- Oxfmt

Operational rule:

- product features usually touch routes and components
- auth changes live in the Shopify layer
- data changes live in the schema and DB layer
- deployment changes live in Worker and Shopify config

## Main Entry Points

### App UI Root

- [app/root.tsx](/Users/arnaud/code/mcp-shopify-app/app-test/app/root.tsx)

Use this for:

- document shell
- global meta and scripts
- wrappers shared by all routes

Do not put Shopify auth logic here.

### Embedded App Shell

- [app/routes/app.tsx](/Users/arnaud/code/mcp-shopify-app/app-test/app/routes/app.tsx)

Use this for:

- embedded app layout
- navigation
- nested app shell concerns

### Home Page

- [app/routes/app.\_index.tsx](/Users/arnaud/code/mcp-shopify-app/app-test/app/routes/app._index.tsx)

This is the fastest place to verify UI changes.

### Route Folder

- [app/routes](/Users/arnaud/code/mcp-shopify-app/app-test/app/routes)

Add new app pages here.
This repo uses filesystem routes; you usually do not need to edit the route manifest machinery manually.

### SSR Entry

- [app/entry.server.tsx](/Users/arnaud/code/mcp-shopify-app/app-test/app/entry.server.tsx)

Only touch this if you are changing server-render behavior.

### Worker Entry

- [worker.ts](/Users/arnaud/code/mcp-shopify-app/app-test/worker.ts)

This is the Cloudflare Worker entrypoint for deployed/runtime execution.
Do not edit it for normal feature work.

### Shopify Core

- [app/shopify.server.ts](/Users/arnaud/code/mcp-shopify-app/app-test/app/shopify.server.ts)

This owns:

- Shopify app config
- auth
- webhook registration surface
- session storage integration

### Database Layer

- [app/db/schema.ts](/Users/arnaud/code/mcp-shopify-app/app-test/app/db/schema.ts)
- [app/db.server.ts](/Users/arnaud/code/mcp-shopify-app/app-test/app/db.server.ts)
- [app/session-storage.server.ts](/Users/arnaud/code/mcp-shopify-app/app-test/app/session-storage.server.ts)
- [scripts/db-push-local.ts](/Users/arnaud/code/mcp-shopify-app/app-test/scripts/db-push-local.ts)

This layer owns:

- schema definition
- local binding vs remote HTTP resolution
- session persistence
- local and remote schema push behavior

## How to Add a Route

To add a new embedded app page:

1. Create a new file in [app/routes](/Users/arnaud/code/mcp-shopify-app/app-test/app/routes)
2. Export a default React component
3. Add `loader` and `action` if needed
4. Add navigation in [app/routes/app.tsx](/Users/arnaud/code/mcp-shopify-app/app-test/app/routes/app.tsx) if the page should be visible in the app shell

If the route needs Shopify Admin auth, follow the existing pattern:

```ts
const { admin } = await authenticate.admin(request);
```

## How to Add Components

There is no mandatory shared components folder yet.

Recommended rule:

1. route-local component: keep it beside the route
2. reused component: move it into `app/components/`

Avoid premature abstractions. This repo is still small.

After component changes, run:

```bash
npm run lint
npm run format
npm run typecheck
```

## How to Add Server Logic

For route-specific behavior:

- add a `loader`
- add an `action`

inside the route file.

For reusable helpers:

- keep them in `app/`
- keep server helpers separate from UI concerns

For Shopify Admin API access, use `authenticate.admin(request)`.

## How to Add Database-Backed Features

1. Update [app/db/schema.ts](/Users/arnaud/code/mcp-shopify-app/app-test/app/db/schema.ts)
2. Push the schema locally:

```bash
npm run db:push:local
```

3. Validate the feature locally with `npm run dev`
4. Push the same schema remotely:

```bash
npm run db:push:remote
```

5. Add query logic using `await getDb()` from [app/db.server.ts](/Users/arnaud/code/mcp-shopify-app/app-test/app/db.server.ts)

Important:

- local development uses a D1 binding
- deployed environments use D1 HTTP
- the schema file is the source of truth
- do not reintroduce Prisma
- do not rely on generated migration files as the normal workflow

## Database Push Commands

There are two DB push commands, and they are not interchangeable.

### `npm run db:push:local`

Use this when:

- you changed [app/db/schema.ts](/Users/arnaud/code/mcp-shopify-app/app-test/app/db/schema.ts)
- you are iterating locally
- you want the local D1 binding used by development to match the schema

What it does:

- opens the local D1 binding database
- diffs the current local schema against the Drizzle schema
- applies the required SQL locally

What it does not do:

- it does not touch the hosted Cloudflare D1 database
- it does not deploy anything

### `npm run db:push:remote`

Use this when:

- the schema is validated locally
- you want the hosted Cloudflare D1 database updated
- the deployed app needs the new schema

What it does:

- connects to the remote Cloudflare D1 database over HTTP
- diffs the hosted schema against the Drizzle schema
- applies the required SQL remotely

What it does not do:

- it does not update the local D1 binding
- it does not deploy Worker code

### Practical Rule

Use this sequence:

1. Change [app/db/schema.ts](/Users/arnaud/code/mcp-shopify-app/app-test/app/db/schema.ts)
2. Run `npm run db:push:local`
3. Test locally with `npm run dev`
4. Run `npm run db:push:remote`
5. If app code changed too, run `npm run deploy:worker`

## Local Development Flow

Normal loop:

1. Ensure `.env` is populated
2. Run:

```bash
npm run dev
```

3. Shopify CLI starts the local app flow
4. `shopify.web.toml` runs `npm run db:push:local`
5. The app uses a local D1 binding automatically
6. Edit routes/components and refresh

When schema changes:

```bash
npm run db:push:local
```

When you are ready to update the hosted database:

```bash
npm run db:push:remote
```

Do not skip the local push when you changed the schema. Local development uses the local D1 binding, so your routes and session storage will only see the new schema after `db:push:local`.

## What You Should Usually Not Touch

These files are infrastructure-sensitive:

- [worker.ts](/Users/arnaud/code/mcp-shopify-app/app-test/worker.ts)
  runtime hosting entry
- [app/shopify.server.ts](/Users/arnaud/code/mcp-shopify-app/app-test/app/shopify.server.ts)
  Shopify auth/session core
- [app/db.server.ts](/Users/arnaud/code/mcp-shopify-app/app-test/app/db.server.ts)
  DB adapter selection and execution layer
- [app/session-storage.server.ts](/Users/arnaud/code/mcp-shopify-app/app-test/app/session-storage.server.ts)
  Shopify session persistence contract
- [app/db/schema.ts](/Users/arnaud/code/mcp-shopify-app/app-test/app/db/schema.ts)
  schema source of truth
- [scripts/db-push-local.ts](/Users/arnaud/code/mcp-shopify-app/app-test/scripts/db-push-local.ts)
  local push behavior
- [drizzle.config.ts](/Users/arnaud/code/mcp-shopify-app/app-test/drizzle.config.ts)
  remote Drizzle Kit config
- [wrangler.jsonc](/Users/arnaud/code/mcp-shopify-app/app-test/wrangler.jsonc)
  Worker account/runtime/binding config
- [shopify.app.toml](/Users/arnaud/code/mcp-shopify-app/app-test/shopify.app.toml)
  Shopify app config
- [shopify.web.toml](/Users/arnaud/code/mcp-shopify-app/app-test/shopify.web.toml)
  local Shopify web process config

Changing those casually can break:

- auth callbacks
- embedded app boot
- local DB behavior
- remote DB connectivity
- deployment
- store installation
- webhooks

## Tooling Commands

Use these commands during normal development:

```bash
npm run lint
npm run lint:fix
npm run format
npm run format:check
npm run typecheck
npm test
```

## Deploy Rules

Use:

```bash
npm run deploy:worker
```

when you change:

- UI
- routes
- loaders/actions
- DB runtime logic
- Worker runtime logic

Use:

```bash
npm run deploy
```

when you change Shopify application config, such as:

- app URL
- redirect URLs
- scopes
- webhook declarations
