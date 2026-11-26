import { useState } from "react";
import { PlaceholderScreen } from "../screens/PlaceholderScreen";
import { Button } from "../ui/Button";
import { CustomersScreen } from "./CustomersScreen";
import { useCustomersService } from "./context";
import { useCustomers, useDebounced } from "./useCustomers";

export const SEARCH_DELAY_MS = 300;

type Route =
  | { readonly kind: "list" }
  | { readonly kind: "add" }
  | { readonly kind: "detail"; readonly id: string };

/** The Customers tab. Add member and the customer detail are built in later tickets. */
export function Customers() {
  const service = useCustomersService();
  const [route, setRoute] = useState<Route>({ kind: "list" });
  const [search, setSearch] = useState("");
  const term = useDebounced(search, SEARCH_DELAY_MS);
  const list = useCustomers(service, term.trim());

  if (route.kind !== "list") {
    return (
      <>
        <PlaceholderScreen title={route.kind === "add" ? "Add member" : "Customer"} />
        <Button
          label="Back to customers"
          kind="secondary"
          onPress={() => setRoute({ kind: "list" })}
        />
      </>
    );
  }
  return (
    <CustomersScreen
      state={list.state}
      refreshing={list.refreshing}
      search={search}
      onSearch={setSearch}
      onAdd={() => setRoute({ kind: "add" })}
      onOpen={(id) => setRoute({ kind: "detail", id })}
      onRefresh={list.refresh}
      onRetry={list.retry}
      onEndReached={list.loadMore}
    />
  );
}
