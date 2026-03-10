# @zeroback/values

Validator library for Zeroback with type-safe runtime validators and TypeScript type inference via the `Infer` helper.

## Installation

```bash
npm install @zeroback/values
```

## Usage

```ts
import { v } from "@zeroback/values"
import type { Infer } from "@zeroback/values"

const taskValidator = v.object({
  text: v.string(),
  completed: v.boolean(),
  tags: v.optional(v.array(v.string())),
  priority: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
})

type Task = Infer<typeof taskValidator>
// { text: string, completed: boolean, tags?: string[], priority: "low" | "medium" | "high" }
```

Available validators: `v.string()`, `v.number()`, `v.boolean()`, `v.object()`, `v.array()`, `v.optional()`, `v.union()`, `v.literal()`, `v.id()`, `v.record()`, `v.float64()`, `v.int64()`, `v.bytes()`, `v.null()`, `v.any()`.

## Documentation

Full documentation at [zeroback.dev/schema](https://zeroback.dev/schema/).

## Part of the Zeroback monorepo

[github.com/zerodeploy-dev/zeroback](https://github.com/zerodeploy-dev/zeroback)
