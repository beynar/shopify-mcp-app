# Shopify App Starter: React Router + Cloudflare Workers + Drizzle + D1

This repository is a starter for embedded Shopify apps with:

- React Router
- `@shopify/shopify-app-react-router`
- Cloudflare Workers for hosting
- Cloudflare D1 for persistence
- Drizzle ORM
- Oxlint and Oxfmt

This starter does not use Prisma.

It uses a hybrid D1 model:

- local development uses a local D1 binding backed by Miniflare persistence
- deployed environments use Cloudflare D1 HTTP with Drizzle `sqlite-proxy`

The schema source of truth is [app/db/schema.ts](/Users/arnaud/code/mcp-shopify-app/app-test/app/db/schema.ts).
Normal database workflow is push-only. Do not treat generated migration files as part of the day-to-day flow.

## Repeatable New Store Playbook

Use this repo with the following operating model:

- keep the repo private
- create one new Shopify app per store/app install target
- create one new Cloudflare Worker deployment per Shopify app
- manage Shopify app settings in Partner Dashboard
- reuse one stable Cloudflare D1 database binding across deployments unless you intentionally need isolation

Important constraint:

- one deployed Worker runtime supports one Shopify app identity
- if you create another Shopify app, the simple path is another Worker deployment with that app's credentials
- you do not need a new D1 database for every store; the normal path is to keep one stable D1 binding and reuse its ID

### Partner Dashboard values

App URL:

```text
https://mcp.nowmade.site
```

Redirect URL:

```text
https://mcp.nowmade.site/auth/callback
```

Scopes:

```text
read_assigned_fulfillment_orders,write_assigned_fulfillment_orders,read_merchant_managed_fulfillment_orders,write_merchant_managed_fulfillment_orders,read_third_party_fulfillment_orders,write_third_party_fulfillment_orders,read_cart_transforms,write_cart_transforms,read_checkout_branding_settings,write_checkout_branding_settings,read_content,write_content,read_online_store_pages,read_customer_events,write_pixels,read_customer_merge,write_customer_merge,read_customers,write_customers,read_delivery_customizations,write_delivery_customizations,read_discounts,write_discounts,read_draft_orders,write_draft_orders,read_files,write_files,read_fulfillments,write_fulfillments,read_gift_cards,write_gift_cards,read_inventory,write_inventory,read_legal_policies,read_locales,write_locales,read_locations,write_locations,read_markets,write_markets,read_marketing_events,write_marketing_events,read_metaobject_definitions,write_metaobject_definitions,read_metaobjects,write_metaobjects,read_online_store_navigation,write_online_store_navigation,read_order_edits,write_order_edits,read_orders,write_orders,read_payment_customizations,write_payment_customizations,read_payment_terms,write_payment_terms,read_price_rules,write_price_rules,read_privacy_settings,write_privacy_settings,read_products,write_products,read_purchase_options,write_purchase_options,read_reports,read_returns,write_returns,read_script_tags,write_script_tags,read_shipping,write_shipping,read_shopify_payments_disputes,read_shopify_payments_payouts,read_store_credit_accounts,read_store_credit_account_transactions,write_store_credit_account_transactions,read_themes,write_themes,read_translations,write_translations,read_validations,write_validations,write_app_proxy
```

### Steps

1. Create a brand-new Shopify app in Partner Dashboard.
2. Create a brand-new Cloudflare Worker deployment for that app.
3. Reuse the existing stable D1 binding and database ID for that deployment.
4. Set Worker secrets for that deployment:
   - `SHOPIFY_API_KEY`
   - `SHOPIFY_API_SECRET`
   - `SHOPIFY_APP_URL`
   - `CLOUDFLARE_D1_TOKEN` only if you also run remote D1 HTTP tooling from that environment
5. Deploy the Worker:

```bash
npm run deploy:worker
```

6. In Partner Dashboard, set:
   - App URL
   - Redirect URL: `/auth/callback`
   - mandatory compliance webhooks
   - scopes
   - privacy policy URL
7. Install that app on the target store.

## Architecture

At a high level:

1. Shopify loads the embedded app inside Admin.
2. The app is hosted on Cloudflare Workers.
3. Shopify auth and webhooks are handled by `@shopify/shopify-app-react-router`.
4. Session persistence goes through a custom Drizzle-backed `SessionStorage`.
5. The DB layer auto-selects:
   - local binding in development
   - remote HTTP in deployed environments

Important files:

- [app/shopify.server.ts](/Users/arnaud/code/mcp-shopify-app/app-test/app/shopify.server.ts)
  Shopify app configuration
- [app/session-storage.server.ts](/Users/arnaud/code/mcp-shopify-app/app-test/app/session-storage.server.ts)
  Shopify session storage implementation
- [app/db.server.ts](/Users/arnaud/code/mcp-shopify-app/app-test/app/db.server.ts)
  Hybrid DB resolver and adapters
- [app/db/schema.ts](/Users/arnaud/code/mcp-shopify-app/app-test/app/db/schema.ts)
  Drizzle schema source of truth
- [scripts/db-push-local.ts](/Users/arnaud/code/mcp-shopify-app/app-test/scripts/db-push-local.ts)
  Local push command for the local D1 binding
- [drizzle.config.ts](/Users/arnaud/code/mcp-shopify-app/app-test/drizzle.config.ts)
  Remote Drizzle Kit config for D1 HTTP
- [worker.ts](/Users/arnaud/code/mcp-shopify-app/app-test/worker.ts)
  Cloudflare Worker entrypoint
- [wrangler.jsonc](/Users/arnaud/code/mcp-shopify-app/app-test/wrangler.jsonc)
  Cloudflare Worker config, including local D1 binding metadata
- [shopify.web.toml](/Users/arnaud/code/mcp-shopify-app/app-test/shopify.web.toml)
  Shopify CLI local web process config

## Requirements

- Node.js `>=20.19 <22` or `>=22.12`
- `pnpm`
- Shopify CLI
- Cloudflare account with Workers and D1 enabled

## Scripts

From [package.json](/Users/arnaud/code/mcp-shopify-app/app-test/package.json):

- `npm run dev`
  Start Shopify local development flow
- `npm run build`
  Build the React Router client and server bundles
- `npm run deploy:worker`
  Build and deploy the Worker to Cloudflare
- `npm run deploy`
  Push Shopify app configuration/version
- `npm run db:push:local`
  Push the current schema into the local D1 binding database
- `npm run db:push:remote`
  Push the current schema into the Cloudflare-hosted D1 database over HTTP
- `npm run db:studio`
  Open Drizzle Studio against the remote D1 HTTP database
- `npm run lint`
  Run Oxlint
- `npm run lint:fix`
  Apply Oxlint autofixes where supported
- `npm run format`
  Format the repo with Oxfmt
- `npm run format:check`
  Check formatting with Oxfmt
- `npm run typecheck`
  React Router typegen + TypeScript check
- `npm test`
  Run the test suite

## Environment Variables

There are two env contexts:

1. local CLI / local dev / remote push
2. deployed Worker runtime

### Local `.env`

These are needed locally:

- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SHOPIFY_APP_URL`
- `SCOPES`
- `SHOP_CUSTOM_DOMAIN` optional
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_DATABASE_ID`
- `CLOUDFLARE_D1_TOKEN`
- `CLOUDFLARE_API_TOKEN` optional for non-interactive Wrangler operations

Example:

```bash
SHOPIFY_API_KEY=...
SHOPIFY_API_SECRET=...
SHOPIFY_APP_URL=https://your-dev-url.example.com
SCOPES=read_content,write_content,read_metaobject_definitions,read_metaobjects,read_products,write_metaobject_definitions,write_metaobjects,write_products
SHOP_CUSTOM_DOMAIN=

CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_DATABASE_ID=...
CLOUDFLARE_D1_TOKEN=...
CLOUDFLARE_API_TOKEN=...
```

Drizzle Kit reads from `.env` because [drizzle.config.ts](/Users/arnaud/code/mcp-shopify-app/app-test/drizzle.config.ts) imports `dotenv/config`.

### Deployed Worker vars and secrets

Worker vars in [wrangler.jsonc](/Users/arnaud/code/mcp-shopify-app/app-test/wrangler.jsonc):

- `NODE_ENV`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_DATABASE_ID`
- `SCOPES`

Worker secrets used by the deployed app runtime:

- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SHOPIFY_APP_URL`

Optional Worker secret for remote D1 HTTP tooling only:

- `CLOUDFLARE_D1_TOKEN`

The deployed Worker app code uses the `DB` binding when it is available, including in production. The D1 token is still useful for Drizzle Kit and other remote HTTP database tooling.

Do not commit secrets to the repo.

## Local Development Flow

This starter is optimized for:

- `shopify app dev` for app iteration
- a local D1 binding for local data
- explicit remote push only when you are ready

The local flow is:

1. Install dependencies:

```bash
pnpm install
```

2. Ensure your local `.env` is populated.

3. Start local development:

```bash
pnpm run dev
```

What happens:

- Shopify CLI starts the local app flow
- `shopify.web.toml` runs `npm run db:push:local` before the app starts
- the app serves through `react-router dev`
- the DB layer detects local development and uses a local D1 binding
- local D1 data persists under `.wrangler/state`

If you change the schema:

1. Update [app/db/schema.ts](/Users/arnaud/code/mcp-shopify-app/app-test/app/db/schema.ts)
2. Run:

```bash
npm run db:push:local
```

3. Validate the feature locally
4. When ready, push the same schema remotely:

```bash
npm run db:push:remote
```

5. Deploy code if needed:

```bash
npm run deploy:worker
```

Important rule:

- local schema iteration uses `db:push:local`
- remote schema updates use `db:push:remote`
- do not use Drizzle migration files as the normal workflow in this starter

## How to Use This Repo as a Starter

### 1. Copy and install

```bash
pnpm install
```

### 2. Rename the app

Update:

- [package.json](/Users/arnaud/code/mcp-shopify-app/app-test/package.json)
  `name`
- [wrangler.jsonc](/Users/arnaud/code/mcp-shopify-app/app-test/wrangler.jsonc)
  `name`
- [shopify.app.toml](/Users/arnaud/code/mcp-shopify-app/app-test/shopify.app.toml)
  `name`

### 3. Create the Shopify app

Create a new app in Shopify Partner Dashboard / Dev Dashboard.

Recommended operating model for this repo:

- keep the repo private
- create one new Shopify app per store/app install target
- create one new Cloudflare Worker deployment per Shopify app
- configure the Shopify app in Partner Dashboard instead of maintaining a new local `shopify.app.*.toml` file for every app
- reuse the stable D1 binding and database ID across deployments unless you explicitly want isolation

In practice, each deployment gets its own:

- Shopify app `client_id`
- Shopify app secret
- Worker name / URL
- Worker secrets

Shared across deployments by default:

- Cloudflare D1 database and binding
- D1 schema
- D1 HTTP token, if you are operating one shared environment for remote tooling

Do not commit the Shopify app secret. Keep it only in local env and Cloudflare secrets.

### 4. Create the D1 database

```bash
CLOUDFLARE_ACCOUNT_ID=... npx wrangler d1 create your-app-db --location weur
```

Copy the database ID and update:

- [wrangler.jsonc](/Users/arnaud/code/mcp-shopify-app/app-test/wrangler.jsonc)
  `vars.CLOUDFLARE_DATABASE_ID`
- local `.env`
  `CLOUDFLARE_DATABASE_ID`

For normal multi-store usage of this repo, do this once and keep the same database ID stable across store-specific Worker deployments.

### 5. Configure Wrangler local binding metadata

Set the D1 binding entry in [wrangler.jsonc](/Users/arnaud/code/mcp-shopify-app/app-test/wrangler.jsonc):

- `binding = "DB"`
- `database_id = "<remote-db-id>"`
- `preview_database_id = "<remote-db-id>"`

The local DB remains local; the shared ID is used only to keep local tooling aligned.

### 6. Create the Cloudflare API token

Create a token with:

- D1 permissions sufficient for remote HTTP access
- Workers permissions sufficient for deployment and secret management

Set locally:

- `CLOUDFLARE_D1_TOKEN`
- optionally `CLOUDFLARE_API_TOKEN`

### 7. First schema push

Local:

```bash
npm run db:push:local
```

Remote:

```bash
npm run db:push:remote
```

### 8. First Worker deploy

Set runtime secrets:

```bash
printf '%s' 'your-shopify-api-key' | npx wrangler secret put SHOPIFY_API_KEY
printf '%s' 'your-shopify-api-secret' | npx wrangler secret put SHOPIFY_API_SECRET
printf '%s' 'https://your-worker-url.workers.dev' | npx wrangler secret put SHOPIFY_APP_URL
```

If you also want to run remote D1 HTTP tooling from that environment, set:

```bash
printf '%s' 'your-d1-http-token' | npx wrangler secret put CLOUDFLARE_D1_TOKEN
```

Deploy:

```bash
npm run deploy:worker
```

### 9. Configure the app in Partner Dashboard

Once the Worker is live, update the Shopify app manually in Partner Dashboard:

- App URL: your Worker URL
- Allowed redirection URL(s): `https://your-worker-url/auth/callback`
- Webhook endpoints, if used
- Privacy policy URL
- Scopes

This repo does not need a new Shopify TOML file for every duplicated app if you choose to manage those settings directly in the dashboard.

## Tooling Baseline

This starter uses:

- TypeScript
- Oxlint
- Oxfmt

It does not use ESLint or Prettier.

Recommended checks before a deploy:

```bash
npm run lint
npm run format:check
npm run typecheck
npm test
```
