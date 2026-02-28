# CLI

The `vex` CLI manages development, code generation, and deployment of your Vex application.

## Commands

### `vex init [dir]`

Scaffold a new Vex project.

```
vex init [dir]
```

| Argument | Default | Description |
|----------|---------|-------------|
| `dir` | `"."` | Project directory |

**Creates:**

| File | Description |
|------|-------------|
| `vex/schema.ts` | Starter schema with a `messages` table |
| `vex/messages.ts` | Example query and mutation functions |
| `vex/_generated/server.ts` | Stub file so imports resolve before first codegen |
| `wrangler.toml` | Cloudflare Workers configuration (if not present) |
| `.gitignore` | Adds `.vex/` entry (creates or appends) |

Skips scaffolding if the `vex/` directory already exists.

**Example:**

```bash
mkdir my-app && cd my-app
npm init -y
vex init
```

### `vex dev [vexDir]`

Start the development server with hot reload.

```
vex dev [vexDir]
```

| Argument | Default | Description |
|----------|---------|-------------|
| `vexDir` | `"./vex"` | Path to your functions directory |

**Behavior:**

1. Copies runtime source files into `.vex/src/`
2. Analyzes schema and functions, generates types and bundles
3. Starts Wrangler dev server on **port 8788**
4. Watches `vex/` for changes (ignoring `_generated/` and `node_modules/`)
5. On file changes: re-analyzes, re-generates, re-bundles

**Generated files:**

| File | Description |
|------|-------------|
| `vex/_generated/api.ts` | Typed function references (`api.tasks.create`, etc.) |
| `vex/_generated/server.ts` | Typed function factories bound to your `DataModel` |
| `vex/_generated/dataModel.ts` | Standalone `DataModel` type |
| `.vex/src/_functions.generated.ts` | Bundled user functions + schema for the runtime |

**Example:**

```bash
vex dev
# or with a custom functions directory
vex dev ./src/vex
```

### `vex deploy [vexDir] [--dry-run] [-- wranglerArgs...]`

Build and deploy to Cloudflare.

```
vex deploy [vexDir] [--dry-run] [-- wranglerArgs...]
```

| Argument | Default | Description |
|----------|---------|-------------|
| `vexDir` | `"./vex"` | Path to your functions directory |
| `--dry-run` | `false` | Run codegen only, skip wrangler deploy |
| `-- args...` | — | Extra arguments passed through to `wrangler deploy` |

**Behavior:**

1. Runs codegen (same as `vex dev` build step)
2. If `--dry-run`: stops after codegen
3. Otherwise: runs `wrangler deploy` with any extra arguments

Requires `wrangler.toml` at the project root.

**Examples:**

```bash
# Deploy
vex deploy

# Dry run (codegen only)
vex deploy --dry-run

# Pass args to wrangler
vex deploy -- --env production
```

### `vex codegen [vexDir]`

Run code generation without starting a dev server.

```
vex codegen [vexDir]
```

| Argument | Default | Description |
|----------|---------|-------------|
| `vexDir` | `"./vex"` | Path to your functions directory |

Runs the same build step as `vex dev` (analyze, codegen, bundle) but exits immediately. Useful for CI or pre-commit hooks.

```bash
vex codegen
```

## Project Structure

After running `vex init` and `vex dev`, your project looks like:

```
my-app/
  vex/
    schema.ts              # Your schema definition
    messages.ts            # Your function files
    tasks.ts
    _generated/
      api.ts               # Generated: typed function references
      server.ts            # Generated: typed factories + DataModel
      dataModel.ts         # Generated: DataModel type
  .vex/                    # Generated: runtime worker files (gitignored)
    src/
      index.ts
      VexDO.ts
      _functions.generated.ts
      ...
  wrangler.toml            # Cloudflare Workers configuration
```

**Key conventions:**
- Function files go in `vex/` (any `.ts` file except `schema.ts` and files starting with `_`)
- Nested directories are supported: `vex/utils/stats.ts` produces function names like `"utils/stats:functionName"`
- Schema is always `vex/schema.ts`
- Never edit files in `vex/_generated/` or `.vex/` — they are overwritten on every build
