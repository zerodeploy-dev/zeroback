---
title: Deployment
description: Deploy your Zeroback backend to Cloudflare Workers.
---

Zeroback deploys to Cloudflare Workers with Durable Objects and SQLite. This guide walks through everything you need to go from local development to production.

## Prerequisites

- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) installed (auto-fetched by `npx`/`bunx` if not)

## Authentication

Before deploying, authenticate with Cloudflare:

**Interactive (local development):**

```bash
npx wrangler login
```

This opens your browser, prompts you to log in, and stores an OAuth token locally.

**Non-interactive (CI/CD):**

Set the `CLOUDFLARE_API_TOKEN` environment variable. Create an API token in the [Cloudflare dashboard](https://dash.cloudflare.com/profile/api-tokens) with the **Edit Cloudflare Workers** template.

```bash
export CLOUDFLARE_API_TOKEN=your-token-here
```

## Deploy

```bash
zeroback deploy
```

This runs codegen and then `wrangler deploy`. On first deploy, Cloudflare provisions a Worker and Durable Object namespace automatically.

Your backend will be available at `https://<worker-name>.<your-subdomain>.workers.dev`.

### Connect your client

Update your `ZerobackClient` to point to the production Worker URL. Replace `ws://localhost:8788/ws` with the deployed URL, using `wss://` for secure WebSocket:

```ts
const client = new ZerobackClient(
  process.env.NODE_ENV === "production"
    ? "wss://<worker-name>.<your-subdomain>.workers.dev/ws"
    : "ws://localhost:8788/ws"
)
```

Or use an environment variable (e.g. with Vite):

```ts
const client = new ZerobackClient(
  import.meta.env.VITE_ZEROBACK_URL ?? "ws://localhost:8788/ws"
)
```

```bash
# .env.production
VITE_ZEROBACK_URL=wss://<worker-name>.<your-subdomain>.workers.dev/ws
```

## Configuration

The `wrangler.toml` at your project root controls the deployment. It's scaffolded by `zeroback init`:

```toml
name = "my-app"
main = ".zeroback/entry.ts"
compatibility_date = "2026-02-24"

[durable_objects]
bindings = [{ name = "ZEROBACK_DO", class_name = "ZerobackDO" }]

[observability]
enabled = true

[[migrations]]
tag = "v1"
new_sqlite_classes = ["ZerobackDO"]
```

### Worker name

The `name` field determines your Worker's name on Cloudflare and its default URL. Change it to match your project.

### Custom domains

By default, your Worker is accessible on `*.workers.dev`. To use your own domain:

```toml
routes = [{ pattern = "api.example.com", custom_domain = true }]
```

The domain must be on your Cloudflare account. See [Cloudflare custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) for details.

### Environments

Use Wrangler environments to manage staging and production separately:

```toml
# Default: used by `zeroback deploy`
name = "my-app"

# Production: used by `zeroback deploy -- --env production`
[env.production]
name = "my-app-production"
routes = [{ pattern = "api.example.com", custom_domain = true }]

# Staging: used by `zeroback deploy -- --env staging`
[env.staging]
name = "my-app-staging"
```

Each environment gets its own Worker, Durable Object, and SQLite database.

### File storage

If your app uses file storage, create an R2 bucket and add the binding:

```bash
npx wrangler r2 bucket create my-app-storage
```

```toml
[[r2_buckets]]
binding = "ZEROBACK_STORAGE"
bucket_name = "my-app-storage"
```

## CI/CD

Example GitHub Actions workflow:

```yaml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bunx zeroback deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

## Dry run

To verify codegen without deploying:

```bash
zeroback deploy --dry-run
```

## Troubleshooting

**"Not logged in to Cloudflare"**
Run `npx wrangler login` or set `CLOUDFLARE_API_TOKEN`.

**"No wrangler.toml found"**
Run `zeroback init` to scaffold the config, or create it manually.

**"Durable Object migration required"**
If you change the Durable Object class name or add new classes, add a new `[[migrations]]` entry in `wrangler.toml`. See [Cloudflare DO migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/).
