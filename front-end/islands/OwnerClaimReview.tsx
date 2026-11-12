import { useState } from "preact/hooks";
import {
  confirmPaymentPath,
  type OwnerClaimNote,
  rejectClaimPath,
  reviewClaimHref,
} from "../../shared/documents/owner-claim-note.ts";

interface Props {
  invoiceId: string;
  /** The note's copy, already in the page's language (ownerClaimNote()). */
  copy: OwnerClaimNote;
}

const INK = "#1c2c30";
const TEAL = "#144852";

/**
 * OwnerClaimReview — REQ-557 (demo M25): the business's own view of a
 * claimed invoice on /i/:id. "{customer} says they paid by Zelle · ref …",
 * then Confirm received (confirm-payment) / Didn't get it (reject-claim) —
 * the actions /invoices and /payments offer — and the invoice on /invoices.
 * Either action reloads the page, which then shows the paid / reopened state.
 */
export default function OwnerClaimReview({ invoiceId, copy }: Props) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function act(url: string) {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const r = await fetch(url, { method: "POST", credentials: "include" });
      await r.body?.cancel();
      if (!r.ok) {
        setFailed(true);
        return;
      }
      globalThis.location.reload();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      data-cy="owner-claim-note"
      role="status"
      style="margin-top:24px;background:rgba(255,170,40,0.06);border:1px solid rgba(255,170,40,0.30);border-radius:14px;padding:18px 22px"
    >
      <div style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#a06800">
        {copy.heading}
      </div>
      <p
        style={`margin:8px 0 0;color:${INK};font-size:14.5px;line-height:1.55`}
      >
        <strong>{copy.body}</strong>
        <br />
        {copy.hint}
      </p>
      <div style="margin-top:14px;display:flex;flex-wrap:wrap;gap:10px;align-items:center">
        <button
          type="button"
          data-cy="owner-claim-confirm"
          disabled={busy}
          onClick={() => act(confirmPaymentPath(invoiceId))}
          style={`background:${TEAL};color:#fff;border:0;border-radius:999px;padding:10px 18px;font-size:14px;font-weight:700;cursor:pointer`}
        >
          {copy.confirm}
        </button>
        <button
          type="button"
          data-cy="owner-claim-reject"
          disabled={busy}
          onClick={() => act(rejectClaimPath(invoiceId))}
          style={`background:#fff;color:${INK};border:1px solid rgba(28,44,48,0.25);border-radius:999px;padding:9px 16px;font-size:14px;font-weight:700;cursor:pointer`}
        >
          {copy.reject}
        </button>
        <a
          href={reviewClaimHref(invoiceId)}
          data-cy="owner-claim-open"
          style={`color:${TEAL};font-size:14px;font-weight:700;text-decoration:underline`}
        >
          {copy.open}
        </a>
      </div>
      {failed
        ? (
          <p
            data-cy="owner-claim-failed"
            role="alert"
            style="margin:10px 0 0;color:#b03030;font-size:13px"
          >
            {copy.failed}
          </p>
        )
        : null}
    </section>
  );
}
