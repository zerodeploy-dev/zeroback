---
title: CLI
description: Scaffold, develop, deploy, and test your Zeroback backend from the terminal.
---

The `zeroback` CLI manages development, code generation, and deployment of your Zeroback application.

## Commands

### `zeroback init [dir]`

Scaffold a new Zeroback project.

```
zeroback init [dir]
```

| Argument | Default | Description |
|----------|---------|-------------|
| `dir` | `"."` | Project directory |

**Creates:**

| File | Description |
|------|-------------|
| `zeroback/schema.ts` | Starter schema with a `messages` table |
| `zeroback/messages.ts` | Example query and mutation functions |
| `zeroback/_generated/server.ts` | Stub file so imports resolve before first codegen |
| `wrangler.toml` | Cloudflare Workers configuration (if not present) |
| `.zeroback/entry.ts` | Worker entry point — imports manifest and wires to runtime |
| `.gitignore` | Ignores `.zeroback/*` except `entry.ts` (creates or appends) |

Skips scaffolding if the `zeroback/` directory already exists.

**Example:**

```bash
mkdir my-app && cd my-app
npm init -y
zeroback init
```

### `zeroback dev [functionsDir]`

Start the development server with hot reload.

```
zeroback dev [functionsDir]
```

| Argument | Default | Description |
|----------|---------|-------------|
| `functionsDir` | `"./zeroback"` | Path to your functions directory |

**Behavior:**

1. Scaffolds `.zeroback/entry.ts` if missing (worker entry point)
2. Analyzes schema and functions, generates types and `_generated/manifest.ts`
3. Starts Wrangler dev server on **port 8788**
4. Watches `zeroback/` for changes (ignoring `_generated/` and `node_modules/`)
5. On file changes: re-analyzes, re-generates manifest

**Generated files:**

| File | Description |
|------|-------------|
| `zeroback/_generated/api.ts` | Typed function references (`api.tasks.create`, etc.) |
| `zeroback/_generated/server.ts` | Typed function factories bound to your `DataModel` |
| `zeroback/_generated/dataModel.ts` | Standalone `DataModel` type |
| `zeroback/_generated/manifest.ts` | Function registrations, schema, HTTP router, cron jobs |

**Example:**

```bash
zeroback dev
# or with a custom functions directory
zeroback dev ./src/zeroback
```

### `zeroback deploy [functionsDir] [--dry-run] [-- wranglerArgs...]`

Build and deploy to Cloudflare.

```
zeroback deploy [functionsDir] [--dry-run] [-- wranglerArgs...]
```

| Argument | Default | Description |
|----------|---------|-------------|
| `functionsDir` | `"./zeroback"` | Path to your functions directory |
| `--dry-run` | `false` | Run codegen only, skip wrangler deploy |
| `-- args...` | — | Extra arguments passed through to `wrangler deploy` |

**Prerequisites:**

You must be authenticated with Cloudflare before deploying. Either:

- Run `wrangler login` to log in via your browser (recommended for local development)
- Set the `CLOUDFLARE_API_TOKEN` environment variable (recommended for CI/CD)

The deploy command will check authentication before deploying and provide guidance if you're not logged in.

**Behavior:**

1. Runs codegen (same as `zeroback dev` build step)
2. If `--dry-run`: stops after codegen
3. Verifies Cloudflare authentication
4. Runs `wrangler deploy` with any extra arguments

Requires `wrangler.toml` at the project root.

**Examples:**

```bash
# First-time setup: log in to Cloudflare
wrangler login

# Deploy
zeroback deploy

# Dry run (codegen only)
zeroback deploy --dry-run

# Pass args to wrangler
zeroback deploy -- --env production

# CI/CD: use an API token instead of interactive login
CLOUDFLARE_API_TOKEN=your-token zeroback deploy
```

### `zeroback codegen [functionsDir]`

Run code generation without starting a dev server.

```
zeroback codegen [functionsDir]
```

| Argument | Default | Description |
|----------|---------|-------------|
| `functionsDir` | `"./zeroback"` | Path to your functions directory |

Runs the same build step as `zeroback dev` (analyze, codegen, bundle) but exits immediately. Useful for CI or pre-commit hooks.

```bash
zeroback codegen
```

### `zeroback reset`

Reset the local development database.

```
zeroback reset
```

Deletes the `.wrangler/state` directory, which contains all local Durable Object and SQLite data. Restart `zeroback dev` afterwards to start with a fresh database.

```bash
zeroback reset
```

### `zeroback run <functionName> [jsonArgs] [--url <url>]`

Invoke a function (query, mutation, or action) on the running dev server.

```
zeroback run <functionName> [jsonArgs] [--url <url>]
```

| Argument | Default | Description |
|----------|---------|-------------|
| `functionName` | *(required)* | Function to call, e.g. `tasks:list` |
| `jsonArgs` | `{}` | JSON object of arguments |
| `--url` | `http://localhost:8788` | URL of the Zeroback server |

**Behavior:**

1. Sends a POST request to the server's `/__admin/run` endpoint
2. Executes the function and prints the JSON result to stdout
3. Both public and internal functions can be called (useful for debugging)

**Examples:**

```bash
# Run a query
zeroback run tasks:list

# Run a mutation with arguments
zeroback run tasks:create '{"title": "Buy groceries", "projectId": "proj:abc", "status": "todo"}'

# Run an internal function
zeroback run tasks:countInternal '{"projectId": "proj:abc"}'

# Target a deployed server
zeroback run tasks:list --url https://my-worker.example.com
```

## Project Structure

After running `zeroback init` and `zeroback dev`, your project looks like:

```
my-app/
  zeroback/
    schema.ts              # Your schema definition
    messages.ts            # Your function files
    tasks.ts
    _generated/
      api.ts               # Generated: typed function references
      server.ts            # Generated: typed factories + DataModel
      dataModel.ts         # Generated: DataModel type
  .zeroback/
    entry.ts               # Scaffolded by init, user-owned — imports manifest + wires to runtime
  wrangler.toml            # Cloudflare Workers configuration
```

**Key conventions:**
- Function files go in `zeroback/` (any `.ts` file except `schema.ts` and files starting with `_`)
- Nested directories are supported: `zeroback/utils/stats.ts` produces function names like `"utils/stats:functionName"`
- Schema is always `zeroback/schema.ts`
- Never edit files in `zeroback/_generated/` — they are overwritten on every build
- `.zeroback/entry.ts` is user-owned and can be customized (e.g. to add middleware or env bindings)
