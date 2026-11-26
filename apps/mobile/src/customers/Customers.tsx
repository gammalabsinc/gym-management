import { useState } from "react";
import { AddMember } from "../members/AddMember";
import { EditMember } from "../members/EditMember";
import { PlaceholderScreen } from "../screens/PlaceholderScreen";
import { Button } from "../ui/Button";
import { CustomersScreen } from "./CustomersScreen";
import { useCustomersService } from "./context";
import { CustomerDetail } from "./detail/CustomerDetail";
import { useCustomers, useDebounced } from "./useCustomers";

export const SEARCH_DELAY_MS = 300;

type Route =
  | { readonly kind: "list" }
  | { readonly kind: "add" }
  | { readonly kind: "detail"; readonly id: string }
  /** Record payment is built in a later ticket. */
  | { readonly kind: "payment"; readonly id: string }
  | { readonly kind: "edit"; readonly id: string };

/** The Customers tab: the list, the detail of one customer, and add and edit member. Payment comes later. */
export function Customers(props: { readonly viewer: "staff" | "owner" }) {
  const service = useCustomersService();
  const [route, setRoute] = useState<Route>({ kind: "list" });
  const [search, setSearch] = useState("");
  const term = useDebounced(search, SEARCH_DELAY_MS);
  const list = useCustomers(service, term.trim());

  if (route.kind === "detail") {
    const { id } = route;
    return (
      <CustomerDetail
        id={id}
        viewer={props.viewer}
        onBack={() => setRoute({ kind: "list" })}
        onRecordPayment={() => setRoute({ kind: "payment", id })}
        onEdit={() => setRoute({ kind: "edit", id })}
      />
    );
  }
  if (route.kind === "add") {
    return (
      <AddMember
        onCancel={() => setRoute({ kind: "list" })}
        onDone={() => {
          setRoute({ kind: "list" });
          list.refresh();
        }}
      />
    );
  }
  if (route.kind === "edit") {
    const back: Route = { kind: "detail", id: route.id };
    return (
      <EditMember
        memberId={route.id}
        onCancel={() => setRoute(back)}
        onDone={() => setRoute(back)}
      />
    );
  }
  if (route.kind === "payment") {
    return (
      <>
        <PlaceholderScreen title="Record payment" />
        <Button
          label="Back to customer"
          kind="secondary"
          onPress={() => setRoute({ kind: "detail", id: route.id })}
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
