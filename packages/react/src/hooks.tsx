import { useState, useEffect, useCallback, useContext, createContext, useSyncExternalStore, useRef } from "react";
import { ZerobackClient, QueryStore, subscribePaginationPages, computeStatus } from "@zeroback/client";
import type { ConnectionState, LocalStore, FunctionReference, PaginationStatus, Preloaded, AuthUser } from "@zeroback/client";

const ZerobackContext = createContext<ZerobackClient | null>(null);

export interface ZerobackProviderProps {
  children: React.ReactNode;
  client: ZerobackClient;
}

export function ZerobackProvider({ children, client }: ZerobackProviderProps): React.JSX.Element {
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
  args?: Ref["_args"],
  opts?: { enabled?: boolean }
): Ref["_returns"] | undefined {
  const enabled = opts?.enabled !== false
  const client = useZerobackClient();
  const argsStr = JSON.stringify(args ?? {});
  const queryKey = QueryStore.makeKey(ref._name, args ?? {});

  // Manage WS subscription lifecycle
  useEffect(() => {
    if (!enabled) return
    const unsubscribe = client.subscribe(ref._name, args ?? {});
    return unsubscribe;
  }, [client, ref._name, argsStr, enabled]);

  // Read from centralized store with granular re-renders.
  // Only this component re-renders when this specific query key changes.
  const subscribe = useCallback(
    (cb: () => void) => {
      if (!enabled) return () => {}
      return client.watchQuery(queryKey, cb)
    },
    [client, queryKey, enabled],
  );
  const getSnapshot = useCallback(
    () => {
      if (!enabled) return undefined
      return client.getQueryResult(queryKey) as Ref["_returns"] | undefined
    },
    [client, queryKey, enabled],
  );
  const getServerSnapshot = useCallback(
    (): Ref["_returns"] | undefined => {
      if (!enabled) return undefined
      throw new Error(
        "useQuery cannot be used during SSR. Use preloadQuery in your loader and usePreloadedQuery in your component instead."
      )
    },
    [enabled]
  );

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useQueryWithStatus<Ref extends FunctionReference<"query", any, any>>(
  ref: Ref,
  args?: Ref["_args"],
  opts?: { enabled?: boolean }
): { data: Ref["_returns"] | undefined; isStale: boolean; isLoading: boolean } {
  const client = useContext(ZerobackContext);
  const data = useQuery(ref, args, opts);
  const queryKey = QueryStore.makeKey(ref._name, args ?? {});
  const isLoading = data === undefined;
  const isStale = !isLoading && !(client?.hasServerResult(queryKey) ?? false);

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
    client.setServerResult(queryKey, preloaded._result)
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
  // Use context directly (returns null on server) rather than useZerobackClient()
  // which throws. The client is only needed when the returned function is called,
  // which only happens on the client after user interaction.
  const clientRef = useRef(useContext(ZerobackContext));
  clientRef.current = useContext(ZerobackContext);
  const optimisticUpdateRef = useRef(opts?.optimisticUpdate);
  optimisticUpdateRef.current = opts?.optimisticUpdate;
  const refNameRef = useRef(ref._name);
  refNameRef.current = ref._name;

  return useCallback(
    async (args: Ref["_args"]): Promise<Ref["_returns"]> => {
      if (!clientRef.current) throw new Error("useMutation must be used within a ZerobackProvider");
      const ouFn = optimisticUpdateRef.current;
      return await clientRef.current.mutation(
        refNameRef.current,
        args,
        ouFn ? { optimisticUpdate: (store) => ouFn(store, args) } : undefined,
      ) as Ref["_returns"];
    },
    []
  );
}

export function useAction<Ref extends FunctionReference<"action", any, any>>(
  ref: Ref
): (args: Ref["_args"]) => Promise<Ref["_returns"]> {
  const clientRef = useRef(useContext(ZerobackContext));
  clientRef.current = useContext(ZerobackContext);
  const refNameRef = useRef(ref._name);
  refNameRef.current = ref._name;

  return useCallback(
    async (args: Ref["_args"]): Promise<Ref["_returns"]> => {
      if (!clientRef.current) throw new Error("useAction must be used within a ZerobackProvider");
      return await clientRef.current.action(refNameRef.current, args) as Ref["_returns"];
    },
    []
  );
}

export function useConnectionState(): ConnectionState {
  const client = useContext(ZerobackContext);

  return useSyncExternalStore(
    (onStoreChange) => client ? client.onConnectionChange(onStoreChange) : () => {},
    () => client ? client.connectionState : "disconnected" as ConnectionState,
    () => "disconnected" as ConnectionState
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
  opts: { initialNumItems: number; enabled?: boolean }
): UsePaginatedQueryResult<Ref["_returns"] extends Array<infer Item> ? Item : Ref["_returns"]> {
  type Item = Ref["_returns"] extends Array<infer I> ? I : Ref["_returns"];
  const enabled = opts?.enabled !== false
  const client = useContext(ZerobackContext);
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
    if (!client || !enabled) return;
    const unsubscribes = subscribePaginationPages(
      client, ref._name, argsKey, pageCount, cursors, numItemsPerPage,
      { setPages, setCursors, setIsDone, setNumItemsPerPage },
    );

    return () => {
      for (const unsub of unsubscribes) unsub();
    };
  }, [client, ref._name, argsKey, pageCount, JSON.stringify(cursors.slice(0, pageCount)), JSON.stringify(numItemsPerPage), enabled]);

  const results = enabled ? pages.flat() : [];
  const status = enabled ? computeStatus(pages, isDone) : "LoadingFirstPage" as PaginationStatus;

  const loadMore = useCallback((numItems: number) => {
    setNumItemsPerPage((prev) => [...prev, numItems]);
  }, []);

  return { results, status, loadMore };
}

export function useAuth(): {
  isLoading: boolean
  isAuthenticated: boolean
  user: AuthUser | null
  signOut: () => Promise<void>
} {
  const client = useZerobackClient()

  if (!client.auth) {
    throw new Error("useAuth() requires auth: true in ZerobackClient options")
  }

  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    client.auth!.getSession().then((session) => {
      if (!cancelled) {
        setUser(session?.user ?? null)
        setIsLoading(false)
      }
    }).catch(() => {
      if (!cancelled) {
        setUser(null)
        setIsLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [client])

  const signOut = useCallback(async () => {
    await client.auth!.signOut()
    setUser(null)
  }, [client])

  return {
    isLoading,
    isAuthenticated: user !== null,
    user,
    signOut,
  }
}
