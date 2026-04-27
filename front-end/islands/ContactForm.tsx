import { useState } from "preact/hooks";
import { langSignal, STRINGS } from "../lib/lang.ts";
import { landingClient } from "../clients/landing.ts";
import { ApiError } from "../lib/api.ts";

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

export default function ContactForm() {
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const lang = langSignal.value;
  const s = STRINGS[lang];

  async function onSubmit(e: Event) {
    e.preventDefault();
    setErr(null);
    const e164 = toE164(phone);
    if (e164.replace(/\D/g, "").length < 10) {
      setErr(lang === "es" ? "Número incompleto" : "Phone number is incomplete");
      return;
    }
    setSubmitting(true);
    try {
      await landingClient.sendOtp({ phoneNumber: e164, language: lang });
      globalThis.location.href = `/verify?phone=${encodeURIComponent(e164)}`;
    } catch (error) {
      const msg = error instanceof ApiError
        ? `${error.status}`
        : (lang === "es" ? "No se pudo enviar." : "Couldn't send.");
      setErr(lang === "es" ? `Error: ${msg}` : `Error: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form class="contact-card" onSubmit={onSubmit}>
      <div class="col" style="gap:14px">
        <span class="eyebrow-pill">{s["contact.eyebrow"] as string}</span>
        <h3 style="font-size:28px">{s["contact.title"] as string}</h3>
        <p class="muted">{s["contact.lede"] as string}</p>
      </div>
      <div class="col" style="gap:16px">
        <div class="field">
          <label htmlFor="phone">{s["contact.phone"] as string}</label>
          <input
            id="phone"
            name="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            value={formatPhoneDisplay(phone)}
            onInput={(e) => setPhone((e.target as HTMLInputElement).value)}
            placeholder={s["contact.placeholder"] as string}
            required
          />
        </div>
        {err ? <p class="error" role="alert">{err}</p> : null}
        <button class="btn btn-primary btn-lg" type="submit" disabled={submitting}>
          {submitting ? "…" : (s["contact.cta"] as string)}
        </button>
      </div>
    </form>
  );
}
