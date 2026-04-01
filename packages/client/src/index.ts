export { ZerobackClient } from "./ZerobackClient.js";
export type { ConnectionState, ZerobackClientOptions } from "./ZerobackClient.js";
export { SubscriptionRegistry } from "./SubscriptionRegistry.js";
export { Backoff, type BackoffOptions } from "./Backoff.js";
export { QueryStore } from "./QueryStore.js";
export type { LocalStore } from "./QueryStore.js";
export type { ClientMessage, ServerMessage } from "@zeroback/values";
export type { FunctionReference } from "@zeroback/server";
export type { PersistenceAdapter, CachedEntry } from "./persistence/PersistenceAdapter.js";
export { IDBPersistence } from "./persistence/IDBPersistence.js";
export { MutationQueue } from "./persistence/MutationQueue.js";
export {
  subscribePaginationPages,
  resetPagination,
  computeStatus,
  initialPaginationState,
  type PaginationStatus,
  type PaginationState,
  type PaginationCallbacks,
} from "./PaginationCore.js"
export { preloadQuery } from "./preloadQuery.js"
export type { Preloaded } from "./preloadQuery.js"
