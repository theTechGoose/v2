import { useEffect, useRef, useState } from "preact/hooks";
import { formatPhoneInput } from "../../shared/quote-flow/format-helpers.ts";
import { firePixelEvent, leadEvent } from "../../shared/meta-pixel/pixel.ts";
import { landingClient } from "../clients/landing.ts";
import { verifyClient } from "../clients/verify.ts";
import { ApiError } from "../lib/api.ts";
import type { Lang } from "../lib/lang.ts";
import DevCodeCard from "../components/DevCodeCard.tsx";

/**
 * REQ-081 — the signup card in /landing2's hero: phone → code → the app, all on the page, the way
 * the mock drew it. The same OTP endpoints as every other sign-in (POST /auth/send-otp, then
 * /auth/verify-otp), so the account, the CRM lead (REQ-060/072) and the session are the real
 * ones; the Lead pixel fires here when the code goes out (REQ-080: the code step is on this page,
 * not on /verify, so the page fires it itself — once per browser, by the same id). A number that
 * belongs to a closed account goes to /verify, where the recover-or-start-fresh choice lives. The
 * right code goes straight into the app (Raphael: "once it goes here it should just go to the app").
 *
 * REQ-089 — the v3 card (Raphael, 2026-10-18: "the signup card is the mock's — the phone and
 * Empezar gratis, a TCPA consent box unchecked by default that has to be ticked before the code
 * goes out, and the ¿Prefieres hablar? phone row"): the consent box starts unticked and the code
 * is held on the page until it is ticked — nothing is posted, no Lead fires; the row under it
 * dials the support line the route hands in.
 *
 * REQ-083 — the card tells the signup in motion: each digit pops in and the button charges at
 * ten; "Get started" slams, a text bubble launches from it, the monster bounces and the card flips
 * to the code step; the code is six slots the digits pop into — from the keyboard or the dev popup
 * (REQ-082), which types itself in — and the sixth digit submits; a wrong
 * code shakes; the right one draws a check, bursts confetti and lifts the card off into the app.
 * The monster is told through one DOM event. Reduced motion turns all of it off: the plain flow.
 *
 * REQ-094 — the phone field carries no `required`: an empty Empezar gratis is answered by
 * errPhone on the page, in the page's language, not by the browser's tooltip in the browser's.
 * REQ-096 — the card's title is a heading (h2) on both steps, so a heading list finds the signup.
 *
 * Every string comes in as `labels` from the route, so the island renders exactly what the server
 * did (no flash, no second dictionary on the client).
 */
export interface Landing2SignupLabels {
  regH: string;
  phoneLbl: string;
  sendCode: string;
  sending: string;
  consentA: string;
  consentTerms: string;
  errConsent: string;
  preferTalk: string;
  codeSentTo: string;
  codeLbl: string;
  confirm: string;
  confirming: string;
  resend: string;
  errPhone: string;
  errSend: string;
  errCooldown: string;
  errCode: string;
  errExpired: string;
  errRate: string;
}

function toE164(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (raw.trim().startsWith("+")) return "+" + digits;
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return "+" + digits;
}

const CODE_LEN = 6;
const TYPE_MS = 90;
const COLORS = ["#3ea448", "#f4a125", "#e8457c", "#3d9b96", "#15202b"];
/** the burst: twenty-four pieces fanned out from the check — three rings, squares and bars, four delays */
const CONFETTI = Array.from({ length: 24 }, (_, i) => {
  const a = (i / 24) * Math.PI * 2 + (i % 2) * 0.13;
  const d = 150 + (i % 3) * 60;
  return {
    dx: Math.round(Math.cos(a) * d),
    dy: Math.round(Math.sin(a) * d - 60),
    rot: 180 + i * 50,
    c: COLORS[i % COLORS.length],
    delay: (i % 4) * 45,
    w: i % 3 === 0 ? 18 : 12,
    h: i % 3 === 0 ? 8 : 12,
  };
});

/** the person asked for no motion: the flow runs without the choreography */
function still(): boolean {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ??
    false;
}
function monster(mood: "lean" | "rest" | "bounce") {
  globalThis.document?.dispatchEvent(
    new CustomEvent("l2:monster", { detail: mood }),
  );
}

type Step = 1 | 2;
type Flip = "out" | "in" | null;

function PhoneIcon() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.9 2z" />
    </svg>
  );
}

export default function Landing2Signup(
  { lang, labels, smsTermsPath, phoneHref, phoneLabel }: {
    lang: Lang;
    labels: Landing2SignupLabels;
    /** the SMS terms the consent line links to (LEGAL_LINKS, REQ-076) */
    smsTermsPath: string;
    /** the support line the ¿Prefieres hablar? row dials (REQ-044) */
    phoneHref: string;
    phoneLabel: string;
  },
) {
  const [step, setStep] = useState<Step>(1);
  const [phone, setPhone] = useState("");
  /** REQ-089 — the TCPA box: unticked until the person ticks it; the code waits for it */
  const [consent, setConsent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** REQ-082 — on the fakes the reply carries the code; the popup shows it on the code step */
  const [devCode, setDevCode] = useState<string | null>(null);
  // REQ-083 — the choreography
  const [flip, setFlip] = useState<Flip>(null);
  const [flipped, setFlipped] = useState(false);
  const [sms, setSms] = useState<{ x: number; y: number } | null>(null);
  const [bad, setBad] = useState(false);
  /** the takeoff's burst sits over the card's centre, outside it: the card fades, the burst does not */
  const [takeoff, setTakeoff] = useState<{ x: number; y: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const sendRef = useRef<HTMLButtonElement>(null);
  const timers = useRef<number[]>([]);
  const later = (fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => {
    if (step === 2) codeRef.current?.focus();
  }, [step]);

  const shown = formatPhoneInput(phone);
  const phoneDone = phone.replace(/\D/g, "").length >= 10;

  async function sendCode(e: Event) {
    e.preventDefault();
    setErr(null);
    const e164 = toE164(phone);
    if (e164.replace(/\D/g, "").length < 10) {
      setErr(labels.errPhone);
      return;
    }
    if (!consent) {
      setErr(labels.errConsent);
      return;
    }
    const from = sendRef.current?.getBoundingClientRect();
    setBusy(true);
    try {
      const sent = await landingClient.sendOtp({
        phoneNumber: e164,
        language: lang,
      });
      setDevCode(sent.devCode ?? null);
      try {
        localStorage.setItem("pm:last-phone", e164);
      } catch { /* private mode */ }
      // REQ-080 — the Lead: the code went out from a landing page
      firePixelEvent(
        leadEvent(e164),
        globalThis as unknown as Parameters<typeof firePixelEvent>[1],
      );
      setCode("");
      monster("bounce");
      if (still()) {
        setStep(2);
        return;
      }
      // the text launches from the button, then the card flips: out, swap, in
      if (from) {
        setSms({
          x: from.left + from.width / 2,
          y: from.top + from.height / 2,
        });
      }
      later(() => setFlip("out"), 200);
      later(() => {
        setStep(2);
        setFlip("in");
      }, 460);
      later(() => {
        setFlip(null);
        setFlipped(true);
      }, 730);
      later(() => setSms(null), 1100);
    } catch (error) {
      setErr(
        error instanceof ApiError && error.status === 429
          ? labels.errCooldown
          : labels.errSend,
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(digits: string) {
    if (busy) return;
    setErr(null);
    if (digits.length !== CODE_LEN) {
      setErr(labels.errCode);
      return;
    }
    setBusy(true);
    let leaving = false;
    try {
      const result = await verifyClient.verifyOtp({
        phoneNumber: toE164(phone),
        code: digits,
      });
      if (result.ok && "recoverable" in result) {
        // REQ-039 — a closed account's number: the recover-or-start-fresh choice lives on /verify
        leaving = true;
        globalThis.location.href = `/verify?phone=${
          encodeURIComponent(toE164(phone))
        }&lang=${lang}`;
        return;
      }
      if (result.ok) {
        // straight into the app, where the server sends the account — the takeoff on the way
        leaving = true;
        monster("bounce");
        if (still()) {
          globalThis.location.href = result.redirectTo;
          return;
        }
        const r = cardRef.current?.getBoundingClientRect();
        setTakeoff(
          r
            ? { x: r.left + r.width / 2, y: r.top + r.height / 2 }
            : { x: globalThis.innerWidth / 2, y: globalThis.innerHeight / 2 },
        );
        later(() => {
          globalThis.location.href = result.redirectTo;
        }, 800);
        return;
      }
      setErr(
        result.error === "expired"
          ? labels.errExpired
          : result.error === "rate_limited"
          ? labels.errRate
          : labels.errCode,
      );
      setCode("");
      setBad(true);
      later(() => setBad(false), 600);
      codeRef.current?.focus();
    } catch {
      setErr(labels.errCode);
      setCode("");
    } finally {
      if (!leaving) setBusy(false);
    }
  }

  function onCodeInput(e: Event) {
    const next = (e.target as HTMLInputElement).value.replace(/\D/g, "").slice(
      0,
      CODE_LEN,
    );
    setCode(next);
    // the sixth digit submits — no button to press (REQ-084: no autofill on either field)
    if (next.length === CODE_LEN) void submitCode(next);
  }

  /** REQ-082/083 — the dev popup's code types itself into the slots, then submits */
  function useDevCode(c: string) {
    setDevCode(null);
    setErr(null);
    if (still()) {
      setCode(c);
      void submitCode(c);
      return;
    }
    for (let i = 1; i <= c.length; i++) {
      later(() => setCode(c.slice(0, i)), i * TYPE_MS);
    }
    later(() => void submitCode(c), c.length * TYPE_MS + 80);
  }

  function backToPhone() {
    setErr(null);
    setCode("");
    setDevCode(null);
    setStep(1);
  }

  const cardClass = [
    "l2-card",
    "l2-signup",
    flip === "out" ? "l2-signup--flip-out" : "",
    flip === "in" ? "l2-signup--flip-in" : "",
    takeoff ? "l2-signup--takeoff" : "",
    busy && step === 1 ? "l2-signup--sending" : "",
  ].filter(Boolean).join(" ");

  return (
    <>
      <div
        id="empezar"
        ref={cardRef}
        class={cardClass}
        data-cy="l2-signup"
        data-motion={flipped ? "flipped" : undefined}
      >
        {step === 2
          ? (
            <form
              class="l2-stack"
              onSubmit={(e) => {
                e.preventDefault();
                void submitCode(code);
              }}
              data-cy="l2-signup-step"
              data-step="2"
            >
              <h2 class="l2-signup__h">{labels.codeSentTo}</h2>
              <div>
                <label class="l2-lbl" for="reg-code">{labels.codeLbl}</label>
                <div
                  class={`l2-code ${
                    code.length === CODE_LEN ? "l2-code--full" : ""
                  } ${bad ? "l2-code--bad" : ""}`}
                  data-cy="l2-code"
                >
                  {Array.from({ length: CODE_LEN }, (_, i) => (
                    <span
                      key={i}
                      class={`l2-code__slot ${
                        code[i] ? "l2-code__slot--on" : ""
                      } ${i === code.length ? "l2-code__slot--cur" : ""}`}
                      data-cy="l2-code-slot"
                    >
                      {code[i]
                        ? (
                          <b key={`${i}${code[i]}`} class="l2-code__d">
                            {code[i]}
                          </b>
                        )
                        : null}
                    </span>
                  ))}
                  <input
                    id="reg-code"
                    ref={codeRef}
                    class="l2-code__input"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    data-lpignore="true"
                    data-1p-ignore
                    data-form-type="other"
                    maxLength={CODE_LEN}
                    value={code}
                    onInput={onCodeInput}
                    aria-label={labels.codeLbl}
                  />
                </div>
              </div>
              {err ? <p class="l2-error" role="alert">{err}</p> : null}
              <button
                type="submit"
                class="l2-btn l2-btn--primary l2-btn--full"
                data-cy="l2-confirm-code"
                disabled={busy}
              >
                {busy ? labels.confirming : labels.confirm}
              </button>
              <button
                type="button"
                class="l2-link-btn"
                data-cy="l2-back-to-phone"
                onClick={backToPhone}
              >
                {labels.resend}
              </button>
            </form>
          )
          : (
            <form
              class="l2-stack"
              onSubmit={sendCode}
              data-cy="l2-signup-step"
              data-step="1"
            >
              <h2 class="l2-signup__h">{labels.regH}</h2>
              <div class="l2-signup__row">
                <label for="reg-phone" class="l2-sr">{labels.phoneLbl}</label>
                <div class={`l2-phone ${phoneDone ? "l2-phone--done" : ""}`}>
                  <input
                    id="reg-phone"
                    class="l2-field l2-phone__input"
                    type="tel"
                    inputMode="tel"
                    autoComplete="off"
                    data-lpignore="true"
                    data-1p-ignore
                    data-form-type="other"
                    placeholder="(555) 123-4567"
                    value={shown}
                    onInput={(e) =>
                      setPhone((e.target as HTMLInputElement).value)}
                    onFocus={() => monster("lean")}
                    onBlur={() => monster("rest")}
                  />
                  <div class="l2-phone__show" aria-hidden="true">
                    {shown.split("").map((ch, i) =>
                      /\d/.test(ch)
                        ? <b key={`d${i}${ch}`} class="l2-phone__d">{ch}</b>
                        : <span key={`s${i}`}>{ch}</span>
                    )}
                  </div>
                  <svg
                    class="l2-phone__ok"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path d="M4 12l5 5L20 6" />
                  </svg>
                </div>
                <button
                  ref={sendRef}
                  type="submit"
                  class={`l2-btn l2-btn--primary ${
                    phoneDone && !busy ? "l2-btn--charged" : ""
                  }`}
                  data-cy="l2-send-code"
                  disabled={busy}
                >
                  {busy ? labels.sending : labels.sendCode}
                </button>
              </div>
              {err ? <p class="l2-error" role="alert">{err}</p> : null}
              <label class="l2-consent" for="reg-consent">
                <input
                  id="reg-consent"
                  type="checkbox"
                  checked={consent}
                  onChange={(e) =>
                    setConsent((e.target as HTMLInputElement).checked)}
                />
                <span>
                  {labels.consentA}
                  <a href={smsTermsPath}>{labels.consentTerms}</a>
                </span>
              </label>
              <div class="l2-signup__talk">
                <span>{labels.preferTalk}</span>
                <a class="l2-btn l2-btn--ghost l2-btn--phone" href={phoneHref}>
                  <PhoneIcon />
                  {phoneLabel}
                </a>
              </div>
            </form>
          )}
      </div>
      {/* outside the card: a fixed element inside a transformed card would move with it */}
      {sms
        ? (
          <span
            class="l2-sms"
            data-cy="l2-sms"
            aria-hidden="true"
            style={`left:${sms.x}px;top:${sms.y}px`}
          />
        )
        : null}
      {step === 2 && devCode
        ? (
          <DevCodeCard
            lang={lang}
            code={devCode}
            onUse={() => useDevCode(devCode)}
            onClose={() => setDevCode(null)}
          />
        )
        : null}
      {takeoff
        ? (
          <>
            <div class="l2-fade" data-cy="l2-takeoff" />
            <div
              class="l2-launch"
              aria-hidden="true"
              style={`left:${takeoff.x}px;top:${takeoff.y}px`}
            >
              <svg class="l2-launch__check" viewBox="0 0 24 24">
                <path d="M4 12l5 5L20 6" />
              </svg>
              <div class="l2-confetti">
                {CONFETTI.map((p, i) => (
                  <i
                    key={i}
                    style={`--dx:${p.dx}px;--dy:${p.dy}px;--rot:${p.rot}deg;--c:${p.c};--d:${p.delay}ms;width:${p.w}px;height:${p.h}px`}
                  />
                ))}
              </div>
            </div>
          </>
        )
        : null}
    </>
  );
}
