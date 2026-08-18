import { useState } from "preact/hooks";
import { landingClient } from "../clients/landing.ts";
import { type Lang } from "../lib/lang.ts";
import { tFor } from "../lib/i18n.ts";

/**
 * TrialSignup — the "Start My Free Trial" phone form on the /landing promo
 * page. Reuses the exact OTP flow as the main landing/login: POST the number
 * to /auth/send-otp, then hand off to /verify for the 6-digit step.
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

export default function TrialSignup({ lang = "es" }: { lang?: Lang }) {
  const t = (k: string) => tFor(lang, `promoLanding.${k}`);
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: Event) {
    e.preventDefault();
    setErr(null);
    const e164 = toE164(phone);
    if (e164.replace(/\D/g, "").length < 10) {
      setErr(t("formInvalid"));
      return;
    }
    setSubmitting(true);
    try {
      await landingClient.sendOtp({ phoneNumber: e164, language: lang });
      try {
        localStorage.setItem("pm:last-phone", e164);
      } catch { /* private mode */ }
      // P-39: carry the signup origin in the URL (survives reload) so
      // /verify's "Wrong number? Edit" link can return to THIS form
      // instead of the main "/" landing.
      globalThis.location.href = `/verify?phone=${
        encodeURIComponent(e164)
      }&lang=${lang}&from=landing`;
    } catch (_error) {
      setErr(t("formError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form class="pm-trial-form" onSubmit={onSubmit}>
      <label class="pm-trial-form__label" for="trial-phone">
        {t("formPhoneLabel")}
      </label>
      <input
        id="trial-phone"
        name="phone"
        class="pm-trial-input"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={formatPhoneDisplay(phone)}
        onInput={(e) => setPhone((e.target as HTMLInputElement).value)}
        placeholder="(555) 123-4567"
        required
      />
      {err ? <p class="pm-trial-error" role="alert">{err}</p> : null}
      <button
        class="pm-btn pm-btn--primary pm-btn--lg"
        type="submit"
        disabled={submitting}
      >
        {submitting ? t("formSending") : t("formSubmit")}
      </button>
      <p class="pm-trial-fine">
        {t("formFine")}
      </p>
    </form>
  );
}
