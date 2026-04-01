import { useState, useEffect, useCallback, useContext, createContext, useSyncExternalStore, useRef } from "react";
import { ZerobackClient, QueryStore, subscribePaginationPages, computeStatus } from "@zeroback/client";
import type { ConnectionState, LocalStore, FunctionReference, PaginationStatus, Preloaded } from "@zeroback/client";

const ZerobackContext = createContext<ZerobackClient | null>(null);

export interface ZerobackProviderProps {
  children: React.ReactNode;
  client: ZerobackClient;
}

export function ZerobackProvider({ children, client }: ZerobackProviderProps): JSX.Element {
  return (
    <ZerobackContext.Provider value={client}>
      {children}
    </ZerobackContext.Provider>
  );
}

export function useZerobackClient(): ZerobackClient {
  const client = useContext(ZerobackContext);
  if (!client) {
    throw new Error("useZerobackClient must be used within a ZerobackProvider");
  }
  return client;
}

export function useQuery<Ref extends FunctionReference<"query", any, any>>(
  ref: Ref,
  args?: Ref["_args"]
): Ref["_returns"] | undefined {
  const client = useZerobackClient();
  const argsStr = JSON.stringify(args ?? {});
  const queryKey = QueryStore.makeKey(ref._name, args ?? {});

  // Manage WS subscription lifecycle
  useEffect(() => {
    const unsubscribe = client.subscribe(ref._name, args ?? {});
    return unsubscribe;
  }, [client, ref._name, argsStr]);

  // Read from centralized store with granular re-renders.
  // Only this component re-renders when this specific query key changes.
  const subscribe = useCallback(
    (cb: () => void) => client.watchQuery(queryKey, cb),
    [client, queryKey],
  );
  const getSnapshot = useCallback(
    () => client.getQueryResult(queryKey) as Ref["_returns"] | undefined,
    [client, queryKey],
  );

  return useSyncExternalStore(subscribe, getSnapshot);
}

export function useQueryWithStatus<Ref extends FunctionReference<"query", any, any>>(
  ref: Ref,
  args?: Ref["_args"]
): { data: Ref["_returns"] | undefined; isStale: boolean; isLoading: boolean } {
  const client = useZerobackClient();
  const data = useQuery(ref, args);
  const queryKey = QueryStore.makeKey(ref._name, args ?? {});
  const isLoading = data === undefined;
  const isStale = !isLoading && !client.hasServerResult(queryKey);

  return { data, isStale, isLoading };
}

/**
 * Subscribe to a query with preloaded SSR data. Starts with the preloaded result
 * (never undefined) and subscribes to real-time WebSocket updates after hydration.
 *
 * Note: on mount this seeds the QueryStore with the preloaded result and marks it
 * as server-confirmed. Any sibling `useQueryWithStatus` on the same query will
 * immediately report `isStale: false` — this is correct since the data came from
 * the server.
 */
export function usePreloadedQuery<Ref extends FunctionReference<"query", any, any>>(
  preloaded: Preloaded<Ref>
): Ref["_returns"] {
  const client = useContext(ZerobackContext)
  const argsStr = JSON.stringify(preloaded._args ?? {})
  const queryKey = QueryStore.makeKey(preloaded._fn, preloaded._args ?? {})

  // On mount: seed the QueryStore with the preloaded result, then subscribe.
  // Skipped on SSR (client is null) and runs only in the browser.
  useEffect(() => {
    if (!client) return
    client.queryStore.setServerResult(queryKey, preloaded._result)
    const unsubscribe = client.subscribe(preloaded._fn, preloaded._args ?? {})
    return unsubscribe
  }, [client, preloaded._fn, argsStr, queryKey])

  const subscribe = useCallback(
    (cb: () => void) => {
      if (!client) return () => {}
      return client.watchQuery(queryKey, cb)
    },
    [client, queryKey],
  )

  // On the client: return store result (may be updated by WS), falling back to preloaded.
  const getSnapshot = useCallback(
    () => (client
      ? (client.getQueryResult(queryKey) ?? preloaded._result) as Ref["_returns"]
      : preloaded._result as Ref["_returns"]
    ),
    [client, queryKey, preloaded._result],
  )

  // On the server: always return the preloaded result — never undefined.
  const getServerSnapshot = useCallback(
    () => preloaded._result as Ref["_returns"],
    [preloaded._result],
  )

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

export function useMutation<Ref extends FunctionReference<"mutation", any, any>>(
  ref: Ref,
  opts?: {
    optimisticUpdate?: (store: LocalStore, args: Ref["_args"]) => void;
  },
): (args: Ref["_args"]) => Promise<Ref["_returns"]> {
  const client = useZerobackClient();
  const optimisticUpdateRef = useRef(opts?.optimisticUpdate);
  optimisticUpdateRef.current = opts?.optimisticUpdate;

  return useCallback(
    async (args: Ref["_args"]): Promise<Ref["_returns"]> => {
      const ouFn = optimisticUpdateRef.current;
      return await client.mutation(
        ref._name,
        args,
        ouFn ? { optimisticUpdate: (store) => ouFn(store, args) } : undefined,
      ) as Ref["_returns"];
    },
    [client, ref._name]
  );
}

export function useAction<Ref extends FunctionReference<"action", any, any>>(
  ref: Ref
): (args: Ref["_args"]) => Promise<Ref["_returns"]> {
  const client = useZerobackClient();

  return useCallback(
    async (args: Ref["_args"]): Promise<Ref["_returns"]> => {
      return await client.action(ref._name, args) as Ref["_returns"];
    },
    [client, ref._name]
  );
}

export function useConnectionState(): ConnectionState {
  const client = useZerobackClient();

  return useSyncExternalStore(
    (onStoreChange) => client.onConnectionChange(onStoreChange),
    () => client.connectionState
  );
}

export type UsePaginatedQueryResult<T> = {
  results: T[];
  status: PaginationStatus;
  loadMore: (numItems: number) => void;
};

export function usePaginatedQuery<Ref extends FunctionReference<"query", any, any>>(
  ref: Ref,
  args: Omit<Ref["_args"], "cursor" | "numItems">,
  opts: { initialNumItems: number }
): UsePaginatedQueryResult<Ref["_returns"] extends Array<infer Item> ? Item : Ref["_returns"]> {
  type Item = Ref["_returns"] extends Array<infer I> ? I : Ref["_returns"];
  const client = useZerobackClient();
  const [pages, setPages] = useState<Item[][]>([]);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [isDone, setIsDone] = useState(false);
  const [numItemsPerPage, setNumItemsPerPage] = useState<number[]>([opts.initialNumItems]);
  const argsKey = JSON.stringify(args);

  // Reset when args change
  const prevArgsKey = useRef(argsKey);
  useEffect(() => {
    if (prevArgsKey.current !== argsKey) {
      prevArgsKey.current = argsKey;
      setPages([]);
      setCursors([null]);
      setIsDone(false);
      setNumItemsPerPage([opts.initialNumItems]);
    }
  }, [argsKey, opts.initialNumItems]);

  // Subscribe to each page
  const pageCount = numItemsPerPage.length;
  useEffect(() => {
    const unsubscribes = subscribePaginationPages(
      client, ref._name, argsKey, pageCount, cursors, numItemsPerPage,
      { setPages, setCursors, setIsDone, setNumItemsPerPage },
    );

    return () => {
      for (const unsub of unsubscribes) unsub();
    };
  }, [client, ref._name, argsKey, pageCount, JSON.stringify(cursors.slice(0, pageCount)), JSON.stringify(numItemsPerPage)]);

  const results = pages.flat();
  const status = computeStatus(pages, isDone);

  const loadMore = useCallback((numItems: number) => {
    setNumItemsPerPage((prev) => [...prev, numItems]);
  }, []);

  return { results, status, loadMore };
}
