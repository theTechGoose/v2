import { useState } from "preact/hooks";
import { landingClient } from "../clients/landing.ts";
import { ApiError } from "../lib/api.ts";

/**
 * ContactForm — the public inquiry form used by /contact. Posts
 * name/email/phone/subject/message and the SMS consent to the backend
 * ContactPublicController (POST /contact, proxied via /api/contact). All
 * copy is passed in as `labels` so the island stays language-agnostic — the
 * route resolves the language server-side (cookie / Accept-Language) and
 * hands strings down, matching the SSR render exactly (no toggle, no flash).
 *
 * REQ-068 (Hans's contact-page example): a Phone field and, under the
 * message, the SMS consent box — unchecked by default and never required
 * (the SMS Terms say consent is not a condition of anything) — whose text
 * links the Privacy Policy and the SMS Terms (`links`, from the route, so
 * the island spells no policy path).
 */
export interface ContactFormLabels {
  name: string;
  namePh: string;
  email: string;
  emailPh: string;
  phone: string;
  phonePh: string;
  subject: string;
  subjectPh: string;
  message: string;
  messagePh: string;
  smsConsent: string;
  smsPrivacy: string;
  smsAnd: string;
  smsTerms: string;
  smsEnd: string;
  submit: string;
  sending: string;
  success: string;
  errorRate: string;
  errorGeneric: string;
}

export interface ContactFormLinks {
  privacy: string;
  sms: string;
}

export default function ContactForm(
  { labels, links }: { labels: ContactFormLabels; links: ContactFormLinks },
) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [smsConsent, setSmsConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: Event) {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      const res = await landingClient.submitContact({
        name: name.trim(),
        email: email.trim(),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        subject: subject.trim(),
        message: message.trim(),
        smsConsent,
      });
      if (res.ok) {
        setDone(true);
      } else if (res.reason === "too_many_attempts") {
        setErr(labels.errorRate);
      } else {
        setErr(labels.errorGeneric);
      }
    } catch (error) {
      // Validation failures come back as a non-2xx (ApiError); everything
      // else (backend unreachable, etc.) also lands here.
      void (error instanceof ApiError ? error.status : 0);
      setErr(labels.errorGeneric);
    } finally {
      setSubmitting(false);
    }
  }

  const fieldStyle =
    "width:100%;box-sizing:border-box;padding:14px 16px;border:1px solid var(--border,#d8dcd5);border-radius:12px;font:inherit;font-size:16px;background:#fff;color:var(--fg)";
  const labelStyle =
    "display:block;font-size:13px;font-weight:700;color:var(--fg-muted,#6b7560);margin-bottom:6px";
  const linkStyle =
    "color:var(--brand-green,#519843);font-weight:700;text-decoration:underline;text-underline-offset:2px";

  if (done) {
    return (
      <div
        role="status"
        style="background:var(--mint-100,#eaf5e6);border:1px solid var(--brand-green,#519843);border-radius:14px;padding:24px;text-align:center;color:var(--fg)"
      >
        <div style="font-size:32px;line-height:1">✓</div>
        <p style="margin:10px 0 0;font-size:17px;font-weight:700">
          {labels.success}
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      style="display:flex;flex-direction:column;gap:14px;text-align:left"
    >
      <label style="display:block">
        <span style={labelStyle}>{labels.name}</span>
        <input
          type="text"
          autoComplete="name"
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
          placeholder={labels.namePh}
          required
          maxLength={120}
          style={fieldStyle}
        />
      </label>
      <label style="display:block">
        <span style={labelStyle}>{labels.email}</span>
        <input
          type="email"
          autoComplete="email"
          value={email}
          onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
          placeholder={labels.emailPh}
          required
          style={fieldStyle}
        />
      </label>
      <label style="display:block">
        <span style={labelStyle}>{labels.phone}</span>
        <input
          type="tel"
          autoComplete="tel"
          data-cy="contact-phone"
          value={phone}
          onInput={(e) => setPhone((e.target as HTMLInputElement).value)}
          placeholder={labels.phonePh}
          maxLength={40}
          style={fieldStyle}
        />
      </label>
      <label style="display:block">
        <span style={labelStyle}>{labels.subject}</span>
        <input
          type="text"
          data-cy="contact-subject"
          value={subject}
          onInput={(e) => setSubject((e.target as HTMLInputElement).value)}
          placeholder={labels.subjectPh}
          required
          maxLength={200}
          style={fieldStyle}
        />
      </label>
      <label style="display:block">
        <span style={labelStyle}>{labels.message}</span>
        <textarea
          value={message}
          onInput={(e) => setMessage((e.target as HTMLTextAreaElement).value)}
          placeholder={labels.messagePh}
          required
          maxLength={5000}
          rows={5}
          style={`${fieldStyle};resize:vertical;min-height:120px`}
        />
      </label>
      <label
        data-cy="contact-sms-consent-label"
        style="display:flex;gap:12px;align-items:flex-start;font-size:14px;line-height:1.5;color:var(--fg)"
      >
        <input
          type="checkbox"
          data-cy="contact-sms-consent"
          checked={smsConsent}
          onChange={(e) =>
            setSmsConsent((e.target as HTMLInputElement).checked)}
          style="width:24px;height:24px;flex-shrink:0;margin:0;accent-color:var(--brand-green,#519843)"
        />
        <span>
          {labels.smsConsent}{" "}
          <a
            href={links.privacy}
            data-cy="contact-sms-privacy"
            style={linkStyle}
          >
            {labels.smsPrivacy}
          </a>{" "}
          {labels.smsAnd}{" "}
          <a href={links.sms} data-cy="contact-sms-terms" style={linkStyle}>
            {labels.smsTerms}
          </a>
          {labels.smsEnd}
        </span>
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
        {submitting ? labels.sending : labels.submit}
      </button>
    </form>
  );
}
