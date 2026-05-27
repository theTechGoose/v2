import { useState } from "preact/hooks";
import { langSignal } from "../lib/lang.ts";
import { landingClient } from "../clients/landing.ts";
import { ApiError } from "../lib/api.ts";

/**
 * LoginForm — the clean, login-branded phone entry used by /login
 * (roadmap p.13). Reuses the exact same OTP flow as the landing contact
 * form: send a code, then hand off to /verify for the 6-digit step.
 */
function formatPhoneDisplay(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  const a = digits.slice(0, 3), b = digits.slice(3, 6), c = digits.slice(6);
  if (digits.length <= 3) return a;
  if (digits.length <= 6) return `(${a}) ${b}`;
  return `(${a}) ${b}-${c}`;
}

function toE164(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+")) return "+" + digits;
  if (digits.length === 10) return "+1" + digits;
  return "+" + digits;
}

export default function LoginForm() {
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const lang = langSignal.value;
  const es = lang === "es";

  async function onSubmit(e: Event) {
    e.preventDefault();
    setErr(null);
    const e164 = toE164(phone);
    if (e164.replace(/\D/g, "").length < 10) {
      setErr(es ? "Número incompleto" : "Phone number is incomplete");
      return;
    }
    setSubmitting(true);
    try {
      await landingClient.sendOtp({ phoneNumber: e164, language: lang });
      globalThis.location.href = `/verify?phone=${encodeURIComponent(e164)}`;
    } catch (error) {
      const msg = error instanceof ApiError
        ? `${error.status}`
        : (es ? "No se pudo enviar." : "Couldn't send.");
      setErr(`Error: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  }

  const inputStyle =
    "width:100%;box-sizing:border-box;padding:14px 16px;border:1px solid var(--border,#d8dcd5);border-radius:12px;font:inherit;font-size:17px;background:#fff;color:var(--fg)";

  return (
    <form
      onSubmit={onSubmit}
      style="display:flex;flex-direction:column;gap:14px;text-align:left"
    >
      <label style="display:block">
        <span style="display:block;font-size:13px;font-weight:700;color:var(--fg-muted,#6b7560);margin-bottom:6px">
          {es ? "Tu celular" : "Your phone number"}
        </span>
        <input
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          autoFocus
          value={formatPhoneDisplay(phone)}
          onInput={(e) => setPhone((e.target as HTMLInputElement).value)}
          placeholder="(555) 123-4567"
          required
          style={inputStyle}
        />
      </label>
      {err
        ? (
          <p style="color:#a83b3b;font-size:14px;margin:0" role="alert">
            {err}
          </p>
        )
        : null}
      <button
        type="submit"
        disabled={submitting}
        style="appearance:none;border:0;border-radius:12px;padding:14px 18px;background:var(--brand-green,#519843);color:#fff;font:inherit;font-weight:800;font-size:16px;cursor:pointer"
      >
        {submitting ? "…" : (es ? "Enviar código" : "Text me a code")}
      </button>
      <p style="color:var(--fg-muted,#6b7560);font-size:13px;margin:2px 0 0;text-align:center">
        {es
          ? "Te enviaremos un código de 6 dígitos por mensaje."
          : "We'll text you a 6-digit code to sign in."}
      </p>
    </form>
  );
}
