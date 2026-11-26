import { useCallback, useEffect, useRef, useState } from "react";
import { formatMoneyInput } from "../../settings/money-input";
import { ErrorBlock, Skeleton } from "../../ui/blocks";
import { useDebounced } from "../useCustomers";
import { usePaymentService } from "./context";
import { checkAmount, type Method, type PaymentErrors, todayIn, validatePayment } from "./form";
import { PaymentFormScreen, type PreviewState } from "./PaymentFormScreen";
import type { PaymentSetup, SetupResult } from "./service";

export const FORBIDDEN_MESSAGE = "You do not have permission to do that.";
export const PREVIEW_DEBOUNCE_MS = 300;

type SetupState = { readonly status: "loading" } | SetupResult;

function Body(props: {
  readonly memberId: string;
  readonly setup: PaymentSetup;
  readonly now: () => Date;
  readonly onCancel: () => void;
  readonly onSaved: () => void;
}) {
  const service = usePaymentService();
  const { memberId, setup } = props;
  // One id for this form. Every retry of Save sends the same one, so a payment that went through
  // while the answer was lost is never recorded twice. Opening the form again makes a new id.
  const [requestId] = useState(() => service.newRequestId());
  const [amount, setAmount] = useState(
    setup.balanceDue > 0 ? formatMoneyInput(setup.balanceDue, setup.currency) : "",
  );
  const [method, setMethod] = useState<Method>("CASH");
  const [paidOn, setPaidOn] = useState(() => todayIn(setup.timezone, props.now()));
  const [proofLink, setProofLink] = useState("");
  const [errors, setErrors] = useState<PaymentErrors>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PreviewState>({ status: "none" });
  const saving = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(0);

  const settled = useDebounced(amount, PREVIEW_DEBOUNCE_MS);
  const typed = checkAmount(amount, setup.currency);
  const moreThanOwed = typed.ok && typed.minor > setup.balanceDue;

  // The server's preview for the amount, after a pause in typing. An older answer is dropped.
  useEffect(() => {
    generation.current += 1;
    const mine = generation.current;
    const parsed = checkAmount(settled, setup.currency);
    if (!parsed.ok) {
      setPreview({ status: "none" });
      return;
    }
    setPreview({ status: "loading" });
    void service.preview(memberId, parsed.minor).then((result) => {
      if (mine !== generation.current) return;
      setPreview(
        result.status === "preview"
          ? { status: "ready", preview: result.preview }
          : { status: "failed", message: result.message },
      );
    });
    return () => {
      generation.current += 1;
    };
  }, [service, memberId, settled, setup.currency]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function save(): Promise<void> {
    if (saving.current) return;
    const today = todayIn(setup.timezone, props.now());
    const checked = validatePayment({ amount, method, paidOn, proofLink }, setup.currency, today);
    if (!checked.ok) {
      setErrors(checked.errors);
      setBanner(null);
      return;
    }
    saving.current = true;
    setBusy(true);
    setErrors({});
    setBanner(null);
    const result = await service.record({
      clientRequestId: requestId,
      memberId,
      ...checked.value,
    });
    saving.current = false;
    if (!mounted.current) return;
    setBusy(false);
    switch (result.status) {
      case "recorded":
        props.onSaved();
        return;
      case "invalid":
        setErrors(result.fields);
        setBanner(result.message);
        return;
      case "forbidden":
        setBanner(FORBIDDEN_MESSAGE);
        return;
      case "failed":
        setBanner(result.message);
    }
  }

  return (
    <PaymentFormScreen
      memberName={setup.memberName}
      balanceDue={setup.balanceDue}
      currency={setup.currency}
      amount={amount}
      method={method}
      paidOn={paidOn}
      proofLink={proofLink}
      errors={errors}
      moreThanOwed={moreThanOwed}
      preview={preview}
      banner={banner}
      busy={busy}
      onAmount={setAmount}
      onMethod={setMethod}
      onPaidOn={setPaidOn}
      onProofLink={setProofLink}
      onSubmit={() => void save()}
      onCancel={props.onCancel}
    />
  );
}

/**
 * A4. The amount starts as what the member owes. Save stays off while it runs, and tapping it again
 * after an error sends the same request id. The date received is the gym's local date, never later.
 */
export function PaymentForm(props: {
  readonly memberId: string;
  readonly now: () => Date;
  readonly onCancel: () => void;
  readonly onSaved: () => void;
}) {
  const service = usePaymentService();
  const [state, setState] = useState<SetupState>({ status: "loading" });
  const mounted = useRef(true);
  const { memberId } = props;

  const load = useCallback(async (): Promise<void> => {
    setState({ status: "loading" });
    const result = await service.load(memberId);
    if (mounted.current) setState(result);
  }, [service, memberId]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  if (state.status === "loading") return <Skeleton lines={5} />;
  if (state.status === "failed")
    return <ErrorBlock message={state.message} onRetry={() => void load()} />;
  return (
    <Body
      memberId={memberId}
      setup={state.setup}
      now={props.now}
      onCancel={props.onCancel}
      onSaved={props.onSaved}
    />
  );
}
