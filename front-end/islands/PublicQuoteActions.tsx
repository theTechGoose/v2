import { useState } from "preact/hooks";
import PublicAcceptQuote from "./PublicAcceptQuote.tsx";

interface Props {
  quoteId: string;
  contractorFirstName?: string;
  /** Linked customer's full name, when the quote has one. Pre-fills the
   *  decline / ask forms — the contractor often knows who they sent it to,
   *  no reason to make the homeowner re-type it. */
  customerName?: string;
}

type Mode = "actions" | "decline" | "ask";
type Status = "idle" | "submitting" | "ok" | "error";
type Resolved = "accepted" | "declined" | null;

const REASON_CHIPS: { id: string; label: string }[] = [
  { id: "price",            label: "Price" },
  { id: "timing",           label: "Timing" },
  { id: "going_elsewhere",  label: "Going elsewhere" },
  { id: "other",            label: "Other" },
];

function friendlyError(raw: string): string {
  // Backend returns JSON like {"ok":false,"reason":"already_accepted"}
  // when the customer attempts a second mutation on a settled quote.
  // Surfacing the raw payload to a homeowner is the worst kind of leak.
  try {
    const parsed = JSON.parse(raw) as { reason?: string; message?: string };
    const reason = parsed?.reason;
    if (reason === "already_accepted") return "This quote has already been accepted.";
    if (reason === "already_declined") return "This quote has already been declined.";
    if (parsed?.message && typeof parsed.message === "string") return parsed.message;
  } catch { /* not JSON, fall through */ }
  if (/already_accepted/.test(raw)) return "This quote has already been accepted.";
  if (/already_declined/.test(raw)) return "This quote has already been declined.";
  return "Something went wrong — please try again.";
}

/**
 * Public-quote actions panel — Accept (delegated to PublicAcceptQuote),
 * Decline, and Ask-a-question. Once the customer resolves the quote
 * (accept or decline) we hide *both* secondary buttons immediately so
 * the panel can't fire a second mutation against a settled quote.
 */
export default function PublicQuoteActions({ quoteId, contractorFirstName, customerName }: Props) {
  const [mode, setMode] = useState<Mode>("actions");
  const [resolved, setResolved] = useState<Resolved>(null);

  // Once accepted, the Accept island renders its own success card; we
  // only need to hide our secondary buttons. Once declined, we render
  // the decline success card from this component instead.
  if (resolved === "accepted") {
    return <PublicAcceptQuote quoteId={quoteId} contractorFirstName={contractorFirstName} initialAccepted />;
  }

  return (
    <div>
      {resolved !== "declined" && (
        <PublicAcceptQuote
          quoteId={quoteId}
          contractorFirstName={contractorFirstName}
          onAccepted={() => setResolved("accepted")}
        />
      )}

      {resolved === "declined" && <DeclinedCard />}

      {resolved === null && mode === "actions" && (
        <div style="margin-top:14px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          <button
            type="button"
            onClick={() => setMode("ask")}
            style="background:#fff;border:1px solid #d8e0db;color:#144852;font-weight:700;font-size:13px;padding:10px 18px;border-radius:10px;cursor:pointer"
          >
            Ask a question
          </button>
          <button
            type="button"
            onClick={() => setMode("decline")}
            style="background:#fff;border:1px solid #d8e0db;color:#6b7a7e;font-weight:700;font-size:13px;padding:10px 18px;border-radius:10px;cursor:pointer"
          >
            Decline
          </button>
        </div>
      )}

      {resolved === null && mode === "decline" && (
        <DeclineForm
          quoteId={quoteId}
          customerName={customerName}
          onCancel={() => setMode("actions")}
          onDeclined={() => setResolved("declined")}
        />
      )}
      {resolved === null && mode === "ask" && <AskForm quoteId={quoteId} customerName={customerName} onCancel={() => setMode("actions")} />}
    </div>
  );
}

function DeclinedCard() {
  return (
    <div style="margin-top:18px;background:#fdf2f2;border:1px solid #f3d4d4;border-radius:14px;padding:18px 20px;text-align:center">
      <div style="font-weight:800;color:#a83b3b;font-size:16px">Got it — thanks for letting them know</div>
      <div style="margin-top:6px;color:#6b7a7e;font-size:13px">Your contractor has been notified.</div>
    </div>
  );
}

function DeclineForm({ quoteId, customerName, onCancel, onDeclined }: { quoteId: string; customerName?: string; onCancel: () => void; onDeclined: () => void }) {
  const [reason, setReason] = useState<string | undefined>(undefined);
  const [note, setNote] = useState("");
  const [name, setName] = useState(customerName?.trim() ?? "");
  const [status, setStatus] = useState<Status>("idle");
  const [err, setErr] = useState<string | undefined>();

  async function submit(e: Event) {
    e.preventDefault();
    setStatus("submitting");
    setErr(undefined);
    try {
      const r = await fetch(`/api/quotes/${quoteId}/decline`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(reason ? { reason } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(name.trim() ? { name: name.trim() } : {}),
        }),
      });
      const text = await r.text().catch(() => "");
      if (!r.ok) {
        throw new Error(text.slice(0, 200) || `${r.status}`);
      }
      // The endpoint returns 200 with {ok:false,reason:...} on logical
      // failures (already_accepted) — treat those as errors too.
      try {
        const parsed = JSON.parse(text || "{}") as { ok?: boolean };
        if (parsed && parsed.ok === false) throw new Error(text);
      } catch (parseErr) {
        if (parseErr instanceof Error && parseErr.message === text) throw parseErr;
      }
      setStatus("ok");
      onDeclined();
    } catch (e) {
      setStatus("error");
      setErr(friendlyError((e as Error).message));
    }
  }

  return (
    <form onSubmit={submit} style="margin-top:18px;background:#fff;border:1px solid #e3e8e6;border-radius:14px;padding:18px 20px;text-align:left">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div style="font-weight:800;color:#144852;font-size:15px">Decline this quote</div>
        <button type="button" onClick={onCancel} aria-label="Close decline form" style="background:transparent;border:0;color:#6b7a7e;font-size:18px;cursor:pointer;padding:0 4px">×</button>
      </div>
      <div style="font-size:12px;color:#6b7a7e;margin-bottom:8px">Quick reason (optional):</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">
        {REASON_CHIPS.map((r) => {
          const active = reason === r.id;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => setReason(active ? undefined : r.id)}
              style={`border:1px solid ${active ? "#519843" : "#d8e0db"};background:${active ? "rgba(81,152,67,0.10)" : "#fff"};color:${active ? "#144852" : "#6b7a7e"};font-weight:${active ? 800 : 600};font-size:12px;padding:6px 12px;border-radius:999px;cursor:pointer`}
            >
              {r.label}
            </button>
          );
        })}
      </div>
      <label style="display:block;font-size:11px;font-weight:700;letter-spacing:.10em;text-transform:uppercase;color:#6b7a7e;margin-bottom:6px">Anything to share? (optional)</label>
      <textarea
        value={note}
        onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
        rows={3}
        placeholder="Looking at a few options, the budget came in lower than expected, etc."
        style="width:100%;padding:10px 12px;border:1px solid #e3e8e6;border-radius:10px;font-size:14px;color:#1c2c30;font-family:inherit;background:#fff;resize:vertical"
      />
      <label style="display:block;font-size:11px;font-weight:700;letter-spacing:.10em;text-transform:uppercase;color:#6b7a7e;margin:12px 0 6px">Your name (optional)</label>
      <input
        type="text"
        value={name}
        onInput={(e) => setName((e.target as HTMLInputElement).value)}
        placeholder="Jane Doe"
        autoComplete="name"
        style="width:100%;padding:10px 12px;border:1px solid #e3e8e6;border-radius:10px;font-size:14px;color:#1c2c30;font-family:inherit;background:#fff"
      />
      {err && <div style="margin-top:10px;color:#b3261e;font-size:13px">Couldn't send — {err}</div>}
      <button
        type="submit"
        disabled={status === "submitting"}
        style={`margin-top:14px;width:100%;background:#a83b3b;color:#fff;border:0;font-weight:800;font-size:14px;padding:12px 20px;border-radius:12px;cursor:${status === "submitting" ? "not-allowed" : "pointer"};opacity:${status === "submitting" ? 0.7 : 1}`}
      >
        {status === "submitting" ? "Sending…" : "Send decline"}
      </button>
    </form>
  );
}

function AskForm({ quoteId, customerName, onCancel }: { quoteId: string; customerName?: string; onCancel: () => void }) {
  const [question, setQuestion] = useState("");
  const [contactBack, setContactBack] = useState("");
  const [name, setName] = useState(customerName?.trim() ?? "");
  const [status, setStatus] = useState<Status>("idle");
  const [err, setErr] = useState<string | undefined>();

  async function submit(e: Event) {
    e.preventDefault();
    if (!question.trim()) return;
    setStatus("submitting");
    setErr(undefined);
    try {
      const r = await fetch(`/api/quotes/${quoteId}/inquiry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: question.trim(),
          ...(contactBack.trim() ? { contactBack: contactBack.trim() } : {}),
          ...(name.trim() ? { name: name.trim() } : {}),
        }),
      });
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        throw new Error(text.slice(0, 200) || `${r.status}`);
      }
      setStatus("ok");
    } catch (e) {
      setStatus("error");
      setErr(friendlyError((e as Error).message));
    }
  }

  if (status === "ok") {
    return (
      <div style="margin-top:18px;background:rgba(20,72,82,0.06);border:1px solid rgba(20,72,82,0.18);border-radius:14px;padding:18px 20px;text-align:center">
        <div style="font-weight:800;color:#144852;font-size:16px">✓ Question sent</div>
        <div style="margin-top:6px;color:#6b7a7e;font-size:13px">Your contractor will follow up directly.</div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} style="margin-top:18px;background:#fff;border:1px solid #e3e8e6;border-radius:14px;padding:18px 20px;text-align:left">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div style="font-weight:800;color:#144852;font-size:15px">Ask a question</div>
        <button type="button" onClick={onCancel} aria-label="Close question form" style="background:transparent;border:0;color:#6b7a7e;font-size:18px;cursor:pointer;padding:0 4px">×</button>
      </div>
      <label style="display:block;font-size:11px;font-weight:700;letter-spacing:.10em;text-transform:uppercase;color:#6b7a7e;margin-bottom:6px">Your question</label>
      <textarea
        value={question}
        onInput={(e) => setQuestion((e.target as HTMLTextAreaElement).value)}
        rows={3}
        placeholder="What's the timeline if I sign by Friday?"
        required
        style="width:100%;padding:10px 12px;border:1px solid #e3e8e6;border-radius:10px;font-size:14px;color:#1c2c30;font-family:inherit;background:#fff;resize:vertical"
      />
      <label style="display:block;font-size:11px;font-weight:700;letter-spacing:.10em;text-transform:uppercase;color:#6b7a7e;margin:12px 0 6px">How can they reach you? (optional)</label>
      <input
        type="text"
        value={contactBack}
        onInput={(e) => setContactBack((e.target as HTMLInputElement).value)}
        placeholder="Phone or email"
        style="width:100%;padding:10px 12px;border:1px solid #e3e8e6;border-radius:10px;font-size:14px;color:#1c2c30;font-family:inherit;background:#fff"
      />
      <label style="display:block;font-size:11px;font-weight:700;letter-spacing:.10em;text-transform:uppercase;color:#6b7a7e;margin:12px 0 6px">Your name (optional)</label>
      <input
        type="text"
        value={name}
        onInput={(e) => setName((e.target as HTMLInputElement).value)}
        placeholder="Jane Doe"
        autoComplete="name"
        style="width:100%;padding:10px 12px;border:1px solid #e3e8e6;border-radius:10px;font-size:14px;color:#1c2c30;font-family:inherit;background:#fff"
      />
      {err && <div style="margin-top:10px;color:#b3261e;font-size:13px">Couldn't send — {err}</div>}
      <button
        type="submit"
        disabled={status === "submitting" || !question.trim()}
        style={`margin-top:14px;width:100%;background:#144852;color:#fff;border:0;font-weight:800;font-size:14px;padding:12px 20px;border-radius:12px;cursor:${status === "submitting" || !question.trim() ? "not-allowed" : "pointer"};opacity:${status === "submitting" || !question.trim() ? 0.7 : 1}`}
      >
        {status === "submitting" ? "Sending…" : "Send question"}
      </button>
    </form>
  );
}
