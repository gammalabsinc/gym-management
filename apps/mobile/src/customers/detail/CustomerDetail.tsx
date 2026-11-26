import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ErrorBlock, Skeleton } from "../../ui/blocks";
import { CustomerDetailScreen, type TabName } from "./CustomerDetailScreen";
import { useDetailService } from "./context";
import { PagedTab } from "./PagedTab";
import { ReasonSheet } from "./ReasonSheet";
import { DiscountCard, HistoryCard, InvoiceCard, PaymentCard, VisitCard } from "./rows";
import type { ActionResult, DetailHeader, HeaderResult, MemberStatus } from "./service";

export const FORBIDDEN_MESSAGE = "You do not have permission to do that.";

type Sheet =
  | { readonly kind: "status"; readonly to: MemberStatus }
  | { readonly kind: "voidPayment"; readonly id: string }
  | { readonly kind: "voidInvoice"; readonly id: string };

const SHEETS = {
  PAUSED: {
    title: "Pause membership?",
    description:
      "Pausing stops new invoices until you resume. Invoices and payments already recorded stay as they are.",
    confirm: "Pause membership",
    danger: false,
  },
  ACTIVE: {
    title: "Resume membership?",
    description: "Resuming starts new invoices again from today.",
    confirm: "Resume membership",
    danger: false,
  },
  CANCELLED: {
    title: "Cancel membership?",
    description:
      "Cancelling ends this membership for good. No new invoices are made and it cannot be resumed. Invoices, payments and visits already recorded stay.",
    confirm: "Cancel membership",
    danger: true,
  },
} as const;

function sheetText(sheet: Sheet) {
  if (sheet.kind === "status") return SHEETS[sheet.to];
  if (sheet.kind === "voidPayment") {
    return {
      title: "Void this payment?",
      description:
        "A voided payment no longer counts toward what this customer owes. It stays on record with your reason.",
      confirm: "Void payment",
      danger: true,
    };
  }
  return {
    title: "Void this invoice?",
    description:
      "A voided invoice no longer counts toward what this customer owes. It stays on record with your reason.",
    confirm: "Void invoice",
    danger: true,
  };
}

type HeaderState = { readonly status: "loading" } | HeaderResult;

/**
 * A3. The header and the open tab always come from the server: after any change both load again, and
 * no balance or status is patched in the app. Void is for owners, and the server still has the last word.
 */
export function CustomerDetail(props: {
  readonly id: string;
  readonly viewer: "staff" | "owner";
  readonly onBack: () => void;
  readonly onRecordPayment: () => void;
  readonly onEdit: () => void;
}) {
  const service = useDetailService();
  const { id } = props;
  const owner = props.viewer === "owner";
  const [header, setHeader] = useState<HeaderState>({ status: "loading" });
  const [tab, setTab] = useState<TabName>("Invoices");
  const [reloads, setReloads] = useState(0);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const mounted = useRef(true);
  const generation = useRef(0);

  const loadHeader = useCallback(async (): Promise<void> => {
    generation.current += 1;
    const mine = generation.current;
    setHeader({ status: "loading" });
    const result = await service.header(id);
    if (mine === generation.current && mounted.current) setHeader(result);
  }, [service, id]);

  useEffect(() => {
    mounted.current = true;
    void loadHeader();
    return () => {
      mounted.current = false;
    };
  }, [loadHeader]);

  const loaders = useMemo(
    () => ({
      Invoices: service.invoices(id),
      Payments: service.payments(id),
      Visits: service.visits(id),
      Discounts: service.discounts(id),
      History: service.history(id),
    }),
    [service, id],
  );

  async function run(call: () => Promise<ActionResult>): Promise<void> {
    setBusy(true);
    setSheetError(null);
    const result = await call();
    if (!mounted.current) return;
    setBusy(false);
    switch (result.status) {
      case "done":
        setSheet(null);
        setBanner(null);
        setReloads((count) => count + 1);
        await loadHeader();
        return;
      case "forbidden":
        setSheet(null);
        setBanner(FORBIDDEN_MESSAGE);
        return;
      case "refused":
        // The record changed under us, so show the server's reason and load the truth again.
        setSheet(null);
        setBanner(result.message);
        setReloads((count) => count + 1);
        await loadHeader();
        return;
      default:
        setSheetError(result.message);
    }
  }

  function confirm(reason: string): void {
    if (sheet === null) return;
    if (sheet.kind === "status") void run(() => service.changeStatus(id, sheet.to, reason));
    else if (sheet.kind === "voidPayment") void run(() => service.voidPayment(sheet.id, reason));
    else void run(() => service.voidInvoice(sheet.id, reason));
  }

  if (header.status === "loading") return <Skeleton lines={5} />;
  if (header.status === "failed") {
    return <ErrorBlock message={header.message} onRetry={() => void loadHeader()} />;
  }
  const info: DetailHeader = header.header;
  const open = (next: Sheet) => () => {
    setSheetError(null);
    setSheet(next);
    setActionsOpen(false);
  };

  return (
    <>
      <CustomerDetailScreen
        header={info}
        tab={tab}
        banner={banner}
        actionsOpen={actionsOpen}
        onTab={setTab}
        onBack={props.onBack}
        onRecordPayment={props.onRecordPayment}
        onToggleActions={() => setActionsOpen((value) => !value)}
        onEdit={props.onEdit}
        onPause={open({ kind: "status", to: "PAUSED" })}
        onResume={open({ kind: "status", to: "ACTIVE" })}
        onCancel={open({ kind: "status", to: "CANCELLED" })}
      >
        {tab === "Invoices" ? (
          <PagedTab
            key={`invoices-${reloads}`}
            load={loaders.Invoices}
            emptyTitle="No invoices yet"
            emptyHint="Invoices appear here once the first one is generated."
            keyOf={(row) => row.id}
            render={(row) => (
              <InvoiceCard
                row={row}
                currency={info.currency}
                onVoid={
                  owner && !row.isVoid && row.amountDue === row.total
                    ? open({ kind: "voidInvoice", id: row.id })
                    : null
                }
              />
            )}
          />
        ) : null}
        {tab === "Payments" ? (
          <PagedTab
            key={`payments-${reloads}`}
            load={loaders.Payments}
            emptyTitle="No payments yet"
            emptyHint="Recorded payments appear here."
            keyOf={(row) => row.id}
            render={(row) => (
              <PaymentCard
                row={row}
                currency={info.currency}
                onVoid={owner && !row.isVoid ? open({ kind: "voidPayment", id: row.id }) : null}
              />
            )}
          />
        ) : null}
        {tab === "Visits" ? (
          <PagedTab
            key={`visits-${reloads}`}
            load={loaders.Visits}
            emptyTitle="No visits yet"
            emptyHint="Check ins appear here."
            keyOf={(row) => row.id}
            render={(row) => <VisitCard row={row} timezone={info.timezone} />}
          />
        ) : null}
        {tab === "Discounts" ? (
          <PagedTab
            key={`discounts-${reloads}`}
            load={loaders.Discounts}
            emptyTitle="No discounts"
            emptyHint="Referral and manual discounts appear here."
            keyOf={(row) => row.id}
            render={(row) => <DiscountCard row={row} currency={info.currency} />}
          />
        ) : null}
        {tab === "History" ? (
          <PagedTab
            key={`history-${reloads}`}
            load={loaders.History}
            emptyTitle="No history yet"
            emptyHint="Pauses, resumes and cancellations appear here."
            keyOf={(row) => row.id}
            render={(row) => <HistoryCard row={row} />}
          />
        ) : null}
      </CustomerDetailScreen>
      {sheet === null ? null : (
        <ReasonSheet
          title={sheetText(sheet).title}
          description={sheetText(sheet).description}
          confirmLabel={sheetText(sheet).confirm}
          danger={sheetText(sheet).danger}
          busy={busy}
          error={sheetError}
          onConfirm={confirm}
          onCancel={() => setSheet(null)}
        />
      )}
    </>
  );
}
