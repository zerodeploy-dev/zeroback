# @zeroback/client

WebSocket client for Zeroback with auto-reconnect, subscription management, optimistic updates, mutation queue, IndexedDB persistence, and offline mutation replay.

## Installation

```bash
npm install @zeroback/client
```

## Usage

```ts
import { ZerobackClient } from "@zeroback/client"

const client = new ZerobackClient("ws://localhost:8788/ws")

// Subscribe to a query
const unsubscribe = client.subscribe("tasks:list", {}, (result) => {
  console.log("Tasks:", result)
})

// Call a mutation
await client.mutation("tasks:create", { text: "New task" })
```

## Documentation

Full documentation at [zeroback.dev/client](https://zeroback.dev/client/).

## Part of the Zeroback monorepo

[github.com/zerodeploy-dev/zeroback](https://github.com/zerodeploy-dev/zeroback)
