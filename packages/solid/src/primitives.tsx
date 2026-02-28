import {
  createContext,
  useContext,
  createSignal,
  createEffect,
  createMemo,
  on,
  onCleanup,
} from "solid-js";
import type { JSX, Accessor } from "solid-js";
import { ConvexClient, QueryStore } from "@zeroback/client";
import type { ConnectionState, LocalStore } from "@zeroback/client";
import type { FunctionReference } from "@zeroback/server";

const VexContext = createContext<ConvexClient>();

export interface ZerobackProviderProps {
  children: JSX.Element;
  client: ConvexClient;
}

export function ZerobackProvider(props: ZerobackProviderProps): JSX.Element {
  return (
    <VexContext.Provider value={props.client}>
      {props.children}
    </VexContext.Provider>
  );
}

export function useVexClient(): ConvexClient {
  const client = useContext(VexContext);
  if (!client) {
    throw new Error("useVexClient must be used within a ZerobackProvider");
  }
  return client;
}

export function createQuery<Ref extends FunctionReference<"query", any, any>>(
  ref: Ref,
  argsAccessor?: Accessor<Ref["_args"]> | Ref["_args"],
): Accessor<Ref["_returns"] | undefined> {
  const client = useVexClient();

  const resolveArgs = (): Ref["_args"] => {
    const raw = typeof argsAccessor === "function" ? (argsAccessor as Accessor<Ref["_args"]>)() : argsAccessor;
    return raw ?? {};
  };

  const [result, setResult] = createSignal<Ref["_returns"] | undefined>(undefined);

  createEffect(
    on(
      () => JSON.stringify(resolveArgs()),
      () => {
        const args = resolveArgs();
        const queryKey = QueryStore.makeKey(ref._name, args);

        // Subscribe to WS updates
        const unsubWs = client.subscribe(ref._name, args);

        // Watch the query store for changes
        const unsubStore = client.watchQuery(queryKey, () => {
          setResult(() => client.getQueryResult(queryKey) as Ref["_returns"] | undefined);
        });

        // Read initial value
        setResult(() => client.getQueryResult(queryKey) as Ref["_returns"] | undefined);

        onCleanup(() => {
          unsubWs();
          unsubStore();
        });
      },
    ),
  );

  return result;
}

export function createQueryWithStatus<Ref extends FunctionReference<"query", any, any>>(
  ref: Ref,
  argsAccessor?: Accessor<Ref["_args"]> | Ref["_args"],
): { data: Accessor<Ref["_returns"] | undefined>; isStale: Accessor<boolean>; isLoading: Accessor<boolean> } {
  const client = useVexClient();
  const data = createQuery(ref, argsAccessor);

  const resolveArgs = (): Ref["_args"] => {
    const raw = typeof argsAccessor === "function" ? (argsAccessor as Accessor<Ref["_args"]>)() : argsAccessor;
    return raw ?? {};
  };

  const isLoading = createMemo(() => data() === undefined);
  const isStale = createMemo(() => {
    if (isLoading()) return false;
    const queryKey = QueryStore.makeKey(ref._name, resolveArgs());
    return !client.hasServerResult(queryKey);
  });

  return { data, isStale, isLoading };
}

export function createMutation<Ref extends FunctionReference<"mutation", any, any>>(
  ref: Ref,
  opts?: {
    optimisticUpdate?: (store: LocalStore, args: Ref["_args"]) => void;
  },
): (args: Ref["_args"]) => Promise<Ref["_returns"]> {
  const client = useVexClient();
  // Plain variable — SolidJS components run once, no useRef needed
  let currentOptimisticUpdate = opts?.optimisticUpdate;

  return async (args: Ref["_args"]): Promise<Ref["_returns"]> => {
    const ouFn = currentOptimisticUpdate;
    return (await client.mutation(
      ref._name,
      args,
      ouFn ? { optimisticUpdate: (store) => ouFn(store, args) } : undefined,
    )) as Ref["_returns"];
  };
}

export function createAction<Ref extends FunctionReference<"action", any, any>>(
  ref: Ref,
): (args: Ref["_args"]) => Promise<Ref["_returns"]> {
  const client = useVexClient();

  return async (args: Ref["_args"]): Promise<Ref["_returns"]> => {
    return (await client.action(ref._name, args)) as Ref["_returns"];
  };
}

export function createConnectionState(): Accessor<ConnectionState> {
  const client = useVexClient();
  const [state, setState] = createSignal<ConnectionState>(client.connectionState);

  createEffect(() => {
    const unsub = client.onConnectionChange((newState) => {
      setState(newState);
    });
    onCleanup(unsub);
  });

  return state;
}

export type CreatePaginatedQueryResult<T> = {
  results: Accessor<T[]>;
  status: Accessor<"LoadingFirstPage" | "CanLoadMore" | "Exhausted">;
  loadMore: (numItems: number) => void;
};

export function createPaginatedQuery<Ref extends FunctionReference<"query", any, any>>(
  ref: Ref,
  argsAccessor: Accessor<Omit<Ref["_args"], "cursor" | "numItems">> | Omit<Ref["_args"], "cursor" | "numItems">,
  opts: { initialNumItems: number },
): CreatePaginatedQueryResult<any> {
  const client = useVexClient();

  const resolveArgs = () => {
    const raw = typeof argsAccessor === "function" ? (argsAccessor as Accessor<Record<string, unknown>>)() : argsAccessor;
    return raw ?? {};
  };

  const [pages, setPages] = createSignal<any[][]>([]);
  const [cursors, setCursors] = createSignal<(string | null)[]>([null]);
  const [isDone, setIsDone] = createSignal(false);
  const [numItemsPerPage, setNumItemsPerPage] = createSignal<number[]>([opts.initialNumItems]);

  // Reset when args change
  createEffect(
    on(
      () => JSON.stringify(resolveArgs()),
      () => {
        setPages([]);
        setCursors([null]);
        setIsDone(false);
        setNumItemsPerPage([opts.initialNumItems]);
      },
      { defer: true },
    ),
  );

  // Subscribe to each page
  createEffect(
    on(
      () => ({
        argsKey: JSON.stringify(resolveArgs()),
        pageCount: numItemsPerPage().length,
        cursorsSnapshot: JSON.stringify(cursors().slice(0, numItemsPerPage().length)),
        itemsSnapshot: JSON.stringify(numItemsPerPage()),
      }),
      ({ argsKey, pageCount }) => {
        const unsubscribes: (() => void)[] = [];
        const currentCursors = cursors();
        const currentNumItems = numItemsPerPage();

        for (let i = 0; i < pageCount; i++) {
          const cursor = currentCursors[i] ?? null;
          // Skip pages we don't have a cursor for yet (except page 0)
          if (i > 0 && cursor === undefined) break;

          const pageArgs: Record<string, unknown> = {
            ...JSON.parse(argsKey),
            numItems: currentNumItems[i],
          };
          if (cursor !== null && cursor !== undefined) {
            pageArgs.cursor = cursor;
          }
          const pageIndex = i;

          const unsub = client.subscribe(ref._name, pageArgs, (data: unknown) => {
            const result = data as {
              page: any[];
              continueCursor: string | null;
              isDone: boolean;
            };
            setPages((prev) => {
              const updated = [...prev];
              updated[pageIndex] = result.page;
              return updated;
            });

            // Update cursor for the next page
            if (
              pageIndex === currentCursors.length - 1 ||
              result.continueCursor !== currentCursors[pageIndex + 1]
            ) {
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

        onCleanup(() => {
          for (const unsub of unsubscribes) unsub();
        });
      },
    ),
  );

  const results = createMemo(() => pages().flat());

  const status = createMemo<"LoadingFirstPage" | "CanLoadMore" | "Exhausted">(() => {
    if (pages().length === 0) return "LoadingFirstPage";
    if (isDone()) return "Exhausted";
    return "CanLoadMore";
  });

  const loadMore = (numItems: number) => {
    setNumItemsPerPage((prev) => [...prev, numItems]);
  };

  return { results, status, loadMore };
}
