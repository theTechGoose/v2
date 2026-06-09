import { useState } from "preact/hooks";
import { tFor } from "../lib/i18n.ts";

interface Props {
  changeOrderId: string;
  initialStatus: "pending" | "approved" | "declined";
  lang?: "en" | "es";
}

const GREEN = "#519843";
const INK = "#1c2c30";
const MUTED = "#6b7a7e";
const LINE = "#e3e8e6";

/**
 * PublicChangeOrderActions — customer-side Approve / Decline buttons on the
 * public change-order page (/co/:id). Approving applies the delta to the
 * linked invoice server-side (roadmap p.12).
 */
export default function PublicChangeOrderActions(
  { changeOrderId, initialStatus, lang = "en" }: Props,
) {
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);

  async function decide(action: "approve" | "decline") {
    if (busy) return;
    setBusy(action);
    setError(undefined);
    try {
      const res = await fetch(`/api/change-orders/${changeOrderId}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body.reason ??
            tFor(lang, "publicChangeOrderActions.submitError", {
              status: res.status,
            }),
        );
      }
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
      </div>
    );
  }

  return (
    <div style="margin-top:24px;display:flex;flex-direction:column;gap:12px">
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
        {busy === "decline" ? "…" : tFor(lang, "publicChangeOrderActions.decline")}
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
