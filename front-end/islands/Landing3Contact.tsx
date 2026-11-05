import { useState } from "preact/hooks";
import { formatPhoneInput } from "../../shared/quote-flow/format-helpers.ts";
import { landingClient } from "../clients/landing.ts";

/**
 * REQ-147 — the "Contáctanos" card on /landing3 and /landing4 (the v3/v4 mocks): name, cell,
 * email, an optional message and the consent box → `POST /contact`, the public inquiry endpoint
 * /contact posts to (ContactPublicController: the team's inbox gets the email, 5 an hour per
 * address). The box starts ticked (REQ-097, as every consent box on /landing2) and is on record
 * with the inquiry as `smsConsent`; it is not a condition of writing to us (the SMS terms), so an
 * unticked box still sends. The subject is the page's own line; an empty message is sent as the
 * dictionary's "(no message)" — the endpoint takes no empty message. Every string comes in as
 * `labels` from the route, so the island renders exactly what the server did.
 */
export interface Landing3ContactLabels {
  name: string;
  namePh: string;
  phone: string;
  phonePh: string;
  email: string;
  emailPh: string;
  msg: string;
  optional: string;
  msgPh: string;
  consent: string;
  consentTerms: string;
  send: string;
  sending: string;
  errName: string;
  errEmail: string;
  errSend: string;
  errRate: string;
  doneH: string;
  doneSub: string;
  subject: string;
  noMsg: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Landing3Contact(
  { labels, smsTermsPath }: {
    labels: Landing3ContactLabels;
    smsTermsPath: string;
  },
) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  /** REQ-097 — ticked when the page opens; the person can untick it */
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
    if (!EMAIL_RE.test(email.trim())) {
      setErr(labels.errEmail);
      return;
    }
    setBusy(true);
    try {
      const res = await landingClient.submitContact({
        name: name.trim(),
        email: email.trim(),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        subject: labels.subject,
        message: msg.trim() || labels.noMsg,
        smsConsent: consent,
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
      <div class="l2-thanks" data-cy="l3-contact-done">
        <div class="l2-tick" aria-hidden="true">
          <svg
            width="30"
            height="30"
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
        <h3 class="l2-h l2-thanks__h">{labels.doneH}</h3>
        <p class="l2-thanks__sub">{labels.doneSub}</p>
      </div>
    );
  }

  return (
    <form class="l3-form" onSubmit={submit} data-cy="l3-contact-form">
      <div class="l3-form__two">
        <div>
          <label class="l2-lbl" for="c-name">{labels.name}</label>
          <input
            id="c-name"
            class="l2-field l2-field--sm"
            type="text"
            autoComplete="name"
            placeholder={labels.namePh}
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
        </div>
        <div>
          <label class="l2-lbl" for="c-phone">{labels.phone}</label>
          <input
            id="c-phone"
            class="l2-field l2-field--sm"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder={labels.phonePh}
            value={formatPhoneInput(phone)}
            onInput={(e) => setPhone((e.target as HTMLInputElement).value)}
          />
        </div>
      </div>
      <div>
        <label class="l2-lbl" for="c-email">{labels.email}</label>
        <input
          id="c-email"
          class="l2-field l2-field--sm"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder={labels.emailPh}
          value={email}
          onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
        />
      </div>
      <div>
        <label class="l2-lbl" for="c-msg">
          {labels.msg} <span class="l3-optional">{labels.optional}</span>
        </label>
        <textarea
          id="c-msg"
          class="l2-field l2-field--sm"
          placeholder={labels.msgPh}
          value={msg}
          onInput={(e) => setMsg((e.target as HTMLTextAreaElement).value)}
        />
      </div>
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
      {err ? <p class="l2-error" role="alert">{err}</p> : null}
      <button
        type="submit"
        class="l2-btn l2-btn--dark l2-btn--full"
        data-cy="l3-contact-send"
        disabled={busy}
      >
        {busy ? labels.sending : labels.send}
      </button>
    </form>
  );
}
