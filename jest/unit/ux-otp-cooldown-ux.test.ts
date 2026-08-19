/**
 * UX-33 [OTP] — "The send-cooldown surfaces as a generic failure that invites
 * retrying. Second submit within 30s shows 'No pudimos enviar el código.
 * Intenta otra vez.' — the retry keeps failing for 30s while a valid code sits
 * in the user's SMS. On 429 the form should route to /verify ('Ya te enviamos
 * un código — revísalo') or show the countdown from the response's
 * retryAfterSeconds."
 *
 * The API half is ALREADY DONE (P-03 green phase): the live stack answers a
 * cooldown-hit POST /api/auth/send-otp with
 *   429 {"ok":false,"error":"cooldown","retryAfterSeconds":26}
 * (curl-verified 2026-08-19; the value live-counts down). P-03's suite
 * (otp-rate-limit.test.ts / .int.test.ts) already pins the cooldown mechanics
 * — nothing here duplicates that. What is MISSING is the FE mapping: every
 * landing send path collapses any non-ok response into one generic failure.
 *
 * Target: shared/quote-flow/otp-cooldown-ux.ts (does NOT exist yet — the
 * "Cannot find module" failure is the intended TDD red).
 *
 * Expected exports:
 *
 *   export type SendOtpOutcome =
 *     | { kind: "sent" }
 *     | { kind: "cooldown"; retryAfterSeconds: number }
 *     | { kind: "failed" };
 *
 *   // Classify the browser-facing result of POST /api/auth/send-otp.
 *   //  - 2xx                        → { kind: "sent" }
 *   //  - 429 (any body)             → { kind: "cooldown", retryAfterSeconds }
 *   //      retryAfterSeconds = body.retryAfterSeconds when it is a positive
 *   //      finite number; otherwise fall back to SEND_OTP_COOLDOWN_SECONDS
 *   //      (shared/quote-flow/otp-rate-limit.ts) so the UI can ALWAYS render
 *   //      a countdown — a cooldown outcome never carries 0.
 *   //  - anything else (400 invalid_phone, 5xx, 502 backend_unreachable)
 *   //                               → { kind: "failed" } (the generic error
 *   //                                  copy is correct THERE, and only there)
 *   export function classifySendOtpResponse(
 *     status: number,
 *     body: unknown,
 *   ): SendOtpOutcome;
 *
 *   // The user-facing cooldown line for the landing form. Must reassure that
 *   // a code was ALREADY sent (es: "Ya te enviamos un código…") and carry the
 *   // live seconds — and must never read as the generic send-failure.
 *   export function cooldownMessage(
 *     lang: "en" | "es",
 *     secondsLeft: number,
 *   ): string;
 *
 * Wiring sites for the green agent (all read + verified):
 *   - front-end/static/landing-scripts.js:827-853 — the "/" contact form does
 *     `if (!res.ok) throw` (line 833) and its catch paints the one generic
 *     copy(cta.errSend) ("No pudimos enviar el código. Intenta otra vez.",
 *     lines 842-852). It must classify via classifySendOtpResponse and, on
 *     kind:"cooldown", either route to /verify (the page already says a code
 *     was sent) or paint cooldownMessage(lang, retryAfterSeconds) as a live
 *     countdown; showError(generic) stays for kind:"failed" only.
 *   - front-end/islands/TrialSignup.tsx:41-56 — the /landing trial form's
 *     catch(_error) → t("promoLanding.formError") has the same collapse
 *     (front-end/clients/landing.ts:34-36 api.post throws on any non-ok).
 *   - front-end/lib/landing-dict.ts:307 — "cta.errSend" needs a cooldown
 *     sibling key whose copy agrees with cooldownMessage.
 *   - The countdown source is already live end-to-end: backend
 *     backend/src/users/entrypoints/auth-controller/mod.ts:52-60 returns the
 *     429 body (and a retry-after header — see ux-otp-cooldown.int.test.ts
 *     for the proxy stripping that header).
 *
 * Phones: none (pure logic — no phone numbers used).
 */
import {
  classifySendOtpResponse,
  cooldownMessage,
  type SendOtpOutcome,
} from "../../shared/quote-flow/otp-cooldown-ux";
import { SEND_OTP_COOLDOWN_SECONDS } from "../../shared/quote-flow/otp-rate-limit";

/** The literal generic-failure copy the cooldown path must never produce
 *  (front-end/lib/landing-dict.ts:307 / landing-scripts.js:850). */
const GENERIC_ES = /no pudimos enviar/i;
const GENERIC_EN = /couldn.t send/i;

describe("UX-33: classifySendOtpResponse — cooldown is machine-readable, not a generic failure", () => {
  it("UX-33: a 200 {sent:true} classifies as sent", () => {
    const r = classifySendOtpResponse(200, { sent: true });
    expect(r).toEqual({ kind: "sent" });
  });

  it("UX-33: the live 429 cooldown body classifies as cooldown with its retryAfterSeconds", () => {
    // Exact body observed on the dev stack (curl 2026-08-19):
    //   HTTP/1.1 429
    //   {"ok":false,"error":"cooldown","retryAfterSeconds":26}
    const r = classifySendOtpResponse(429, {
      ok: false,
      error: "cooldown",
      retryAfterSeconds: 26,
    });
    expect(r).toEqual({ kind: "cooldown", retryAfterSeconds: 26 });
  });

  it("UX-33: a 429 with no usable retryAfterSeconds still yields a renderable countdown (falls back to the shared cooldown constant)", () => {
    const noSeconds = classifySendOtpResponse(429, {
      ok: false,
      error: "cooldown",
    });
    expect(noSeconds).toEqual({
      kind: "cooldown",
      retryAfterSeconds: SEND_OTP_COOLDOWN_SECONDS,
    });

    // A cooldown outcome may never carry 0 — the UI would render "wait 0s".
    const zero = classifySendOtpResponse(429, {
      ok: false,
      error: "cooldown",
      retryAfterSeconds: 0,
    });
    expect(zero).toEqual({
      kind: "cooldown",
      retryAfterSeconds: SEND_OTP_COOLDOWN_SECONDS,
    });

    // Unparseable/absent body (e.g. text/plain proxy error page).
    const nullBody = classifySendOtpResponse(429, null);
    expect(nullBody).toEqual({
      kind: "cooldown",
      retryAfterSeconds: SEND_OTP_COOLDOWN_SECONDS,
    });
  });

  it("UX-33: non-cooldown failures classify as failed — the generic copy is correct there", () => {
    const invalid = classifySendOtpResponse(400, {
      ok: false,
      error: "invalid_phone",
    });
    expect(invalid.kind).toBe("failed");

    const boom = classifySendOtpResponse(500, null);
    expect(boom.kind).toBe("failed");

    // The FE proxy's own failure shape
    // (front-end/routes/api/auth/send-otp.ts:26-33).
    const unreachable = classifySendOtpResponse(502, {
      ok: false,
      error: "backend_unreachable",
    });
    expect(unreachable.kind).toBe("failed");
  });

  it("UX-33: every cooldown outcome carries a positive integer second count", () => {
    const cases: SendOtpOutcome[] = [
      classifySendOtpResponse(429, { ok: false, error: "cooldown", retryAfterSeconds: 1 }),
      classifySendOtpResponse(429, { ok: false, error: "cooldown", retryAfterSeconds: 30 }),
      classifySendOtpResponse(429, {}),
    ];
    for (const c of cases) {
      expect(c.kind).toBe("cooldown");
      if (c.kind === "cooldown") {
        expect(Number.isInteger(c.retryAfterSeconds)).toBe(true);
        expect(c.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe("UX-33: cooldownMessage — reassures 'already sent', shows the countdown, never the generic failure", () => {
  it("UX-33: the Spanish message says the code was already sent and carries the seconds", () => {
    const msg = cooldownMessage("es", 26);
    // The finding's proposed copy: "Ya te enviamos un código — revísalo".
    expect(msg).toMatch(/ya te enviamos/i);
    expect(msg).toContain("26");
    expect(msg).not.toMatch(GENERIC_ES);
    expect(msg).not.toMatch(/intenta otra vez/i);
  });

  it("UX-33: the English message says the code was already sent and carries the seconds", () => {
    const msg = cooldownMessage("en", 12);
    expect(msg).toMatch(/already sent/i);
    expect(msg).toContain("12");
    expect(msg).not.toMatch(GENERIC_EN);
  });

  it("UX-33: the countdown interpolates live values (different seconds → different message)", () => {
    expect(cooldownMessage("es", 30)).not.toBe(cooldownMessage("es", 5));
    expect(cooldownMessage("es", 5)).toContain("5");
  });
});
