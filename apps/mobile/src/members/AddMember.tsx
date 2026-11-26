import { useCallback, useEffect, useState } from "react";
import { useUnsavedGuard } from "../navigation/unsaved";
import { ErrorBlock, Skeleton } from "../ui/blocks";
import { useMembersService } from "./context";
import {
  EMPTY_FORM,
  type Errors,
  type FieldKey,
  type Form,
  invoicePreview,
  newChanged,
  placeProblems,
  todayIn,
  validateNew,
} from "./form";
import { InvoicePreviewCard, MemberFormScreen } from "./MemberFormScreen";
import { ReferrerPicker } from "./ReferrerPicker";
import type { GymFees } from "./service";
import { useSave } from "./useSave";

export const FORBIDDEN_MESSAGE = "You do not have permission to add members.";

type Phase =
  | { readonly kind: "loading" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "ready"; readonly fees: GymFees; readonly start: Form };

/**
 * A5, add. The join date starts as today in the gym's time zone. The member number and barcode are
 * never typed, the server returns them. One save runs at a time, so a double tap adds one member.
 */
export function AddMember(props: {
  readonly onDone: (memberId: string) => void;
  readonly onCancel: () => void;
  readonly now?: () => Date;
}) {
  const service = useMembersService();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const now = props.now;

  const load = useCallback(async () => {
    setPhase({ kind: "loading" });
    const result = await service.loadFees();
    if (result.status === "forbidden") return setPhase({ kind: "forbidden" });
    if (result.status === "failed") return setPhase({ kind: "failed", message: result.message });
    const joinedOn = todayIn(result.data.timezone, (now ?? (() => new Date()))());
    setPhase({ kind: "ready", fees: result.data, start: { ...EMPTY_FORM, joinedOn } });
  }, [service, now]);

  useEffect(() => {
    void load();
  }, [load]);

  if (phase.kind === "loading") return <Skeleton lines={6} />;
  if (phase.kind === "forbidden") return <ErrorBlock message={FORBIDDEN_MESSAGE} />;
  if (phase.kind === "failed") return <ErrorBlock message={phase.message} onRetry={load} />;
  return (
    <AddForm
      fees={phase.fees}
      start={phase.start}
      onDone={props.onDone}
      onCancel={props.onCancel}
    />
  );
}

function AddForm(props: {
  readonly fees: GymFees;
  readonly start: Form;
  readonly onDone: (memberId: string) => void;
  readonly onCancel: () => void;
}) {
  const service = useMembersService();
  const { saving, run } = useSave<void>();
  const [form, setForm] = useState<Form>(props.start);
  const [errors, setErrors] = useState<Errors>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  useUnsavedGuard(!finished && newChanged(form, props.start));

  const change = (key: FieldKey, text: string) => {
    setForm((current) => ({ ...current, [key]: text }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const save = () =>
    run(async () => {
      const checked = validateNew(form, props.fees.planId);
      if (!checked.ok) {
        setErrors(checked.errors);
        setGeneral(null);
        return;
      }
      const result = await service.create(checked.value);
      if (result.status === "saved") {
        setFinished(true);
        props.onDone(result.memberId);
        return;
      }
      if (result.status === "invalid") {
        const placed = placeProblems(result.problems);
        setErrors(placed.errors);
        setGeneral(placed.general);
      } else {
        setErrors({});
        setGeneral(result.status === "forbidden" ? FORBIDDEN_MESSAGE : result.message);
      }
    });

  return (
    <MemberFormScreen
      title="Add member"
      values={form}
      errors={errors}
      general={general}
      saving={saving}
      saveLabel="Add member"
      editable={["name", "email", "phone", "joinedOn"]}
      onChange={change}
      onSave={() => void save()}
      onCancel={props.onCancel}
      readOnly={null}
    >
      <ReferrerPicker
        service={service}
        value={form.referrer}
        onChange={(referrer) => setForm((current) => ({ ...current, referrer }))}
      />
      <InvoicePreviewCard
        preview={invoicePreview(props.fees, form.joinedOn)}
        currency={props.fees.currency}
      />
    </MemberFormScreen>
  );
}
