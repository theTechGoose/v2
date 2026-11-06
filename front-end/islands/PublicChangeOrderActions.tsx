import { useState } from "preact/hooks";
import { tFor } from "../lib/i18n.ts";

interface Props {
  changeOrderId: string;
  initialStatus: "pending" | "approved" | "declined";
  /** REQ-205: who approved it, when it is already approved. */
  approvedName?: string;
  /** Pre-fills the typed name (the customer on the invoice). */
  customerName?: string;
  lang?: "en" | "es";
}

const GREEN = "#519843";
const INK = "#1c2c30";
const MUTED = "#6b7a7e";
const LINE = "#e3e8e6";
const TEAL = "#144852";

/**
 * PublicChangeOrderActions — customer-side Approve / Decline buttons on the
 * public change-order page (/co/:id). Approving applies the delta to the
 * linked invoice server-side (roadmap p.12).
 */
export default function PublicChangeOrderActions(
  { changeOrderId, initialStatus, approvedName, customerName, lang = "en" }:
    Props,
) {
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  // REQ-205: the approver types their name; it is recorded as approvedName.
  const [name, setName] = useState(customerName ?? "");
  const [who, setWho] = useState<string | undefined>(approvedName);

  async function decide(action: "approve" | "decline") {
    if (busy) return;
    const typed = name.trim();
    if (action === "approve" && !typed) {
      setError(tFor(lang, "public.doc.nameRequired"));
      return;
    }
    setBusy(action);
    setError(undefined);
    try {
      const res = await fetch(`/api/change-orders/${changeOrderId}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(action === "approve" ? { name: typed } : {}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // REQ-200/202: a decision already taken, or an invoice already paid,
        // is a state to show — not an error to echo.
        if (res.status === 409 && body.reason === "already_approved") {
          setStatus("approved");
          return;
        }
        if (res.status === 409 && body.reason === "already_declined") {
          setStatus("declined");
          return;
        }
        // The backend refuses to mark the order approved if the invoice
        // write fails — translate that reason instead of echoing it raw.
        throw new Error(
          body.reason === "invoice_update_failed"
            ? tFor(lang, "publicChangeOrderActions.applyError")
            : body.reason === "invoice_paid"
            ? tFor(lang, "public.doc.invoicePaid")
            : body.reason ??
              tFor(lang, "publicChangeOrderActions.submitError", {
                status: res.status,
              }),
        );
      }
      if (action === "approve") setWho(typed);
      setStatus(action === "approve" ? "approved" : "declined");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (status !== "pending") {
    return (
      <div
        style={`margin-top:24px;background:${
          status === "approved"
            ? "rgba(81,152,67,0.08)"
            : "rgba(168,59,59,0.06)"
        };border:1px solid ${LINE};border-radius:14px;padding:20px 24px`}
      >
        <div
          style={`font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${
            status === "approved" ? GREEN : "#a83b3b"
          }`}
        >
          {status === "approved"
            ? tFor(lang, "publicChangeOrderActions.approvedLabel")
            : tFor(lang, "status.declined")}
        </div>
        <p
          style={`margin:8px 0 0;color:${INK};font-size:15px;line-height:1.55`}
        >
          {status === "approved"
            ? tFor(lang, "publicChangeOrderActions.approvedMessage")
            : tFor(lang, "publicChangeOrderActions.declinedMessage")}
        </p>
        {status === "approved" && who
          ? (
            <p
              data-cy="co-approved-by"
              style={`margin:6px 0 0;color:${MUTED};font-size:13px`}
            >
              {tFor(lang, "public.doc.approvedBy", { name: who })}
            </p>
          )
          : null}
      </div>
    );
  }

  return (
    <div style="margin-top:24px;display:flex;flex-direction:column;gap:12px">
      <label style="display:block">
        <span
          style={`display:block;font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:${MUTED};margin-bottom:4px`}
        >
          {tFor(lang, "public.doc.typedName")}
        </span>
        <input
          type="text"
          data-cy="co-name"
          value={name}
          autoComplete="name"
          disabled={busy !== null}
          onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
          style={`width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid ${LINE};border-radius:12px;font-size:15px;color:${INK};font-family:inherit;background:#fff`}
        />
        <span
          style={`display:block;margin-top:4px;font-size:12px;color:${TEAL}`}
        >
          {tFor(lang, "public.doc.typedNameHint")}
        </span>
      </label>
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => decide("approve")}
        style={`appearance:none;border:0;border-radius:12px;padding:15px 18px;background:${GREEN};color:#fff;font:inherit;font-weight:800;font-size:16px;cursor:pointer`}
      >
        {busy === "approve"
          ? tFor(lang, "publicChangeOrderActions.approving")
          : tFor(lang, "publicChangeOrderActions.approve")}
      </button>
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => decide("decline")}
        style={`appearance:none;border:1px solid ${LINE};border-radius:12px;padding:13px 18px;background:#fff;color:${MUTED};font:inherit;font-weight:700;font-size:15px;cursor:pointer`}
      >
        {busy === "decline"
          ? "…"
          : tFor(lang, "publicChangeOrderActions.decline")}
      </button>
      {error
        ? (
          <p style="color:#a83b3b;font-size:13px;margin:2px 0 0" role="alert">
            {error}
          </p>
        )
        : null}
    </div>
  );
}
