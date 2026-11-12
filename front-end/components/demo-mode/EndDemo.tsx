/**
 * REQ-235 — End, which asks first, in place (no modal): the first click turns End into "End for
 * everyone?" with "Yes, end it" and "Keep going"; Keep going, Escape, or END_ASK_MS without an
 * answer puts End back; Yes counts after END_ARM_MS (a double click on End never ends a demo) and
 * calls `onEnd` at once, so the pill says so before the server answers (REQ-179). Drawn in the
 * customer's pill and on every stage.
 */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { t } from "../../lib/i18n.ts";
import { type EndAsk, endConfirm } from "../../../shared/demo-mode/ended.ts";

const BTN =
  "padding:5px 12px;border-radius:8px;border:0;cursor:pointer;font:inherit;font-size:12px;font-weight:700";

export default function EndDemo(
  { onEnd, disabled = false }: { onEnd: () => void; disabled?: boolean },
) {
  const [s, setS] = useState<EndAsk>({ asking: false, armed: false });
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const ask = useMemo(
    () => endConfirm({ onChange: setS, onEnd: () => onEndRef.current() }),
    [],
  );
  useEffect(() => ask.dispose, []);
  // the demo ended some other way while asking: nothing left to ask
  useEffect(() => {
    if (disabled) ask.cancel();
  }, [disabled]);
  // the keyboard lands on the safe answer
  const keepRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (s.asking) keepRef.current?.focus();
  }, [s.asking]);

  if (!s.asking) {
    return (
      <button
        type="button"
        data-cy="demo-end"
        disabled={disabled}
        onClick={ask.ask}
        style={`${BTN};background:#fff;color:#7a2e2e${
          disabled ? ";opacity:.55;cursor:default" : ""
        }`}
      >
        {t("demoMode.end")}
      </button>
    );
  }
  return (
    <span
      data-cy="demo-end-ask"
      role="group"
      onKeyDown={(e) => {
        if (e.key === "Escape") ask.cancel();
      }}
      style="display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap"
    >
      <span style="font-weight:700">{t("demoMode.endAsk")}</span>
      <button
        type="button"
        data-cy="demo-end-confirm"
        disabled={!s.armed}
        onClick={ask.confirm}
        style={`${BTN};background:#c62828;color:#fff${
          s.armed ? "" : ";opacity:.55;cursor:default"
        }`}
      >
        {t("demoMode.endYes")}
      </button>
      <button
        ref={keepRef}
        type="button"
        data-cy="demo-end-cancel"
        onClick={ask.cancel}
        style="padding:5px 6px;border:0;background:transparent;color:#fff;text-decoration:underline;cursor:pointer;font:inherit;font-size:12px;font-weight:600"
      >
        {t("demoMode.endNo")}
      </button>
    </span>
  );
}
