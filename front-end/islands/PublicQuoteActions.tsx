import { useState } from "preact/hooks";
import PublicAcceptQuote from "./PublicAcceptQuote.tsx";

interface Props {
  quoteId: string;
  contractorFirstName?: string;
  /** Linked customer's full name, when the quote has one. Pre-fills the
   *  decline / ask forms — the contractor often knows who they sent it to,
   *  no reason to make the homeowner re-type it. */
  customerName?: string;
  /** Outgoing-comms language (roadmap p.13). Customer-facing. */
  lang?: "en" | "es";
}

type Mode = "actions" | "decline" | "ask";
type Status = "idle" | "submitting" | "ok" | "error";
type Resolved = "accepted" | "declined" | null;

function reasonChips(es: boolean): { id: string; label: string }[] {
  return [
    { id: "price", label: es ? "Precio" : "Price" },
    { id: "timing", label: es ? "Tiempos" : "Timing" },
    {
      id: "going_elsewhere",
      label: es ? "Elegí otra opción" : "Going elsewhere",
    },
    { id: "other", label: es ? "Otro" : "Other" },
  ];
}

function friendlyError(raw: string, es = false): string {
  // Backend returns JSON like {"ok":false,"reason":"already_accepted"}
  // when the customer attempts a second mutation on a settled quote.
  // Surfacing the raw payload to a homeowner is the worst kind of leak.
  const acc = es
    ? "Esta cotización ya fue aceptada."
    : "This quote has already been accepted.";
  const dec = es
    ? "Esta cotización ya fue rechazada."
    : "This quote has already been declined.";
  try {
    const parsed = JSON.parse(raw) as { reason?: string; message?: string };
    const reason = parsed?.reason;
    if (reason === "already_accepted") return acc;
    if (reason === "already_declined") return dec;
    if (parsed?.message && typeof parsed.message === "string") {
      return parsed.message;
    }
  } catch { /* not JSON, fall through */ }
  if (/already_accepted/.test(raw)) return acc;
  if (/already_declined/.test(raw)) return dec;
  return es
    ? "Algo salió mal — inténtalo de nuevo."
    : "Something went wrong — please try again.";
}

/**
 * Public-quote actions panel — Accept (delegated to PublicAcceptQuote),
 * Decline, and Ask-a-question. Once the customer resolves the quote
 * (accept or decline) we hide *both* secondary buttons immediately so
 * the panel can't fire a second mutation against a settled quote.
 */
export default function PublicQuoteActions(
  { quoteId, contractorFirstName, customerName, lang = "en" }: Props,
) {
  const [mode, setMode] = useState<Mode>("actions");
  const [resolved, setResolved] = useState<Resolved>(null);
  const es = lang === "es";

  // Once accepted, the Accept island renders its own success card; we
  // only need to hide our secondary buttons. Once declined, we render
  // the decline success card from this component instead.
  if (resolved === "accepted") {
    return (
      <PublicAcceptQuote
        quoteId={quoteId}
        contractorFirstName={contractorFirstName}
        lang={lang}
        initialAccepted
      />
    );
  }

  return (
    <div>
      {resolved !== "declined" && (
        <PublicAcceptQuote
          quoteId={quoteId}
          contractorFirstName={contractorFirstName}
          lang={lang}
          onAccepted={() => setResolved("accepted")}
        />
      )}

      {resolved === "declined" && <DeclinedCard es={es} />}

      {resolved === null && mode === "actions" && (
        <div style="margin-top:14px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          <button
            type="button"
            onClick={() => setMode("ask")}
            style="background:#fff;border:1px solid #d8e0db;color:#144852;font-weight:700;font-size:13px;padding:10px 18px;border-radius:10px;cursor:pointer"
          >
            {es ? "Hacer una pregunta" : "Ask a question"}
          </button>
          <button
            type="button"
            onClick={() => setMode("decline")}
            style="background:#fff;border:1px solid #d8e0db;color:#6b7a7e;font-weight:700;font-size:13px;padding:10px 18px;border-radius:10px;cursor:pointer"
          >
            {es ? "Rechazar" : "Decline"}
          </button>
        </div>
      )}

      {resolved === null && mode === "decline" && (
        <DeclineForm
          quoteId={quoteId}
          customerName={customerName}
          es={es}
          onCancel={() => setMode("actions")}
          onDeclined={() => setResolved("declined")}
        />
      )}
      {resolved === null && mode === "ask" && (
        <AskForm
          quoteId={quoteId}
          customerName={customerName}
          es={es}
          onCancel={() => setMode("actions")}
        />
      )}
    </div>
  );
}

function DeclinedCard({ es }: { es: boolean }) {
  return (
    <div style="margin-top:18px;background:#fdf2f2;border:1px solid #f3d4d4;border-radius:14px;padding:18px 20px;text-align:center">
      <div style="font-weight:800;color:#a83b3b;font-size:16px">
        {es
          ? "Entendido — gracias por avisar"
          : "Got it — thanks for letting them know"}
      </div>
      <div style="margin-top:6px;color:#6b7a7e;font-size:13px">
        {es
          ? "Tu contratista fue notificado."
          : "Your contractor has been notified."}
      </div>
    </div>
  );
}

function DeclineForm(
  { quoteId, customerName, es, onCancel, onDeclined }: {
    quoteId: string;
    customerName?: string;
    es: boolean;
    onCancel: () => void;
    onDeclined: () => void;
  },
) {
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
        if (parseErr instanceof Error && parseErr.message === text) {
          throw parseErr;
        }
      }
      setStatus("ok");
      onDeclined();
    } catch (e) {
      setStatus("error");
      setErr(friendlyError((e as Error).message, es));
    }
  }

  return (
    <form
      onSubmit={submit}
      style="margin-top:18px;background:#fff;border:1px solid #e3e8e6;border-radius:14px;padding:18px 20px;text-align:left"
    >
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div style="font-weight:800;color:#144852;font-size:15px">
          {es ? "Rechazar esta cotización" : "Decline this quote"}
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close decline form"
          style="background:transparent;border:0;color:#6b7a7e;font-size:18px;cursor:pointer;padding:0 4px"
        >
          ×
        </button>
      </div>
      <div style="font-size:12px;color:#6b7a7e;margin-bottom:8px">
        {es ? "Motivo rápido (opcional):" : "Quick reason (optional):"}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">
        {reasonChips(es).map((r) => {
          const active = reason === r.id;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => setReason(active ? undefined : r.id)}
              style={`border:1px solid ${
                active ? "#519843" : "#d8e0db"
              };background:${active ? "rgba(81,152,67,0.10)" : "#fff"};color:${
                active ? "#144852" : "#6b7a7e"
              };font-weight:${
                active ? 800 : 600
              };font-size:12px;padding:6px 12px;border-radius:999px;cursor:pointer`}
            >
              {r.label}
            </button>
          );
        })}
      </div>
      <label style="display:block;font-size:11px;font-weight:700;letter-spacing:.10em;text-transform:uppercase;color:#6b7a7e;margin-bottom:6px">
        {es
          ? "¿Algo que quieras compartir? (opcional)"
          : "Anything to share? (optional)"}
      </label>
      <textarea
        value={note}
        onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
        rows={3}
        placeholder={es
          ? "Estoy viendo varias opciones, el presupuesto fue menor de lo esperado, etc."
          : "Looking at a few options, the budget came in lower than expected, etc."}
        style="width:100%;padding:10px 12px;border:1px solid #e3e8e6;border-radius:10px;font-size:14px;color:#1c2c30;font-family:inherit;background:#fff;resize:vertical"
      />
      <label style="display:block;font-size:11px;font-weight:700;letter-spacing:.10em;text-transform:uppercase;color:#6b7a7e;margin:12px 0 6px">
        {es ? "Tu nombre (opcional)" : "Your name (optional)"}
      </label>
      <input
        type="text"
        value={name}
        onInput={(e) => setName((e.target as HTMLInputElement).value)}
        placeholder="Jane Doe"
        autoComplete="name"
        style="width:100%;padding:10px 12px;border:1px solid #e3e8e6;border-radius:10px;font-size:14px;color:#1c2c30;font-family:inherit;background:#fff"
      />
      {err && (
        <div style="margin-top:10px;color:#b3261e;font-size:13px">
          {es ? "No se pudo enviar — " : "Couldn't send — "}
          {err}
        </div>
      )}
      <button
        type="submit"
        disabled={status === "submitting"}
        style={`margin-top:14px;width:100%;background:#a83b3b;color:#fff;border:0;font-weight:800;font-size:14px;padding:12px 20px;border-radius:12px;cursor:${
          status === "submitting" ? "not-allowed" : "pointer"
        };opacity:${status === "submitting" ? 0.7 : 1}`}
      >
        {status === "submitting"
          ? (es ? "Enviando…" : "Sending…")
          : (es ? "Enviar rechazo" : "Send decline")}
      </button>
    </form>
  );
}

function AskForm(
  { quoteId, customerName, es, onCancel }: {
    quoteId: string;
    customerName?: string;
    es: boolean;
    onCancel: () => void;
  },
) {
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
      setErr(friendlyError((e as Error).message, es));
    }
  }

  if (status === "ok") {
    return (
      <div style="margin-top:18px;background:rgba(20,72,82,0.06);border:1px solid rgba(20,72,82,0.18);border-radius:14px;padding:18px 20px;text-align:center">
        <div style="font-weight:800;color:#144852;font-size:16px">
          {es ? "✓ Pregunta enviada" : "✓ Question sent"}
        </div>
        <div style="margin-top:6px;color:#6b7a7e;font-size:13px">
          {es
            ? "Tu contratista te responderá directamente."
            : "Your contractor will follow up directly."}
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      style="margin-top:18px;background:#fff;border:1px solid #e3e8e6;border-radius:14px;padding:18px 20px;text-align:left"
    >
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div style="font-weight:800;color:#144852;font-size:15px">
          {es ? "Hacer una pregunta" : "Ask a question"}
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close question form"
          style="background:transparent;border:0;color:#6b7a7e;font-size:18px;cursor:pointer;padding:0 4px"
        >
          ×
        </button>
      </div>
      <label style="display:block;font-size:11px;font-weight:700;letter-spacing:.10em;text-transform:uppercase;color:#6b7a7e;margin-bottom:6px">
        {es ? "Tu pregunta" : "Your question"}
      </label>
      <textarea
        value={question}
        onInput={(e) => setQuestion((e.target as HTMLTextAreaElement).value)}
        rows={3}
        placeholder={es
          ? "¿Cuál es el plazo si firmo el viernes?"
          : "What's the timeline if I sign by Friday?"}
        required
        style="width:100%;padding:10px 12px;border:1px solid #e3e8e6;border-radius:10px;font-size:14px;color:#1c2c30;font-family:inherit;background:#fff;resize:vertical"
      />
      <label style="display:block;font-size:11px;font-weight:700;letter-spacing:.10em;text-transform:uppercase;color:#6b7a7e;margin:12px 0 6px">
        {es
          ? "¿Cómo te contactan? (opcional)"
          : "How can they reach you? (optional)"}
      </label>
      <input
        type="text"
        value={contactBack}
        onInput={(e) => setContactBack((e.target as HTMLInputElement).value)}
        placeholder={es ? "Teléfono o correo" : "Phone or email"}
        style="width:100%;padding:10px 12px;border:1px solid #e3e8e6;border-radius:10px;font-size:14px;color:#1c2c30;font-family:inherit;background:#fff"
      />
      <label style="display:block;font-size:11px;font-weight:700;letter-spacing:.10em;text-transform:uppercase;color:#6b7a7e;margin:12px 0 6px">
        {es ? "Tu nombre (opcional)" : "Your name (optional)"}
      </label>
      <input
        type="text"
        value={name}
        onInput={(e) => setName((e.target as HTMLInputElement).value)}
        placeholder="Jane Doe"
        autoComplete="name"
        style="width:100%;padding:10px 12px;border:1px solid #e3e8e6;border-radius:10px;font-size:14px;color:#1c2c30;font-family:inherit;background:#fff"
      />
      {err && (
        <div style="margin-top:10px;color:#b3261e;font-size:13px">
          {es ? "No se pudo enviar — " : "Couldn't send — "}
          {err}
        </div>
      )}
      <button
        type="submit"
        disabled={status === "submitting" || !question.trim()}
        style={`margin-top:14px;width:100%;background:#144852;color:#fff;border:0;font-weight:800;font-size:14px;padding:12px 20px;border-radius:12px;cursor:${
          status === "submitting" || !question.trim()
            ? "not-allowed"
            : "pointer"
        };opacity:${status === "submitting" || !question.trim() ? 0.7 : 1}`}
      >
        {status === "submitting"
          ? (es ? "Enviando…" : "Sending…")
          : (es ? "Enviar pregunta" : "Send question")}
      </button>
    </form>
  );
}
