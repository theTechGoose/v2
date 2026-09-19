/**
 * P-09 [OUTBOUND] "Sends report success when delivery failed."
 *
 * The invoice send endpoints report logical failure as HTTP 200 + {ok:false}
 * (live-proven: POST /invoices/:id/email for a customer with no email →
 * 200 {"ok":false,"reason":"no recipient: pass `to` or attach a customer
 * with an email","to":"","subject":"Invoice #… from …"}). The dishonest
 * call sites check only Response.ok (or nothing):
 *   - front-end/islands/InvoicesPage.tsx:1422 (dispatchInvoice — "Send now" /
 *     "Finish + send" / "Create & send" fire-and-reload)
 *   - front-end/islands/InvoicesPage.tsx:1551 (doSendText — `if (r.ok) reload()`)
 *   - front-end/islands/AsstChat.tsx:3043-3049 (swap-invoice — ignores the
 *     result entirely and marks the invoice sent)
 * The honest counter-examples are PublicQuoteActions.tsx:179-192 (treats
 * 200+{ok:false} as an error) and the assistant quote-send divider
 * (backend send-quote coordinator → lang keys sendQuote.divider.emailFailed
 * / sendQuote.divider.noEmail).
 *
 * Target (NEW module — this file is intentionally RED via "Cannot find
 * module" until it exists): shared/quote-flow/send-result.ts
 *
 * Expected exports:
 *   export type SendReason = "noEmail" | "noPhone" | "bounced" | "http" | "unknown";
 *   export interface SendOutcome { delivered: boolean; reason?: SendReason }
 *   export function interpretSendResult(
 *     input: { httpOk: boolean; body: unknown },
 *   ): SendOutcome;
 *   export function sendResultLangKey(outcome: SendOutcome): string | null;
 *     // null when delivered; "sendQuote.divider.noEmail" for reason
 *     // "noEmail"; "sendQuote.divider.emailFailed" for any other failure
 *     // (the same lang keys the honest assistant quote-send path uses).
 *
 * Wire it at InvoicesPage.tsx:1422/1551 and AsstChat.tsx:3043 so every send
 * surface interprets the BODY, not just the HTTP status.
 */
import {
  interpretSendResult,
  sendResultLangKey,
} from "../../shared/quote-flow/send-result";

/** Live-captured bodies from the running dev stack (2026-08-18). */
const NO_EMAIL_BODY = {
  ok: false,
  reason: "no recipient: pass `to` or attach a customer with an email",
  to: "",
  subject: "Invoice #1d087736 — due September 30, 2026 from Probe Contractor",
};
const NO_PHONE_BODY = {
  ok: false,
  reason: "no recipient: pass `to` or attach a customer with a phone number",
  to: "",
};
const SUCCESS_BODY = {
  ok: true,
  messageId: "db8eb67c-76ab-4bf2-b0c2-dcdd0c4d9e13",
  to: "mary.probe@blackhole.postmarkapp.com",
  subject: "Invoice #31354db4 — due September 30, 2026 from Probe Contractor",
};

describe("P-09 interpretSendResult — {ok:false} in a 200 body is a FAILURE", () => {
  it("P-09 classifies 200 + {ok:false, no-email reason} as NOT delivered, reason noEmail", () => {
    const out = interpretSendResult({ httpOk: true, body: NO_EMAIL_BODY });
    expect(out.delivered).toBe(false);
    expect(out.reason).toBe("noEmail");
  });

  it("P-09 classifies 200 + {ok:false, no-phone reason} as NOT delivered, reason noPhone", () => {
    const out = interpretSendResult({ httpOk: true, body: NO_PHONE_BODY });
    expect(out.delivered).toBe(false);
    expect(out.reason).toBe("noPhone");
  });

  it("P-09 refuses to claim delivery for ANY {ok:false} body, even an unrecognized reason", () => {
    const out = interpretSendResult({
      httpOk: true,
      body: { ok: false, reason: "postmark: hard bounce for recipient" },
    });
    expect(out.delivered).toBe(false);
    expect(out.reason).toBeTruthy();
    expect(out.reason).not.toBe("noEmail"); // a bounce is not "no email on file"
  });

  it("P-09 classifies {ok:true} as delivered with no failure reason", () => {
    const out = interpretSendResult({ httpOk: true, body: SUCCESS_BODY });
    expect(out.delivered).toBe(true);
    expect(out.reason).toBeUndefined();
  });

  it("P-09 classifies an HTTP-level failure (Response.ok false) as NOT delivered, reason http", () => {
    const out = interpretSendResult({ httpOk: false, body: null });
    expect(out.delivered).toBe(false);
    expect(out.reason).toBe("http");
  });

  it("P-09 keeps legacy success semantics when a 200 body carries no explicit ok flag (PublicQuoteActions.tsx:179-192 parity)", () => {
    const out = interpretSendResult({ httpOk: true, body: {} });
    expect(out.delivered).toBe(true);
  });
});

describe("P-09 sendResultLangKey — maps failures to the honest divider lang keys", () => {
  it("P-09 maps reason noEmail to the assistant's honest no-email divider key", () => {
    expect(sendResultLangKey({ delivered: false, reason: "noEmail" })).toBe(
      "sendQuote.divider.noEmail",
    );
  });

  it("P-09 maps every other failure to the honest email-failed divider key", () => {
    expect(sendResultLangKey({ delivered: false, reason: "http" })).toBe(
      "sendQuote.divider.emailFailed",
    );
    expect(sendResultLangKey({ delivered: false, reason: "bounced" })).toBe(
      "sendQuote.divider.emailFailed",
    );
    expect(sendResultLangKey({ delivered: false, reason: "unknown" })).toBe(
      "sendQuote.divider.emailFailed",
    );
  });

  it("P-09 maps a delivered outcome to null (no failure copy)", () => {
    expect(sendResultLangKey({ delivered: true })).toBeNull();
  });

  it("P-09 the mapped keys actually exist in BOTH lang dicts (en + es)", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const en = require("../../lang/en.json") as Record<string, string>;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const es = require("../../lang/es.json") as Record<string, string>;
    for (const dict of [en, es]) {
      expect(typeof dict["sendQuote.divider.noEmail"]).toBe("string");
      expect(typeof dict["sendQuote.divider.emailFailed"]).toBe("string");
    }
    // Grounding: the EN copy is the "no email on file" wording the e2e asserts.
    expect(en["sendQuote.divider.noEmail"]).toContain("no email on file");
  });
});

// REQ-030 — NW-25 (p16): "the email went out but the text failed with
// Twilio 400, error 21211". The invoice page collapsed two channels into one
// boolean and reported only the email reason, so a half-delivered send
// reloaded as success. summarizeDispatch is the pure per-channel verdict.
describe("REQ-030 NW-25 summarizeDispatch — per-channel honesty", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require("../../shared/quote-flow/send-result");

  it("REQ-030 email delivered + text failed → delivered, partial, failedChannels ['text']", () => {
    expect(
      mod.summarizeDispatch({
        email: { delivered: true },
        text: { delivered: false, reason: "sms.invalidNumber" },
      }),
    ).toEqual({ delivered: true, partial: true, failedChannels: ["text"] });
  });

  it("REQ-030 both delivered → not partial, nothing failed", () => {
    expect(
      mod.summarizeDispatch({
        email: { delivered: true },
        text: { delivered: true },
      }),
    ).toEqual({ delivered: true, partial: false, failedChannels: [] });
  });

  it("REQ-030 nothing delivered → not delivered, not partial, both channels failed", () => {
    expect(
      mod.summarizeDispatch({
        email: { delivered: false, reason: "noEmail" },
        text: { delivered: false, reason: "noPhone" },
      }),
    ).toEqual({ delivered: false, partial: false, failedChannels: ["email", "text"] });
  });
});
