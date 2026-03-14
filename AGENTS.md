# Agent Guidelines for Zeroback

## Build / Test / Lint Commands

```bash
# Install dependencies (run once)
bun install

# Run all tests (includes e2e + unit)
bun test

# Run specific test file
bun vitest run e2e/zeroback.test.ts

# Run single test by pattern
bun vitest run --testNamePattern="should insert a document"

# Watch mode for development
bun test:watch

# Type check all packages
bun run typecheck

# Build all packages
bun run build

# Build specific package
bun run --filter '@zeroback/server' build
```

## Code Style

### Formatting
- **TypeScript only** - no JavaScript files
- **ESM modules** (`"type": "module"` in all package.json)
- **No semicolons** - omit at end of statements
- **Single quotes** for strings (template literals when needed)
- **2 spaces** indentation
- **Trailing commas** in objects and arrays
- **100-120 char** line length (no strict limit)
- No explicit linting tools (no ESLint, Prettier, Biome configs)

### Imports
- Use `.js` extension for local imports: `import { foo } from "./bar.js"`
- Type imports separately: `import type { Foo } from "./types.js"`
- Re-export from index.ts with star exports: `export * from "./types.js"`
- Order: external deps → workspace deps → internal relative imports
- Use workspace path aliases (e.g., `@zeroback/values`) over relative paths

### Types & Naming
- **PascalCase**: types, interfaces, classes (e.g., `Validator`, `QueryCtx`)
- **camelCase**: functions, variables, methods (e.g., `createValidator`)
- **UPPER_SNAKE_CASE**: constants (e.g., `TASK_DEFAULTS`)
- **Leading underscore**: internal/private properties (`_type`, `_doc`, `_name`)
- Prefer explicit types over `any`
- Use generics with constraints: `<F extends PropertyValidators>`

### Error Handling
- Throw descriptive errors: `throw new Error(\`Expected string, got \${typeof value}\`)`
- Use ErrorCode constants in runtime package for protocol errors
- Error messages should include context/values when possible
- In tests, use try/catch or expect().rejects for async errors

### Function Patterns
- Factory functions for creating typed objects: `createQueryFactory<DataModel>()`
- Fluent APIs use method chaining returning `this`
- Use pattern: `undefined as unknown as T` for type-only properties
- Return full objects from functions, destructure at call sites

### Testing
- Use vitest (`describe`, `it`, `expect`)
- 30s test timeout, 60s hook timeout configured
- E2E tests use WebSocket against local dev server (port 8788)
- Tests run sequentially (`fileParallelism: false`)

## Project Structure

```
packages/
  values/     - Validators and core types (v.string(), etc.)
  server/     - Schema, functions, database APIs
  runtime/    - Durable Object, WebSocket, subscriptions (@zeroback/runtime)
  client/     - ZerobackClient with WebSocket, optimistic updates
  react/      - React hooks: useQuery, useMutation
  cli/        - zeroback init/dev/deploy/codegen
  solid/      - SolidJS bindings (experimental)
examples/
  task-manager/ - E2E test project
e2e/          - Vitest e2e tests
```

## Publishing

- **Fixed versioning**: all packages share same version
- Use `bun publish` (resolves `workspace:^` to real versions)
- Run `bun scripts/publish.js` to publish all

## Key Architecture

- **Runtime**: ZerobackDO in packages/runtime handles state, transactions, subscriptions
- **Entry point**: Static `.zeroback/entry.ts` imports from `zeroback/_generated/manifest.ts`
- **Codegen**: Generates typed APIs from user's `zeroback/` directory
- **IDs**: ULID-based in `"tableName:ULID"` format
- **Storage**: SQLite with json_extract for filters, R2 for file storage
