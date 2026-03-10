# @zeroback/react

React hooks for Zeroback: useQuery, useMutation, useAction, usePaginatedQuery, useQueryWithStatus, useConnectionState, and useZerobackClient.

## Installation

```bash
npm install @zeroback/react
```

## Usage

```tsx
import { ZerobackClient, ZerobackProvider, useQuery, useMutation } from "@zeroback/react"
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
  const tasks = useQuery(api.tasks.list)
  const createTask = useMutation(api.tasks.create)

  return (
    <div>
      <button onClick={() => createTask({ text: "New task" })}>Add</button>
      {tasks?.map((task) => <div key={task._id}>{task.text}</div>)}
    </div>
  )
}
```

## Documentation

Full documentation at [zeroback.dev/react](https://zeroback.dev/react/).

## Part of the Zeroback monorepo

[github.com/zerodeploy-dev/zeroback](https://github.com/zerodeploy-dev/zeroback)
