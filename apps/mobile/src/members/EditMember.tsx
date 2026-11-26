import { useCallback, useEffect, useState } from "react";
import { useUnsavedGuard } from "../navigation/unsaved";
import { ErrorBlock, Skeleton } from "../ui/blocks";
import { formatDate } from "../ui/dates";
import { FORBIDDEN_MESSAGE } from "./AddMember";
import { useMembersService } from "./context";
import {
  type Errors,
  editChanged,
  type FieldKey,
  type Form,
  placeProblems,
  validateEdit,
} from "./form";
import { MemberFormScreen, ReadOnlyField } from "./MemberFormScreen";
import type { MemberDetails } from "./service";
import { useSave } from "./useSave";

type Phase =
  | { readonly kind: "loading" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "ready"; readonly member: MemberDetails };

const startOf = (member: MemberDetails): Form => ({
  name: member.name ?? "",
  email: member.email,
  phone: member.phone ?? "",
  joinedOn: member.joinedOn,
  referrer: null,
});

/** A5, edit. Name and phone can change. Everything else is shown as text, as drawn. */
export function EditMember(props: {
  readonly memberId: string;
  readonly onDone: () => void;
  readonly onCancel: () => void;
}) {
  const service = useMembersService();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const { memberId } = props;

  const load = useCallback(async () => {
    setPhase({ kind: "loading" });
    const result = await service.loadMember(memberId);
    if (result.status === "forbidden") return setPhase({ kind: "forbidden" });
    if (result.status === "failed") return setPhase({ kind: "failed", message: result.message });
    setPhase({ kind: "ready", member: result.data });
  }, [service, memberId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (phase.kind === "loading") return <Skeleton lines={6} />;
  if (phase.kind === "forbidden") return <ErrorBlock message={FORBIDDEN_MESSAGE} />;
  if (phase.kind === "failed") return <ErrorBlock message={phase.message} onRetry={load} />;
  return <EditForm member={phase.member} onDone={props.onDone} onCancel={props.onCancel} />;
}

function EditForm(props: {
  readonly member: MemberDetails;
  readonly onDone: () => void;
  readonly onCancel: () => void;
}) {
  const service = useMembersService();
  const { member } = props;
  const start = startOf(member);
  const { saving, run } = useSave<void>();
  const [form, setForm] = useState<Form>(start);
  const [errors, setErrors] = useState<Errors>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  useUnsavedGuard(!finished && editChanged(form, start));

  const change = (key: FieldKey, text: string) => {
    setForm((current) => ({ ...current, [key]: text }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const save = () =>
    run(async () => {
      const checked = validateEdit(form);
      if (!checked.ok) {
        setErrors(checked.errors);
        setGeneral(null);
        return;
      }
      const result = await service.update(member.id, checked.value);
      if (result.status === "saved") {
        setFinished(true);
        props.onDone();
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
      title="Edit member"
      values={form}
      errors={errors}
      general={general}
      saving={saving}
      saveLabel="Save changes"
      editable={["name", "phone"]}
      onChange={change}
      onSave={() => void save()}
      onCancel={props.onCancel}
      readOnly={
        <>
          <ReadOnlyField label="Member number" value={member.memberNo} />
          <ReadOnlyField label="Google email" value={member.email} />
          <ReadOnlyField label="Plan" value={member.planName} />
          <ReadOnlyField label="Join date" value={formatDate(member.joinedOn)} />
          <ReadOnlyField label="Referred by" value={member.referredByName ?? "No one"} />
        </>
      }
    />
  );
}
