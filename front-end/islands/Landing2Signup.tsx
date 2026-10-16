import { useState } from "preact/hooks";
import { formatPhoneInput } from "../../shared/quote-flow/format-helpers.ts";
import { firePixelEvent, leadEvent } from "../../shared/meta-pixel/pixel.ts";
import { landingClient } from "../clients/landing.ts";
import { verifyClient } from "../clients/verify.ts";
import { ApiError } from "../lib/api.ts";
import type { Lang } from "../lib/lang.ts";
import DevCodeCard from "../components/DevCodeCard.tsx";

/**
 * REQ-081 — the signup card in /landing2's hero: phone → code → done, all on the page, the way
 * the mock drew it. The same OTP endpoints as every other sign-in (POST /auth/send-otp, then
 * /auth/verify-otp), so the account, the CRM lead (REQ-060/072) and the session are the real
 * ones; the Lead pixel fires here when the code goes out (REQ-080: the code step is on this page,
 * not on /verify, so the page fires it itself — once per browser, by the same id). A number that
 * belongs to a closed account goes to /verify, where the recover-or-start-fresh choice lives.
 *
 * Every string comes in as `labels` from the route, so the island renders exactly what the server
 * did (no flash, no second dictionary on the client).
 */
export interface Landing2SignupLabels {
  regH: string;
  regSubA: string;
  regSubB: string;
  regSubC: string;
  phoneLbl: string;
  sendCode: string;
  sending: string;
  tr1: string;
  tr2: string;
  tr3: string;
  codeSentTo: string;
  codeLbl: string;
  confirm: string;
  confirming: string;
  resend: string;
  regDoneH: string;
  regDoneSub: string;
  openApp: string;
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

type Step = 1 | 2 | 3;

export default function Landing2Signup(
  { lang, labels }: { lang: Lang; labels: Landing2SignupLabels },
) {
  const [step, setStep] = useState<Step>(1);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [redirectTo, setRedirectTo] = useState("/welcome");
  /** REQ-082 — on the fakes the reply carries the code; the popup shows it on the code step */
  const [devCode, setDevCode] = useState<string | null>(null);

  async function sendCode(e: Event) {
    e.preventDefault();
    setErr(null);
    const e164 = toE164(phone);
    if (e164.replace(/\D/g, "").length < 10) {
      setErr(labels.errPhone);
      return;
    }
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
      setStep(2);
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

  async function confirmCode(e: Event) {
    e.preventDefault();
    setErr(null);
    const digits = code.replace(/\D/g, "");
    if (digits.length !== 6) {
      setErr(labels.errCode);
      return;
    }
    setBusy(true);
    try {
      const result = await verifyClient.verifyOtp({
        phoneNumber: toE164(phone),
        code: digits,
      });
      if (result.ok && "recoverable" in result) {
        // REQ-039 — a closed account's number: the recover-or-start-fresh choice lives on /verify
        globalThis.location.href = `/verify?phone=${
          encodeURIComponent(toE164(phone))
        }&lang=${lang}`;
        return;
      }
      if (result.ok) {
        setRedirectTo(result.redirectTo);
        setStep(3);
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
    } catch {
      setErr(labels.errCode);
    } finally {
      setBusy(false);
    }
  }

  function backToPhone() {
    setErr(null);
    setCode("");
    setDevCode(null);
    setStep(1);
  }

  if (step === 3) {
    return (
      <div class="l2-done" data-cy="l2-signup-step" data-step="3">
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
        <div class="l2-h" style="font-size: 26px">{labels.regDoneH}</div>
        <p style="font-size: 15px">{labels.regDoneSub}</p>
        <a
          class="l2-btn l2-btn--dark"
          href={redirectTo}
          data-cy="l2-open-app"
          style="margin-top: 4px"
        >
          {labels.openApp}
        </a>
      </div>
    );
  }

  if (step === 2) {
    return (
      <form
        class="l2-stack"
        onSubmit={confirmCode}
        data-cy="l2-signup-step"
        data-step="2"
      >
        <div class="l2-signup__h">{labels.codeSentTo}</div>
        {devCode
          ? (
            <DevCodeCard
              lang={lang}
              code={devCode}
              onUse={() => {
                setCode(devCode);
                setDevCode(null);
              }}
              onClose={() => setDevCode(null)}
            />
          )
          : null}
        <div>
          <label class="l2-lbl" for="reg-code">{labels.codeLbl}</label>
          <input
            id="reg-code"
            class="l2-field l2-field--code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="• • • • • •"
            maxLength={6}
            value={code}
            onInput={(e) =>
              setCode(
                (e.target as HTMLInputElement).value.replace(/\D/g, "").slice(
                  0,
                  6,
                ),
              )}
          />
        </div>
        {err ? <p class="l2-error" role="alert">{err}</p> : null}
        <button
          type="submit"
          class="l2-btn l2-btn--green l2-btn--full"
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
    );
  }

  return (
    <form
      class="l2-stack"
      onSubmit={sendCode}
      data-cy="l2-signup-step"
      data-step="1"
    >
      <div class="l2-signup__h">{labels.regH}</div>
      <p class="l2-signup__sub">
        {labels.regSubA}
        <strong>{labels.regSubB}</strong>
        {labels.regSubC}
      </p>
      <div class="l2-signup__row">
        <label for="reg-phone" class="l2-sr">{labels.phoneLbl}</label>
        <input
          id="reg-phone"
          class="l2-field"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="(555) 123-4567"
          value={formatPhoneInput(phone)}
          onInput={(e) => setPhone((e.target as HTMLInputElement).value)}
          required
        />
        <button
          type="submit"
          class="l2-btn l2-btn--primary"
          data-cy="l2-send-code"
          disabled={busy}
        >
          {busy ? labels.sending : labels.sendCode}
        </button>
      </div>
      {err ? <p class="l2-error" role="alert">{err}</p> : null}
      <div class="l2-trust">
        <span>✓ {labels.tr1}</span>
        <span>✓ {labels.tr2}</span>
        <span>✓ {labels.tr3}</span>
      </div>
    </form>
  );
}
