import type { UserIdentity } from "@zeroback/values"
import type { ClientMessage, ServerMessage } from "@zeroback/values"
import type { FunctionDef } from "./types"
import type { FunctionExecutor } from "./FunctionExecutor"
import type { TransactionStore } from "./transaction/TransactionStore"
import type { SubscriptionManager } from "./subscriptions/SubscriptionManager"
import type { ConnectionManager } from "./websocket/ConnectionManager"
import { executeMutation, type MutationDeps } from "./MutationExecutor"
import { ErrorCode, errorMessage, sendError } from "./errors"

export type WebSocketHandlerDeps = {
  functions: Record<string, FunctionDef>
  functionExecutor: FunctionExecutor
  transactions: TransactionStore
  subscriptions: SubscriptionManager
  connections: ConnectionManager
  getLatestTs: () => number
  getMutationDeps: () => MutationDeps
}

export class WebSocketHandler {
  private deps: WebSocketHandlerDeps
  private connectionIdentities = new Map<string, UserIdentity | null>()

  constructor(deps: WebSocketHandlerDeps) {
    this.deps = deps
  }

  setIdentity(connectionId: string, identity: UserIdentity | null): void {
    this.connectionIdentities.set(connectionId, identity)
  }

  async handleWsMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return

    const { connections } = this.deps
    const connId = connections.get(ws)
    if (!connId) return

    const msg = JSON.parse(message) as ClientMessage

    if (msg.type === "ping") {
      ws.send('{"type":"pong"}')
      return
    }

    if (!connections.checkRateLimit(connId)) {
      sendError(ws, undefined, ErrorCode.RATE_LIMITED, "Too many requests — slow down")
      return
    }

    switch (msg.type) {
      case "query": await this.handleQuery(connId, msg); break
      case "mutation": await this.handleMutation(connId, msg); break
      case "action": await this.handleAction(connId, msg); break
      case "unsubscribe": this.deps.subscriptions.remove(msg.id); break
    }
  }

  handleClose(ws: WebSocket): void {
    const { connections, subscriptions } = this.deps
    const connId = connections.get(ws)
    connections.remove(ws)
    subscriptions.removeAll(ws)
    if (connId) {
      this.connectionIdentities.delete(connId)
    }
  }

  private async handleQuery(connectionId: string, msg: { id: string; fn: string; args: unknown }): Promise<void> {
    const { functions, functionExecutor, connections, subscriptions, transactions } = this.deps
    const ws = connections.getById(connectionId)
    if (!ws) return

    const fn = functions[msg.fn]
    if (fn?.isInternal) {
      sendError(ws, msg.id, ErrorCode.FORBIDDEN, `Function "${msg.fn}" is internal and cannot be called from a client`)
      return
    }

    const identity = this.connectionIdentities.get(connectionId)
    const txId = crypto.randomUUID()
    transactions.begin(txId, this.deps.getLatestTs(), "query")

    try {
      const result = await functionExecutor.invokeFunction(msg.fn, msg.args, txId, identity)
      const resultJSON = JSON.stringify(result.result)

      subscriptions.subscribe({
        id: msg.id,
        connectionId,
        ws,
        fnName: msg.fn,
        args: msg.args,
        readSet: result.readSet,
        queryDescriptors: result.queryDescriptors,
        lastResultJSON: resultJSON,
        identity,
      })

      ws.send(`{"type":"result","id":${JSON.stringify(msg.id)},"result":${resultJSON}}`)
    } catch (e) {
      sendError(ws, msg.id, ErrorCode.EXECUTION_ERROR, errorMessage(e))
    } finally {
      transactions.remove(txId)
    }
  }

  private async handleMutation(connectionId: string, msg: { id: string; fn: string; args: unknown }): Promise<void> {
    const { functions, connections } = this.deps
    const ws = connections.getById(connectionId)
    if (!ws) return

    const fn = functions[msg.fn]
    if (fn?.isInternal) {
      sendError(ws, msg.id, ErrorCode.FORBIDDEN, `Function "${msg.fn}" is internal and cannot be called from a client`)
      return
    }

    const identity = this.connectionIdentities.get(connectionId)
    try {
      const result = await executeMutation(this.deps.getMutationDeps(), msg.fn, msg.args, identity)
      ws.send(JSON.stringify({ type: "mutationResult", id: msg.id, result } as ServerMessage))
    } catch (e) {
      const code = errorMessage(e).includes("Transaction conflict") ? ErrorCode.CONFLICT : ErrorCode.EXECUTION_ERROR
      sendError(ws, msg.id, code, errorMessage(e))
    }
  }

  private async handleAction(connectionId: string, msg: { id: string; fn: string; args: unknown }): Promise<void> {
    const { functions, functionExecutor, connections } = this.deps
    const ws = connections.getById(connectionId)
    if (!ws) return

    try {
      const fn = functions[msg.fn]
      if (!fn) throw new Error(`Function not found: ${msg.fn}`)
      if (fn.isInternal) {
        sendError(ws, msg.id, ErrorCode.FORBIDDEN, `Function "${msg.fn}" is internal and cannot be called from a client`)
        return
      }
      if (fn.type !== "action") throw new Error(`${msg.fn} is not an action`)

      const identity = this.connectionIdentities.get(connectionId)
      const actionCtx = functionExecutor.createActionCtx(identity)
      const result = await fn.handler(actionCtx, msg.args)

      ws.send(JSON.stringify({ type: "actionResult", id: msg.id, result } as ServerMessage))
    } catch (e) {
      sendError(ws, msg.id, ErrorCode.EXECUTION_ERROR, errorMessage(e))
    }
  }
}
