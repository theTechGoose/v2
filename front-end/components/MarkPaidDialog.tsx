/**
 * MarkPaidDialog — REQ-930. Raphael: "when i mark an invoice as paid, i need
 * a modal to put the reference number."
 *
 * Opened by every owner "confirm a customer's claimed payment" button (the
 * /invoices card front + back, the /payments claim card, the owner's note on
 * /i/:id). One field, Reference number, prefilled with what the customer
 * claimed and focused; one solid "Mark as paid", a ghost Cancel. Escape or
 * a backdrop click closes it (Backdrop, REQ-354/732) unless it is saving.
 * The caller posts confirm-payment (lib/mark-paid.ts confirmPaymentInit)
 * with the trimmed reference and keeps the dialog open on a failure.
 *
 * Inline styles: it renders on /invoices, /payments and the public /i/:id,
 * which share no stylesheet. In the browser it portals to <body>: an
 * /invoices card flips with a 3D transform, which would otherwise turn the
 * fixed overlay into a card-sized box (and its clicks would flip the card).
 */
import { createPortal } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";
import Backdrop from "./Backdrop.tsx";
import { type Lang, tFor } from "../lib/i18n.ts";

const LINE = "var(--border,#d8dcd5)";
const GREEN = "var(--brand-green,#519843)";
const INK = "var(--fg,#144852)";
const MUTED = "var(--fg-muted,#6b7560)";

export default function MarkPaidDialog(
  { lang, initialReference, busy, failed, onCancel, onConfirm }: {
    lang: Lang;
    /** the customer's claimed reference, when they gave one */
    initialReference?: string;
    busy: boolean;
    /** the last confirm failed — say so and stay open */
    failed: boolean;
    onCancel: () => void;
    /** the reference to record, trimmed ("" = none) */
    onConfirm: (reference: string) => void | Promise<void>;
  },
) {
  const [reference, setReference] = useState(initialReference ?? "");
  // `autofocus` only works on page load — a dialog opened by a click
  // focuses its field (end of the prefilled reference) itself.
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange?.(el.value.length, el.value.length);
  }, []);
  const close = () => {
    if (!busy) onCancel();
  };
  function submit(e: Event) {
    e.preventDefault();
    if (busy) return;
    onConfirm(reference.trim());
  }
  const dialog = (
    <Backdrop
      onClose={close}
      style="position:fixed;inset:0;z-index:80;background:rgba(20,44,48,0.45);display:flex;align-items:flex-start;justify-content:center;padding:max(16px,12vh) 16px 16px"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mark-paid-title"
        data-cy="mark-paid-dialog"
        onClick={(e) => e.stopPropagation()}
        style="width:min(420px,100%);background:#fff;border-radius:16px;padding:20px;box-shadow:0 24px 60px -18px rgba(20,72,82,0.45)"
      >
        <form
          data-cy="mark-paid-form"
          onSubmit={submit}
          style="display:flex;flex-direction:column;gap:12px;margin:0"
        >
          <h4
            id="mark-paid-title"
            style={`margin:0;font-size:17px;font-weight:800;color:${INK}`}
          >
            {tFor(lang, "markPaid.title")}
          </h4>
          <p style={`margin:0;font-size:13px;line-height:1.5;color:${MUTED}`}>
            {tFor(lang, "markPaid.body")}
          </p>
          <label
            style={`display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:700;color:${MUTED}`}
          >
            {tFor(lang, "markPaid.referenceLabel")}
            <input
              type="text"
              data-cy="mark-paid-reference"
              ref={field}
              autoFocus
              autoComplete="off"
              value={reference}
              placeholder={tFor(lang, "markPaid.referencePlaceholder")}
              onInput={(e) =>
                setReference((e.currentTarget as HTMLInputElement).value)}
              style={`width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid ${LINE};border-radius:9px;font:inherit;font-size:14px;color:${INK}`}
            />
          </label>
          {failed && (
            <div
              role="alert"
              data-cy="mark-paid-failed"
              style="font-size:12.5px;font-weight:700;color:var(--pink-700,#d94e4e)"
            >
              {tFor(lang, "markPaid.failed")}
            </div>
          )}
          <div style="display:flex;gap:8px;justify-content:flex-end;align-items:center">
            <button
              type="button"
              data-cy="mark-paid-cancel"
              onClick={close}
              style={`appearance:none;cursor:pointer;background:none;border:0;padding:9px 12px;font:inherit;font-size:13.5px;font-weight:700;color:${MUTED}`}
            >
              {tFor(lang, "markPaid.cancel")}
            </button>
            <button
              type="submit"
              data-cy="mark-paid-confirm"
              disabled={busy}
              style={`appearance:none;cursor:pointer;background:${GREEN};color:#fff;border:0;border-radius:9px;padding:9px 16px;font:inherit;font-size:13.5px;font-weight:800`}
            >
              {busy ? "…" : tFor(lang, "markPaid.confirm")}
            </button>
          </div>
        </form>
      </div>
    </Backdrop>
  );
  return typeof document === "undefined" || !document.body
    ? dialog
    : createPortal(dialog, document.body);
}
