# @zeroback/solid

Solid.js bindings for Zeroback: createQuery, createMutation, createAction, createPaginatedQuery, createQueryWithStatus, createConnectionState, and useZerobackClient.

## Installation

```bash
npm install @zeroback/solid
```

## Usage

```tsx
import { ZerobackClient, ZerobackProvider, createQuery, createMutation } from "@zeroback/solid"
import { api } from "../zeroback/_generated/api"

const client = new ZerobackClient("ws://localhost:8788/ws")

function App() {
  return (
    <ZerobackProvider client={client}>
      <TaskList />
    </ZerobackProvider>
  )
}

function TaskList() {
  const tasks = createQuery(api.tasks.list)
  const createTask = createMutation(api.tasks.create)

  return (
    <div>
      <button onClick={() => createTask({ text: "New task" })}>Add</button>
      <For each={tasks()}>{(task) => <div>{task.text}</div>}</For>
    </div>
  )
}
```

## Documentation

Full documentation at [zeroback.dev/solid](https://zeroback.dev/solid/).

## Part of the Zeroback monorepo

[github.com/zerodeploy-dev/zeroback](https://github.com/zerodeploy-dev/zeroback)
