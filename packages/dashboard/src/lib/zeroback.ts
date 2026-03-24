import { ZerobackClient } from "@zeroback/react"
import type { RegisteredQuery, RegisteredMutation, RegisteredAction } from "@zeroback/server"

// Derive WS URL from current page location
function getWsUrl(): string {
  const loc = window.location
  const protocol = loc.protocol === "https:" ? "wss:" : "ws:"
  // Dashboard is served at /_dashboard on the same origin as the runtime
  return `${protocol}//${loc.host}/ws`
}

export const client = new ZerobackClient(getWsUrl())

// ── Return types for system functions ────────────────────────────────────────

export type ValidatorInfo = { type: string; value?: ValidatorInfo; [key: string]: unknown }

export type TableInfo = {
  fields: Record<string, ValidatorInfo>
  indexes: { name: string; fields: string[] }[]
  searchIndexes?: { name: string; searchField: string }[]
}

export type SchemaResult = {
  tables: Record<string, TableInfo>
}

export type DocRow = Record<string, unknown> & { _id: string; _creationTime: number }

export type ListDocumentsResult = {
  page: DocRow[]
  continueCursor: string | null
  isDone: boolean
}

export type RunSQLResult = {
  rows: Record<string, unknown>[]
  columns: string[]
}

// ── Function reference constructors ──────────────────────────────────────────
// _args and _returns are phantom type fields used only for type inference by
// useQuery/useMutation/useAction hooks — they are never read at runtime.
// We use `null!` (type `never`, assignable to any type) to avoid `as` casts.

function sysQuery<Returns>(name: string): RegisteredQuery<Record<string, unknown>, Returns> {
  return { _name: name, _type: "query", _isInternal: false, _args: null!, _returns: null! }
}

function sysMutation<Returns>(name: string): RegisteredMutation<Record<string, unknown>, Returns> {
  return { _name: name, _type: "mutation", _isInternal: false, _args: null!, _returns: null! }
}

function sysAction<Returns>(name: string): RegisteredAction<Record<string, unknown>, Returns> {
  return { _name: name, _type: "action", _isInternal: false, _args: null!, _returns: null! }
}

export const api = {
  getSchema: sysQuery<SchemaResult>("_system:getSchema"),
  getTableCount: sysQuery<number>("_system:getTableCount"),
  listDocuments: sysQuery<ListDocumentsResult>("_system:listDocuments"),
  getDocument: sysQuery<DocRow | null>("_system:getDocument"),
  runSQL: sysAction<RunSQLResult>("_system:runSQL"),
  insertDocument: sysMutation<string>("_system:insertDocument"),
  updateDocument: sysMutation<void>("_system:updateDocument"),
  deleteDocument: sysMutation<void>("_system:deleteDocument"),
}
