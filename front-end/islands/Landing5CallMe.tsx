import { useState } from "preact/hooks";
import { formatPhoneInput } from "../../shared/quote-flow/format-helpers.ts";
import { landingClient } from "../clients/landing.ts";
import type { Lang } from "../lib/lang.ts";

/**
 * REQ-149 — the "¿Necesitas ayuda? Te podemos llamar." card on /landing5 (the v5 mock): name,
 * cell and the consent box → `POST /demo-request` with `mode: "call"` — a call as soon as
 * possible, the same booking /landing2's Llámenme makes (REQ-117), here with the name the mock
 * collects (the team's email and the confirmation text name the person). The box starts ticked
 * (REQ-097) and gates the post, as on /landing2; an empty name or cell is answered on the page in
 * the page's language. Every string comes in as `labels` from the route.
 */
export interface Landing5CallMeLabels {
  helpH: string;
  name: string;
  namePh: string;
  phone: string;
  phonePh: string;
  callMe: string;
  sending: string;
  consent: string;
  consentTerms: string;
  errName: string;
  errPhone: string;
  errConsent: string;
  errSend: string;
  errRate: string;
  doneH: string;
  doneSub: string;
}

export default function Landing5CallMe(
  { lang, labels, smsTermsPath }: {
    lang: Lang;
    labels: Landing5CallMeLabels;
    smsTermsPath: string;
  },
) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  /** REQ-097 — ticked when the page opens; the person can untick it, and then the call waits */
  const [consent, setConsent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: Event) {
    e.preventDefault();
    setErr(null);
    if (!name.trim()) {
      setErr(labels.errName);
      return;
    }
    if (phone.replace(/\D/g, "").length < 10) {
      setErr(labels.errPhone);
      return;
    }
    if (!consent) {
      setErr(labels.errConsent);
      return;
    }
    setBusy(true);
    try {
      const res = await landingClient.requestDemo({
        mode: "call",
        name: name.trim(),
        phone: phone.trim(),
        email: "",
        day: "",
        time: "",
        lang,
        consent: true,
      });
      if (res.ok) setDone(true);
      else if (res.reason === "too_many_attempts") setErr(labels.errRate);
      else setErr(labels.errSend);
    } catch {
      setErr(labels.errSend);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div class="l2-thanks l5-help__done" data-cy="l5-callme-done">
        <div class="l2-tick l5-help__tick" aria-hidden="true">
          <svg
            width="26"
            height="26"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#fff"
            stroke-width="3.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M4 12l5 5L20 6" />
          </svg>
        </div>
        <h3 class="l2-h l5-help__doneH">{labels.doneH}</h3>
        <p class="l5-help__doneSub">{labels.doneSub}</p>
      </div>
    );
  }

  return (
    <form class="l5-help__form" onSubmit={submit} data-cy="l5-callme-form">
      <h2 class="l5-help__h">{labels.helpH}</h2>
      <div class="l5-help__two">
        <div>
          <label class="l2-sr" for="c-name">{labels.name}</label>
          <input
            id="c-name"
            class="l2-field"
            type="text"
            autoComplete="name"
            placeholder={labels.namePh}
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
        </div>
        <div>
          <label class="l2-sr" for="c-phone">{labels.phone}</label>
          <input
            id="c-phone"
            class="l2-field"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder={labels.phonePh}
            value={formatPhoneInput(phone)}
            onInput={(e) => setPhone((e.target as HTMLInputElement).value)}
          />
        </div>
      </div>
      {err ? <p class="l2-error" role="alert">{err}</p> : null}
      <button
        type="submit"
        class="l2-btn l2-btn--dark l5-help__send"
        data-cy="l5-callme-send"
        disabled={busy}
      >
        {busy ? labels.sending : labels.callMe}
      </button>
      <label class="l2-consent" for="c-consent">
        <input
          id="c-consent"
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent((e.target as HTMLInputElement).checked)}
        />
        <span>
          {labels.consent}
          <a href={smsTermsPath}>{labels.consentTerms}</a>
        </span>
      </label>
    </form>
  );
}
