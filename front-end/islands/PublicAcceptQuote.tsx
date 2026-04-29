import { useState } from "preact/hooks";

interface Props {
  quoteId: string;
}

/**
 * Customer-facing "Accept this quote" island. Renders below the SSR'd
 * quote summary. Submits a fetch with JSON (the backend's @Body() parser
 * needs JSON — a plain form POST gets parsed into an empty object).
 *
 * Name is optional because the backend's AcceptQuoteDto allows it; a
 * type-your-name field gives us a record of who clicked accept without
 * forcing the customer to draw a signature on a phone.
 */
export default function PublicAcceptQuote({ quoteId }: Props) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<"idle" | "ok" | "error">("idle");
  const [err, setErr] = useState<string | undefined>();

  async function onAccept(e: Event) {
    e.preventDefault();
    setSubmitting(true);
    setErr(undefined);
    try {
      // Same-origin via Fresh's /api proxy — avoids CORS that an absolute
      // localhost:3000 URL would trip in the browser.
      const r = await fetch(`/api/quotes/${quoteId}/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(name.trim() ? { name: name.trim(), signature: name.trim() } : {}),
      });
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        throw new Error(text.slice(0, 200) || `${r.status}`);
      }
      setStatus("ok");
    } catch (e) {
      setStatus("error");
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (status === "ok") {
    return (
      <div style="margin-top:24px;background:rgba(81,152,67,0.10);border:1px solid rgba(72,158,95,0.30);border-radius:14px;padding:18px 20px;text-align:center">
        <div style="font-weight:800;color:#519843;font-size:16px">✓ Quote accepted</div>
        <div style="margin-top:6px;color:#6b7a7e;font-size:13px">Your contractor has been notified. They'll send the contract next.</div>
      </div>
    );
  }

  return (
    <form onSubmit={onAccept} style="margin-top:24px;text-align:left;">
      <label style="display:block;font-size:11px;font-weight:700;letter-spacing:.10em;text-transform:uppercase;color:#6b7a7e;margin-bottom:6px;">Type your full name to sign</label>
      <input
        type="text"
        value={name}
        onInput={(e) => setName((e.target as HTMLInputElement).value)}
        placeholder="Jane Doe"
        autoComplete="name"
        style="width:100%;padding:12px 14px;border:1px solid #e3e8e6;border-radius:10px;font-size:15px;color:#1c2c30;font-family:inherit;background:#fff;"
        required
      />
      {err
        ? <div style="margin-top:10px;color:#b3261e;font-size:13px">Couldn't accept — {err}</div>
        : null}
      <button
        type="submit"
        disabled={submitting || !name.trim()}
        style={`margin-top:16px;width:100%;background:${submitting || !name.trim() ? "#a8c8a0" : "#519843"};color:#fff;border:0;font-weight:800;font-size:15px;padding:14px 28px;border-radius:12px;box-shadow:0 6px 14px rgba(81,152,67,0.35);cursor:${submitting || !name.trim() ? "default" : "pointer"};`}
      >
        {submitting ? "Accepting…" : "Accept this quote →"}
      </button>
    </form>
  );
}
