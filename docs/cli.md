# CLI

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
| `.gitignore` | Adds `.zeroback/` entry (creates or appends) |

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

1. Generates `.zeroback/entry.ts` that wires user functions to `@zeroback/runtime`
2. Analyzes schema and functions, generates types
3. Starts Wrangler dev server on **port 8788**
4. Watches `zeroback/` for changes (ignoring `_generated/` and `node_modules/`)
5. On file changes: re-analyzes, re-generates, re-bundles

**Generated files:**

| File | Description |
|------|-------------|
| `zeroback/_generated/api.ts` | Typed function references (`api.tasks.create`, etc.) |
| `zeroback/_generated/server.ts` | Typed function factories bound to your `DataModel` |
| `zeroback/_generated/dataModel.ts` | Standalone `DataModel` type |
| `.zeroback/entry.ts` | Entry point that imports `@zeroback/runtime` and registers user functions |

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

**Behavior:**

1. Runs codegen (same as `zeroback dev` build step)
2. If `--dry-run`: stops after codegen
3. Otherwise: runs `wrangler deploy` with any extra arguments

Requires `wrangler.toml` at the project root.

**Examples:**

```bash
# Deploy
zeroback deploy

# Dry run (codegen only)
zeroback deploy --dry-run

# Pass args to wrangler
zeroback deploy -- --env production
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
  .zeroback/                    # Generated: entry point (gitignored)
    entry.ts               # Imports @zeroback/runtime, registers user functions
  wrangler.toml            # Cloudflare Workers configuration
```

**Key conventions:**
- Function files go in `zeroback/` (any `.ts` file except `schema.ts` and files starting with `_`)
- Nested directories are supported: `zeroback/utils/stats.ts` produces function names like `"utils/stats:functionName"`
- Schema is always `zeroback/schema.ts`
- Never edit files in `zeroback/_generated/` or `.zeroback/` — they are overwritten on every build
