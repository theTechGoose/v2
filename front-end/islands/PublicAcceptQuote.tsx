import { useState } from "preact/hooks";
import { type Lang, tFor } from "../lib/i18n.ts";

interface Props {
  quoteId: string;
  contractorFirstName?: string;
  /** Notify parent so it can hide its sibling Decline/Ask buttons. */
  onAccepted?: () => void;
  /** Render directly in the success state (used when remounted by parent). */
  initialAccepted?: boolean;
  /** Outgoing-comms language (roadmap p.13). Customer-facing. */
  lang?: "en" | "es";
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
function friendlyError(raw: string, lang: Lang = "en"): string {
  const acc = tFor(lang, "publicAcceptQuote.error.alreadyAccepted");
  const dec = tFor(lang, "publicAcceptQuote.error.alreadyDeclined");
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
  return tFor(lang, "publicAcceptQuote.error.generic");
}

export default function PublicAcceptQuote(
  { quoteId, contractorFirstName, onAccepted, initialAccepted, lang = "en" }:
    Props,
) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<"idle" | "ok" | "error">(
    initialAccepted ? "ok" : "idle",
  );
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
        body: JSON.stringify(
          name.trim() ? { name: name.trim(), signature: name.trim() } : {},
        ),
      });
      const text = await r.text().catch(() => "");
      if (!r.ok) throw new Error(text.slice(0, 200) || `${r.status}`);
      try {
        const parsed = JSON.parse(text || "{}") as { ok?: boolean };
        if (parsed && parsed.ok === false) throw new Error(text);
      } catch (parseErr) {
        if (parseErr instanceof Error && parseErr.message === text) {
          throw parseErr;
        }
      }
      setStatus("ok");
      onAccepted?.();
    } catch (e) {
      setStatus("error");
      setErr(friendlyError((e as Error).message, lang));
    } finally {
      setSubmitting(false);
    }
  }

  if (status === "ok") {
    const who = contractorFirstName?.trim();
    return (
      <div style="margin-top:24px;background:rgba(81,152,67,0.10);border:1px solid rgba(72,158,95,0.30);border-radius:14px;padding:18px 20px;text-align:center">
        <div style="font-weight:800;color:#519843;font-size:16px">
          {"✓ "}
          {tFor(lang, "publicAcceptQuote.success.title")}
        </div>
        <div style="margin-top:6px;color:#6b7a7e;font-size:13px">
          {who
            ? tFor(lang, "publicAcceptQuote.success.subNamed", { name: who })
            : tFor(lang, "publicAcceptQuote.success.sub")}
        </div>
      </div>
    );
  }

  const disabled = submitting || !name.trim();
  // Disabled state uses a darker muted teal (per audit P5.4) for AA contrast on white text.
  const bg = disabled ? "#7a9a73" : "#519843";

  return (
    <form onSubmit={onAccept} style="margin-top:24px;text-align:left;">
      <label style="display:block;font-size:11px;font-weight:700;letter-spacing:.10em;text-transform:uppercase;color:#6b7a7e;margin-bottom:6px;">
        {tFor(lang, "publicAcceptQuote.nameLabel")}
      </label>
      <input
        type="text"
        value={name}
        onInput={(e) => setName((e.target as HTMLInputElement).value)}
        placeholder={tFor(lang, "publicAcceptQuote.namePlaceholder")}
        autoComplete="name"
        style="width:100%;padding:12px 14px;border:1px solid #e3e8e6;border-radius:10px;font-size:15px;color:#1c2c30;font-family:inherit;background:#fff;"
        required
        aria-describedby="accept-hint"
      />
      {!name.trim() && !err && (
        <div
          id="accept-hint"
          style="margin-top:8px;color:#6b7a7e;font-size:12px"
        >
          {tFor(lang, "publicAcceptQuote.hint")}
        </div>
      )}
      {err
        ? (
          <div style="margin-top:10px;color:#b3261e;font-size:13px">
            {tFor(lang, "publicAcceptQuote.errorPrefix")}
            {err}
          </div>
        )
        : null}
      <button
        type="submit"
        disabled={disabled}
        aria-disabled={disabled}
        style={`margin-top:16px;width:100%;background:${bg};color:#fff;border:0;font-weight:800;font-size:15px;padding:14px 28px;border-radius:12px;box-shadow:0 6px 14px rgba(81,152,67,0.35);cursor:${
          disabled ? "not-allowed" : "pointer"
        };`}
      >
        {submitting
          ? tFor(lang, "publicAcceptQuote.submitting")
          : `${tFor(lang, "publicAcceptQuote.submit")} →`}
      </button>
    </form>
  );
}
