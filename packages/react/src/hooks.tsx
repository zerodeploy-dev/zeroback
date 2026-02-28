import { useState, useEffect, useCallback, useContext, createContext, useSyncExternalStore, useRef } from "react";
import { ConvexClient, QueryStore } from "@zeroback/client";
import type { ConnectionState, LocalStore } from "@zeroback/client";
import type { FunctionReference } from "@zeroback/server";

const ConvexContext = createContext<ConvexClient | null>(null);

export interface ConvexProviderProps {
  children: React.ReactNode;
  client: ConvexClient;
}

export function ConvexProvider({ children, client }: ConvexProviderProps): JSX.Element {
  return (
    <ConvexContext.Provider value={client}>
      {children}
    </ConvexContext.Provider>
  );
}

export function useConvexClient(): ConvexClient {
  const client = useContext(ConvexContext);
  if (!client) {
    throw new Error("useConvexClient must be used within a ConvexProvider");
  }
  return client;
}

export function useQuery<Ref extends FunctionReference<"query", any, any>>(
  ref: Ref,
  args?: Ref["_args"]
): Ref["_returns"] | undefined {
  const client = useConvexClient();
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
  const client = useConvexClient();
  const data = useQuery(ref, args);
  const queryKey = QueryStore.makeKey(ref._name, args ?? {});
  const isLoading = data === undefined;
  const isStale = !isLoading && !client.hasServerResult(queryKey);

  return { data, isStale, isLoading };
}

export function useMutation<Ref extends FunctionReference<"mutation", any, any>>(
  ref: Ref,
  opts?: {
    optimisticUpdate?: (store: LocalStore, args: Ref["_args"]) => void;
  },
): (args: Ref["_args"]) => Promise<Ref["_returns"]> {
  const client = useConvexClient();
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
  const client = useConvexClient();

  return useCallback(
    async (args: Ref["_args"]): Promise<Ref["_returns"]> => {
      return await client.action(ref._name, args) as Ref["_returns"];
    },
    [client, ref._name]
  );
}

export function useConnectionState(): ConnectionState {
  const client = useConvexClient();

  return useSyncExternalStore(
    (onStoreChange) => client.onConnectionChange(onStoreChange),
    () => client.connectionState
  );
}

export type UsePaginatedQueryResult<T> = {
  results: T[];
  status: "LoadingFirstPage" | "CanLoadMore" | "Exhausted";
  loadMore: (numItems: number) => void;
};

export function usePaginatedQuery<Ref extends FunctionReference<"query", any, any>>(
  ref: Ref,
  args: Omit<Ref["_args"], "cursor" | "numItems">,
  opts: { initialNumItems: number }
): UsePaginatedQueryResult<any> {
  const client = useConvexClient();
  const [pages, setPages] = useState<any[][]>([]);
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
    const unsubscribes: (() => void)[] = [];

    for (let i = 0; i < pageCount; i++) {
      const cursor = cursors[i] ?? null;
      // Skip pages we don't have a cursor for yet (except page 0)
      if (i > 0 && cursor === undefined) break;

      const pageArgs: Record<string, unknown> = { ...JSON.parse(argsKey), numItems: numItemsPerPage[i] };
      if (cursor !== null && cursor !== undefined) {
        pageArgs.cursor = cursor;
      }
      const pageIndex = i;

      const unsub = client.subscribe(ref._name, pageArgs, (data: unknown) => {
        const result = data as { page: any[]; continueCursor: string | null; isDone: boolean };
        setPages((prev) => {
          const updated = [...prev];
          updated[pageIndex] = result.page;
          return updated;
        });

        // Update cursor for the next page
        if (pageIndex === cursors.length - 1 || result.continueCursor !== cursors[pageIndex + 1]) {
          setCursors((prev) => {
            const updated = [...prev];
            updated[pageIndex + 1] = result.continueCursor;
            return updated;
          });
        }

        if (result.isDone) {
          setIsDone(true);
        } else if (pageIndex === pageCount - 1) {
          setIsDone(false);
        }
      });

      unsubscribes.push(unsub);
    }

    return () => {
      for (const unsub of unsubscribes) unsub();
    };
  }, [client, ref._name, argsKey, pageCount, JSON.stringify(cursors.slice(0, pageCount)), JSON.stringify(numItemsPerPage)]);

  const results = pages.flat();

  const status: UsePaginatedQueryResult<any>["status"] =
    pages.length === 0
      ? "LoadingFirstPage"
      : isDone
        ? "Exhausted"
        : "CanLoadMore";

  const loadMore = useCallback((numItems: number) => {
    setNumItemsPerPage((prev) => [...prev, numItems]);
  }, []);

  return { results, status, loadMore };
}
