import { useCallback, useEffect, useRef, useState } from "react";
import type { Role } from "../auth/session";
import { useUnsavedGuard } from "../navigation/unsaved";
import { ErrorBlock, Skeleton } from "../ui/blocks";
import { useSettingsService } from "./context";
import {
  type Errors,
  type FieldKey,
  type Form,
  feesChanged,
  fieldOf,
  isDirty,
  referralPreview,
  settingsChanged,
  toForm,
  validate,
} from "./form";
import { SettingsScreen } from "./SettingsScreen";
import type { FieldProblem, SaveResult, SettingsData } from "./service";

type Phase =
  | { readonly kind: "loading" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "ready"; readonly data: SettingsData };

export const FORBIDDEN_MESSAGE = "Only the gym owner can change these settings.";

function placeProblems(problems: readonly FieldProblem[]): {
  errors: Errors;
  general: string | null;
} {
  const errors: Errors = {};
  let general: string | null = null;
  for (const problem of problems) {
    const key = fieldOf(problem.field);
    if (key === null) general = problem.message;
    else errors[key] = problem.message;
  }
  return { errors, general };
}

/**
 * Owner only. A staff user who gets here by any route sees the forbidden state and no request is made.
 * Fees and the other settings are saved with two calls, only for the part that changed.
 */
export function Settings(props: { readonly viewer: Role }) {
  if (props.viewer !== "owner") return <ErrorBlock message={FORBIDDEN_MESSAGE} />;
  return <OwnerSettings />;
}

function OwnerSettings() {
  const service = useSettingsService();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [saved, setSaved] = useState<Form | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const mounted = useRef(true);

  const load = useCallback(async (): Promise<void> => {
    setPhase({ kind: "loading" });
    const result = await service.load();
    if (!mounted.current) return;
    if (result.status === "loaded") {
      const initial = toForm(result.data);
      setSaved(initial);
      setForm(initial);
      setPhase({ kind: "ready", data: result.data });
    } else if (result.status === "forbidden") setPhase({ kind: "forbidden" });
    else setPhase({ kind: "failed", message: result.message });
  }, [service]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  const dirty = form !== null && saved !== null && isDirty(form, saved);
  useUnsavedGuard(dirty);

  if (phase.kind === "loading" || form === null || saved === null) {
    return phase.kind === "failed" ? (
      <ErrorBlock message={phase.message} onRetry={() => void load()} />
    ) : phase.kind === "forbidden" ? (
      <ErrorBlock message={FORBIDDEN_MESSAGE} />
    ) : (
      <Skeleton />
    );
  }
  if (phase.kind === "failed")
    return <ErrorBlock message={phase.message} onRetry={() => void load()} />;
  if (phase.kind === "forbidden") return <ErrorBlock message={FORBIDDEN_MESSAGE} />;
  const data = phase.data;

  async function save(): Promise<void> {
    if (form === null || saved === null || saving) return;
    const checked = validate(form, data.currency);
    if (!checked.ok) {
      setErrors(checked.errors);
      setGeneral(null);
      return;
    }
    setSaving(true);
    setErrors({});
    setGeneral(null);
    let baseline = saved;
    let outcome: SaveResult = { status: "saved" };
    if (feesChanged(form, saved)) {
      outcome = await service.savePlan({ id: data.planId, name: data.planName, ...checked.fees });
      if (outcome.status === "saved") {
        baseline = { ...baseline, admissionFee: form.admissionFee, monthlyFee: form.monthlyFee };
      }
    }
    if (outcome.status === "saved" && settingsChanged(form, saved)) {
      outcome = await service.saveSettings(checked.settings);
      if (outcome.status === "saved") {
        baseline = {
          ...form,
          admissionFee: baseline.admissionFee,
          monthlyFee: baseline.monthlyFee,
        };
      }
    }
    if (!mounted.current) return;
    setSaving(false);
    setSaved(baseline);
    if (outcome.status === "invalid") {
      const placed = placeProblems(outcome.problems);
      setErrors(placed.errors);
      setGeneral(placed.general);
    } else if (outcome.status === "forbidden") setPhase({ kind: "forbidden" });
    else if (outcome.status === "failed") setGeneral(outcome.message);
  }

  return (
    <SettingsScreen
      data={data}
      form={form}
      errors={errors}
      generalError={general}
      preview={referralPreview(form, data.currency)}
      saving={saving}
      dirty={dirty}
      onText={(key: FieldKey, text: string) => {
        setForm({ ...form, [key]: text });
        setErrors({ ...errors, [key]: undefined });
      }}
      onRecurring={(key, value) => setForm({ ...form, [key]: value })}
      onSave={() => void save()}
    />
  );
}
