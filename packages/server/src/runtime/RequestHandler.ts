import type { HttpActionHandler } from "@zeroback/server"
import type { UserIdentity } from "@zeroback/values"
import type { FunctionDef } from "./types"
import type { FunctionExecutor } from "./FunctionExecutor"
import type { TransactionStore } from "./transaction/TransactionStore"
import { executeMutation, type MutationDeps } from "./MutationExecutor"
import { ErrorCode, errorMessage } from "./errors"

export type RequestHandlerDeps = {
  functions: Record<string, FunctionDef>
  functionExecutor: FunctionExecutor
  transactions: TransactionStore
  getLatestTs: () => number
  getMutationDeps: () => MutationDeps
}

export class RequestHandler {
  private deps: RequestHandlerDeps

  constructor(deps: RequestHandlerDeps) {
    this.deps = deps
  }

  async handleAdminRun(req: Request): Promise<Response> {
    const json = { "Content-Type": "application/json" }
    try {
      const body = (await req.json()) as { fn: string; args?: unknown }
      const fnName = body.fn
      const args = body.args ?? {}

      const fn = this.deps.functions[fnName]
      if (!fn) {
        return new Response(
          JSON.stringify({ success: false, error: `Function not found: ${fnName}`, code: ErrorCode.NOT_FOUND }),
          { status: 404, headers: json }
        )
      }

      let result: unknown
      if (fn.type === "mutation") {
        result = await executeMutation(this.deps.getMutationDeps(), fnName, args)
      } else {
        const txId = crypto.randomUUID()
        this.deps.transactions.begin(txId, this.deps.getLatestTs(), "query")
        try {
          const invoked = await this.deps.functionExecutor.invokeFunction(fnName, args, txId)
          result = invoked.result
        } finally {
          this.deps.transactions.remove(txId)
        }
      }

      return new Response(
        JSON.stringify({ success: true, result }),
        { status: 200, headers: json }
      )
    } catch (e) {
      return new Response(
        JSON.stringify({ success: false, error: errorMessage(e), code: ErrorCode.EXECUTION_ERROR }),
        { status: 500, headers: json }
      )
    }
  }

  async handleQueryHttp(req: Request): Promise<Response> {
    const json = { "Content-Type": "application/json" }
    try {
      const body = (await req.json()) as { fn?: unknown; args?: unknown }
      const fnName = body.fn
      const args = body.args ?? {}

      if (!fnName || typeof fnName !== "string") {
        return new Response(
          JSON.stringify({ error: "Missing required field: fn", code: ErrorCode.BAD_REQUEST }),
          { status: 400, headers: json }
        )
      }

      const fn = this.deps.functions[fnName]
      if (!fn) {
        return new Response(
          JSON.stringify({ error: `Function not found: ${fnName}`, code: ErrorCode.NOT_FOUND }),
          { status: 404, headers: json }
        )
      }

      if (fn.isInternal) {
        return new Response(
          JSON.stringify({ error: `Function "${fnName}" is internal`, code: ErrorCode.FORBIDDEN }),
          { status: 403, headers: json }
        )
      }

      if (fn.type !== "query") {
        return new Response(
          JSON.stringify({ error: `"${fnName}" is not a query`, code: ErrorCode.BAD_REQUEST }),
          { status: 400, headers: json }
        )
      }

      const txId = crypto.randomUUID()
      this.deps.transactions.begin(txId, this.deps.getLatestTs(), "query")
      try {
        const { result } = await this.deps.functionExecutor.invokeFunction(fnName, args, txId)
        return new Response(JSON.stringify({ result }), { status: 200, headers: json })
      } finally {
        this.deps.transactions.remove(txId)
      }
    } catch (e) {
      return new Response(
        JSON.stringify({ error: errorMessage(e), code: ErrorCode.EXECUTION_ERROR }),
        { status: 500, headers: json }
      )
    }
  }

  async handleHttpAction(handler: HttpActionHandler, req: Request, identity?: UserIdentity | null): Promise<Response> {
    try {
      const ctx = this.deps.functionExecutor.createActionCtx(identity)
      return await handler(ctx, req)
    } catch (e) {
      console.error("HTTP action error:", e)
      return new Response(
        JSON.stringify({ error: errorMessage(e) }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      )
    }
  }
}
