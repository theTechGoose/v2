import { useState } from "preact/hooks";
import { formatPhoneInput } from "../../shared/quote-flow/format-helpers.ts";
import {
  DEFAULT_SLOT_INDEX,
  type DemoDay,
} from "../../shared/demo-booking/mod.ts";
import { landingClient } from "../clients/landing.ts";
import type { Lang } from "../lib/lang.ts";

/**
 * REQ-081 — the demo booking card on /landing2: demo or call, a day (the seven the route hands
 * down, from tomorrow, Eastern), an hour (the twelve), the person's details, a summary that
 * follows every pick, then POST /demo-request — which emails the team, texts the person and
 * makes the phone a lead — and the confirmation the mock drew. Every string comes in as
 * `labels` from the route, so the island renders exactly what the server did.
 */
export interface Landing2DemoLabels {
  modeDemo: string;
  modeCall: string;
  pickDay: string;
  pickTime: string;
  eastern: string;
  name: string;
  namePh: string;
  phone: string;
  email: string;
  emailNote: string;
  emailPh: string;
  noEmail: string;
  trade: string;
  optional: string;
  tradePh: string;
  submitDemo: string;
  submitCall: string;
  submitting: string;
  sumDemo: string;
  sumCall: string;
  formNote: string;
  errName: string;
  errPhoneReq: string;
  errEmailReq: string;
  errEmailBad: string;
  errSubmit: string;
  errRateDemo: string;
  thanksH: string;
  thanksSub: string;
  thanksNoText: string;
  navCta: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toE164(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (raw.trim().startsWith("+")) return "+" + digits;
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return "+" + digits;
}

export default function Landing2Demo(
  { lang, labels, days, slots }: {
    lang: Lang;
    labels: Landing2DemoLabels;
    days: DemoDay[];
    slots: readonly string[];
  },
) {
  const [mode, setMode] = useState<"demo" | "call">("demo");
  const [day, setDay] = useState(0);
  const [slot, setSlot] = useState(DEFAULT_SLOT_INDEX);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [noEmail, setNoEmail] = useState(false);
  const [trade, setTrade] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<{ texted: boolean } | null>(null);

  const picked = days[day] ?? days[0];
  const summaryMode = mode === "demo" ? labels.sumDemo : labels.sumCall;
  const summaryDay = `${picked.dow} ${picked.num} ${picked.mon}`;
  const summarySlot = `${slots[slot]} (${labels.eastern})`;
  const summary = `${summaryMode} · ${summaryDay} · ${summarySlot}`;

  async function submit(e: Event) {
    e.preventDefault();
    setErr(null);
    if (!name.trim()) return setErr(labels.errName);
    const e164 = toE164(phone);
    if (e164.replace(/\D/g, "").length < 10) return setErr(labels.errPhoneReq);
    const mail = email.trim();
    if (mail && !EMAIL_RE.test(mail)) return setErr(labels.errEmailBad);
    if (mode === "demo" && !mail && !noEmail) return setErr(labels.errEmailReq);
    setBusy(true);
    try {
      const res = await landingClient.requestDemo({
        mode,
        name: name.trim(),
        phone: e164,
        email: noEmail ? "" : mail,
        noEmail,
        trade: trade.trim(),
        day: picked.iso,
        slot: slots[slot],
        lang,
      });
      if (res.ok) {
        setSent({ texted: res.texted });
      } else if (res.reason === "too_many_attempts") {
        setErr(labels.errRateDemo);
      } else if (
        res.reason === "invalid" && "field" in res && res.field === "email"
      ) {
        setErr(labels.errEmailReq);
      } else if (
        res.reason === "invalid" && "field" in res && res.field === "phone"
      ) {
        setErr(labels.errPhoneReq);
      } else {
        setErr(labels.errSubmit);
      }
    } catch {
      setErr(labels.errSubmit);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div class="l2-thanks" data-cy="l2-demo-done">
        <div class="l2-tick l2-tick--lg" aria-hidden="true">
          <svg
            width="34"
            height="34"
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
        <div class="l2-h l2-thanks__h">{labels.thanksH}</div>
        <p class="l2-thanks__sum">{summary}</p>
        <p class="l2-thanks__sub">
          {sent.texted ? labels.thanksSub : labels.thanksNoText}
        </p>
        <a
          class="l2-btn l2-btn--primary"
          href="#empezar"
          style="margin-top: 6px"
        >
          {labels.navCta}
        </a>
      </div>
    );
  }

  return (
    <form
      class="l2-stack"
      style="gap: 16px"
      onSubmit={submit}
      data-cy="l2-demo-form"
    >
      <div class="l2-row" style="gap: 8px">
        <button
          type="button"
          class={`l2-seg ${mode === "demo" ? "on" : ""}`}
          data-cy="l2-mode-demo"
          onClick={() => setMode("demo")}
        >
          {labels.modeDemo}
        </button>
        <button
          type="button"
          class={`l2-seg ${mode === "call" ? "on" : ""}`}
          data-cy="l2-mode-call"
          onClick={() => setMode("call")}
        >
          {labels.modeCall}
        </button>
      </div>
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
              <span class="l2-day__mon">{d.mon}</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <span class="l2-lbl">
          {labels.pickTime} <small>({labels.eastern})</small>
        </span>
        <div class="l2-demo__slots" role="group" aria-label={labels.pickTime}>
          {slots.map((s, i) => (
            <button
              type="button"
              key={s}
              class={`l2-slot ${i === slot ? "on" : ""}`}
              data-cy="l2-slot"
              aria-pressed={i === slot}
              onClick={() => setSlot(i)}
            >
              {s}
            </button>
          ))}
        </div>
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
        <label class="l2-lbl" for="f-email">
          {labels.email} <small>({labels.emailNote})</small>
        </label>
        <input
          id="f-email"
          class="l2-field l2-field--sm"
          type="email"
          autoComplete="email"
          placeholder={labels.emailPh}
          value={email}
          disabled={noEmail}
          onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
        />
        <label for="f-noemail" class="l2-checkbox">
          <input
            id="f-noemail"
            type="checkbox"
            checked={noEmail}
            onChange={(e) => setNoEmail((e.target as HTMLInputElement).checked)}
          />
          {labels.noEmail}
        </label>
      </div>
      <div>
        <label class="l2-lbl" for="f-trade">
          {labels.trade} <small>({labels.optional})</small>
        </label>
        <input
          id="f-trade"
          class="l2-field l2-field--sm"
          type="text"
          placeholder={labels.tradePh}
          value={trade}
          onInput={(e) => setTrade((e.target as HTMLInputElement).value)}
        />
      </div>
      <div class="l2-summary" data-cy="l2-demo-summary">
        <strong>{summaryMode}</strong> · {summaryDay} · {summarySlot}
      </div>
      {err ? <p class="l2-error" role="alert">{err}</p> : null}
      <button
        type="submit"
        class="l2-btn l2-btn--green l2-btn--full"
        data-cy="l2-demo-submit"
        disabled={busy}
      >
        {busy
          ? labels.submitting
          : mode === "demo"
          ? labels.submitDemo
          : labels.submitCall}
      </button>
      <p class="l2-form-note">{labels.formNote}</p>
    </form>
  );
}
