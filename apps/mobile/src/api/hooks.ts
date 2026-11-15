import {
  createContext,
  createElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { Client, Outcome } from "./client";
import type { DataOf, Operation } from "./operation";

const ClientContext = createContext<Client | null>(null);

export function ClientProvider(props: { readonly client: Client; readonly children?: ReactNode }) {
  return createElement(ClientContext.Provider, { value: props.client }, props.children);
}

export function useClient(): Client {
  const client = useContext(ClientContext);
  if (client === null) throw new Error("useClient needs a ClientProvider above it");
  return client;
}

export type QueryState<Data> = { readonly status: "loading" } | Outcome<Data>;

/** Runs a query on mount and whenever the document or variables change. `refetch` runs it again. */
export function useQuery<O extends Operation<unknown>>(
  operation: O,
): QueryState<DataOf<O>> & {
  readonly refetch: () => void;
} {
  const client = useClient();
  const [state, setState] = useState<QueryState<DataOf<O>>>({ status: "loading" });
  const [nonce, setNonce] = useState(0);
  // The operation travels as JSON, so the effect depends on its content, not on object identity.
  const key = JSON.stringify([operation, nonce]);

  useEffect(() => {
    let current = true;
    const [wanted] = JSON.parse(key) as [O, number];
    setState({ status: "loading" });
    client.execute(wanted).then((outcome) => {
      if (current) setState(outcome);
    });
    return () => {
      current = false;
    };
  }, [client, key]);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, refetch };
}

/** Returns a function that sends the mutation and resolves to its outcome. */
export function useMutation(): <O extends Operation<unknown>>(
  operation: O,
) => Promise<Outcome<DataOf<O>>> {
  const client = useClient();
  return useCallback((operation) => client.execute(operation), [client]);
}
