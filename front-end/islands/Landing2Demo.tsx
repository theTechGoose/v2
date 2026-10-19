import { useState } from "preact/hooks";
import { formatPhoneInput } from "../../shared/quote-flow/format-helpers.ts";
import {
  type DemoDay,
  demoDayLabel,
  type DemoSlot,
  demoSlotLabel,
} from "../../shared/demo-booking/mod.ts";
import { landingClient } from "../clients/landing.ts";
import type { Lang } from "../lib/lang.ts";

/**
 * REQ-090 — the demo card on /landing2, the v3 mock (Raphael, 2026-10-18: "the demo is one card —
 * Llámenme with just a cell books a call as soon as possible, or the person picks one of five
 * days from tomorrow and a morning or afternoon window, name, cell and email, with its own
 * consent box"). Two forms in one card: the one-field form (the cell, Llámenme) and, behind
 * "Mejor elijo día y hora", the day picker (the five the route hands down, from tomorrow,
 * Eastern), the two windows, the name, the cell, the email (optional), and a summary that follows
 * every pick. Each posts to POST /demo-request — which emails the team with the consent on record,
 * texts the person and makes the phone a lead — only once the consent box is ticked, and shows
 * the confirmation the mock drew. Every string comes in as `labels` from the route, so the island
 * renders exactly what the server did.
 */
export interface Landing2DemoLabels {
  callMe: string;
  consent: string;
  consentTerms: string;
  pickTimeLink: string;
  quickLink: string;
  pickDay: string;
  /** REQ-095 — the window group's name, as the day group has one (REQ-096: the thanks is an h3) */
  pickSlot: string;
  name: string;
  namePh: string;
  phone: string;
  email: string;
  emailPh: string;
  submitDemo: string;
  submitting: string;
  sumDemo: string;
  errName: string;
  errPhoneReq: string;
  errEmailBad: string;
  errConsent: string;
  errSubmit: string;
  errRateDemo: string;
  thanksH: string;
  thanksSub: string;
  thanksNoText: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toE164(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (raw.trim().startsWith("+")) return "+" + digits;
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return "+" + digits;
}

type View = "quick" | "pick";

export default function Landing2Demo(
  { lang, labels, days, slots, smsTermsPath }: {
    lang: Lang;
    labels: Landing2DemoLabels;
    days: DemoDay[];
    slots: readonly DemoSlot[];
    /** the SMS terms the consent line links to (LEGAL_LINKS, REQ-076) */
    smsTermsPath: string;
  },
) {
  const [view, setView] = useState<View>("quick");
  const [day, setDay] = useState(0);
  const [slot, setSlot] = useState(0);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  /** the consent box: unticked until the person ticks it; both forms wait for it */
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<{ texted: boolean } | null>(null);

  const picked = days[day] ?? days[0];
  const window = slots[slot] ?? slots[0];

  async function post(input: Parameters<typeof landingClient.requestDemo>[0]) {
    setBusy(true);
    try {
      const res = await landingClient.requestDemo(input);
      if (res.ok) {
        setSent({ texted: res.texted });
      } else if (res.reason === "too_many_attempts") {
        setErr(labels.errRateDemo);
      } else if (
        res.reason === "invalid" && "field" in res && res.field === "phone"
      ) {
        setErr(labels.errPhoneReq);
      } else if (
        res.reason === "invalid" && "field" in res && res.field === "email"
      ) {
        setErr(labels.errEmailBad);
      } else {
        setErr(labels.errSubmit);
      }
    } catch {
      setErr(labels.errSubmit);
    } finally {
      setBusy(false);
    }
  }

  /** Llámenme: just the cell — a call as soon as possible */
  function submitCall(e: Event) {
    e.preventDefault();
    setErr(null);
    const e164 = toE164(phone);
    if (e164.replace(/\D/g, "").length < 10) return setErr(labels.errPhoneReq);
    if (!consent) return setErr(labels.errConsent);
    void post({
      mode: "call",
      name: "",
      phone: e164,
      email: "",
      day: "",
      slot: "",
      lang,
      consent: true,
    });
  }

  /** the day, the window and the details — a demo */
  function submitDemo(e: Event) {
    e.preventDefault();
    setErr(null);
    if (!name.trim()) return setErr(labels.errName);
    const e164 = toE164(phone);
    if (e164.replace(/\D/g, "").length < 10) return setErr(labels.errPhoneReq);
    const mail = email.trim();
    if (mail && !EMAIL_RE.test(mail)) return setErr(labels.errEmailBad);
    if (!consent) return setErr(labels.errConsent);
    void post({
      mode: "demo",
      name: name.trim(),
      phone: e164,
      email: mail,
      day: picked.iso,
      slot: window.id,
      lang,
      consent: true,
    });
  }

  if (sent) {
    return (
      <div class="l2-thanks" data-cy="l2-demo-done">
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
        <h3 class="l2-h l2-thanks__h">{labels.thanksH}</h3>
        <p class="l2-thanks__sub">
          {sent.texted ? labels.thanksSub : labels.thanksNoText}
        </p>
      </div>
    );
  }

  const consentBox = (
    <label class="l2-consent" for="demo-consent">
      <input
        id="demo-consent"
        type="checkbox"
        checked={consent}
        onChange={(e) => setConsent((e.target as HTMLInputElement).checked)}
      />
      <span>
        {labels.consent}
        <a href={smsTermsPath}>{labels.consentTerms}</a>
      </span>
    </label>
  );

  if (view === "quick") {
    return (
      <form class="l2-stack" onSubmit={submitCall} data-cy="l2-demo-form">
        <div class="l2-demo__row">
          <label for="demo-phone" class="l2-sr">{labels.phone}</label>
          <input
            id="demo-phone"
            class="l2-field"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="(555) 123-4567"
            value={formatPhoneInput(phone)}
            onInput={(e) => setPhone((e.target as HTMLInputElement).value)}
          />
          <button
            type="submit"
            class="l2-btn l2-btn--dark"
            data-cy="l2-demo-call"
            disabled={busy}
          >
            {busy ? labels.submitting : labels.callMe}
          </button>
        </div>
        {err ? <p class="l2-error" role="alert">{err}</p> : null}
        {consentBox}
        <button
          type="button"
          class="l2-link-btn l2-link-btn--start"
          data-cy="l2-pick-time"
          onClick={() => {
            setErr(null);
            setView("pick");
          }}
        >
          {labels.pickTimeLink}
        </button>
      </form>
    );
  }

  return (
    <form class="l2-stack" onSubmit={submitDemo} data-cy="l2-demo-form">
      <div>
        <span class="l2-lbl">{labels.pickDay}</span>
        <div class="l2-demo__days" role="group" aria-label={labels.pickDay}>
          {days.map((d, i) => (
            <button
              type="button"
              key={d.iso}
              class={`l2-day ${i === day ? "on" : ""}`}
              data-cy="l2-day"
              data-day={d.iso}
              aria-pressed={i === day}
              onClick={() => setDay(i)}
            >
              <span class="l2-day__dow">{d.dow}</span>
              <span class="l2-day__num">{d.num}</span>
            </button>
          ))}
        </div>
      </div>
      <div class="l2-demo__slots" role="group" aria-label={labels.pickSlot}>
        {slots.map((s, i) => (
          <button
            type="button"
            key={s.id}
            class={`l2-slot ${i === slot ? "on" : ""}`}
            data-cy="l2-slot"
            aria-pressed={i === slot}
            onClick={() => setSlot(i)}
          >
            {s.short[lang]}
          </button>
        ))}
      </div>
      <div class="l2-demo__pair">
        <div>
          <label class="l2-lbl" for="f-name">{labels.name}</label>
          <input
            id="f-name"
            class="l2-field l2-field--sm"
            type="text"
            autoComplete="name"
            placeholder={labels.namePh}
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
        </div>
        <div>
          <label class="l2-lbl" for="f-phone">{labels.phone}</label>
          <input
            id="f-phone"
            class="l2-field l2-field--sm"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="(555) 123-4567"
            value={formatPhoneInput(phone)}
            onInput={(e) => setPhone((e.target as HTMLInputElement).value)}
          />
        </div>
      </div>
      <div>
        <label class="l2-lbl" for="f-email">{labels.email}</label>
        <input
          id="f-email"
          class="l2-field l2-field--sm"
          type="email"
          autoComplete="email"
          placeholder={labels.emailPh}
          value={email}
          onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
        />
      </div>
      {consentBox}
      <div class="l2-summary" data-cy="l2-demo-summary">
        <strong>{labels.sumDemo}</strong> · {demoDayLabel(picked.iso, lang)} ·
        {" "}
        {demoSlotLabel(window.id, lang)}
      </div>
      {err ? <p class="l2-error" role="alert">{err}</p> : null}
      <button
        type="submit"
        class="l2-btn l2-btn--dark l2-btn--full"
        data-cy="l2-demo-submit"
        disabled={busy}
      >
        {busy ? labels.submitting : labels.submitDemo}
      </button>
      <button
        type="button"
        class="l2-link-btn l2-link-btn--start"
        data-cy="l2-quick-mode"
        onClick={() => {
          setErr(null);
          setView("quick");
        }}
      >
        {labels.quickLink}
      </button>
    </form>
  );
}
