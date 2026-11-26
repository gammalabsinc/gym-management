import { useCallback, useEffect, useRef, useState } from "react";
import type { Role } from "../auth/session";
import { ErrorBlock, Skeleton } from "../ui/blocks";
import { useStaffService } from "./context";
import { StaffScreen } from "./StaffScreen";
import { ConfirmSheet, InviteSheet } from "./StaffSheets";
import type { ChangeResult, StaffPerson, StaffRole } from "./service";

export const STAFF_FORBIDDEN_MESSAGE = "Only the gym owner can manage staff.";

type Phase =
  | { readonly kind: "loading" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "ready"; readonly people: readonly StaffPerson[] };

type Sheet =
  | { readonly kind: "none" }
  | { readonly kind: "invite" }
  | { readonly kind: "role"; readonly person: StaffPerson; readonly role: StaffRole }
  | { readonly kind: "remove"; readonly person: StaffPerson };

function nameOf(person: StaffPerson): string {
  return person.name ?? person.email;
}

/** Owner only. A staff user who gets here by any route sees the forbidden state and no request is made. */
export function Staff(props: { readonly viewer: Role }) {
  if (props.viewer !== "owner") return <ErrorBlock message={STAFF_FORBIDDEN_MESSAGE} />;
  return <OwnerStaff />;
}

function OwnerStaff() {
  const service = useStaffService();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [sheet, setSheet] = useState<Sheet>({ kind: "none" });
  const [busy, setBusy] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async (): Promise<void> => {
    const result = await service.list();
    if (!mounted.current) return;
    if (result.status === "loaded") setPhase({ kind: "ready", people: result.people });
    else if (result.status === "forbidden") setPhase({ kind: "forbidden" });
    else setPhase({ kind: "failed", message: result.message });
  }, [service]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  const close = () => {
    setSheet({ kind: "none" });
    setSheetError(null);
    setEmailError(null);
  };

  /** Runs one change. A success reloads the list. The server's refusals stay on the sheet or the screen. */
  async function run(change: () => Promise<ChangeResult>): Promise<void> {
    if (busy) return;
    setBusy(true);
    setSheetError(null);
    setEmailError(null);
    const result = await change();
    if (!mounted.current) return;
    setBusy(false);
    switch (result.status) {
      case "done":
        setBanner(null);
        close();
        await load();
        return;
      case "lastOwner":
        // Another owner may have changed things at the same moment. Show the truth.
        close();
        setBanner(result.message);
        await load();
        return;
      case "forbidden":
        setPhase({ kind: "forbidden" });
        close();
        return;
      case "invalid": {
        const email = result.problems.find(
          (problem) => problem.field?.split(".").pop() === "email",
        );
        if (email !== undefined) setEmailError(email.message);
        else setSheetError(result.problems[0]?.message ?? "We could not save that change.");
        return;
      }
      case "failed":
        setSheetError(result.message);
        return;
    }
  }

  if (phase.kind === "loading") return <Skeleton />;
  if (phase.kind === "forbidden") return <ErrorBlock message={STAFF_FORBIDDEN_MESSAGE} />;
  if (phase.kind === "failed") {
    return (
      <ErrorBlock
        message={phase.message}
        onRetry={() => {
          setPhase({ kind: "loading" });
          void load();
        }}
      />
    );
  }

  return (
    <>
      <StaffScreen
        people={phase.people}
        banner={banner}
        onInvite={() => setSheet({ kind: "invite" })}
        onRole={(person, role) => setSheet({ kind: "role", person, role })}
        onRemove={(person) => setSheet({ kind: "remove", person })}
      />
      {sheet.kind === "invite" ? (
        <InviteSheet
          busy={busy}
          emailError={emailError}
          error={sheetError}
          onSubmit={(input) => void run(() => service.invite(input))}
          onCancel={close}
        />
      ) : null}
      {sheet.kind === "role" ? (
        <ConfirmSheet
          title={
            sheet.role === "owner"
              ? `Make ${nameOf(sheet.person)} an owner?`
              : `Make ${nameOf(sheet.person)} staff?`
          }
          description={
            sheet.role === "owner"
              ? "Owners can void payments and invoices, add discounts, change gym settings and manage staff."
              : "Staff can scan and manage customers. They can no longer void payments and invoices, add discounts, change gym settings or manage staff."
          }
          primary={sheet.role === "owner" ? "Make owner" : "Make staff"}
          secondary="Cancel"
          danger={false}
          busy={busy}
          error={sheetError}
          onConfirm={() => void run(() => service.setRole(sheet.person, sheet.role))}
          onCancel={close}
        />
      ) : null}
      {sheet.kind === "remove" ? (
        <ConfirmSheet
          title={`Remove access for ${nameOf(sheet.person)}?`}
          description={`${nameOf(sheet.person)} is signed out on every device and can no longer open this gym. Past check ins and payments stay in the history.`}
          primary="Remove access"
          secondary="Keep access"
          danger
          busy={busy}
          error={sheetError}
          onConfirm={() => void run(() => service.removeAccess(sheet.person.userId))}
          onCancel={close}
        />
      ) : null}
    </>
  );
}
