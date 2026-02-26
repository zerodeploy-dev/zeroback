import { useState, useEffect, useCallback, useContext, createContext, useSyncExternalStore } from "react";
import { ConvexClient } from "@vex/client";
import type { ConnectionState } from "@vex/client";
import type { FunctionReference } from "@vex/server";

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
  const [result, setResult] = useState<Ref["_returns"] | undefined>(undefined);

  useEffect(() => {
    setResult(undefined);

    const callback = (data: unknown) => {
      setResult(data as Ref["_returns"]);
    };

    const unsubscribe = client.subscribe(ref._name, args ?? {}, callback);

    return () => {
      unsubscribe();
    };
  }, [client, ref._name, JSON.stringify(args)]);

  return result;
}

export function useMutation<Ref extends FunctionReference<"mutation", any, any>>(
  ref: Ref
): (args: Ref["_args"]) => Promise<Ref["_returns"]> {
  const client = useConvexClient();

  return useCallback(
    async (args: Ref["_args"]): Promise<Ref["_returns"]> => {
      return await client.mutation(ref._name, args) as Ref["_returns"];
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
