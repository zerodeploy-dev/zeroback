import type { AsyncSqlApi } from "../types"

/**
 * Cloudflare D1 types (subset used by Zeroback).
 * These mirror the official workerd type definitions.
 */
export interface D1Database {
  prepare(query: string): D1PreparedStatement
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>
  exec(query: string): Promise<{ count: number; duration: number }>
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = Record<string, unknown>>(): Promise<T | null>
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>
}

export interface D1Result<T = unknown> {
  success: boolean
  meta: Record<string, unknown>
  results: T[]
}

/**
 * Wrap a Cloudflare D1Database as an AsyncSqlApi.
 * Maps `db.prepare(query).bind(...).all()` to the `{ toArray() }` interface
 * used by Zeroback's reader/writer/query planner.
 */
export function createD1SqlApi(db: D1Database): AsyncSqlApi {
  return {
    async exec(query: string, ...bindings: unknown[]) {
      const stmt = db.prepare(query)
      const bound = bindings.length > 0 ? stmt.bind(...bindings) : stmt
      const result = await bound.all<Record<string, unknown>>()
      return {
        toArray(): Record<string, unknown>[] {
          return result.results as Record<string, unknown>[]
        },
      }
    },
  }
}
