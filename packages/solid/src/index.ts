export {
  VexProvider,
  useVexClient,
  createQuery,
  createQueryWithStatus,
  createMutation,
  createAction,
  createConnectionState,
  createPaginatedQuery,
} from "./primitives.js";
export type { CreatePaginatedQueryResult } from "./primitives.js";
export type { LocalStore, ConvexClientOptions, PersistenceAdapter, CachedEntry } from "@vex/client";
