/**
 * REQ-226 — "fix every issue the demo found": the SMS failure a contractor
 * sees after sending to a phone that can't take texts.
 *
 * Demo issues (demo-rca.md): quote-invoice-money-m4 ("'Add their phone to
 * deliver' although a phone was given"), test-setup-claims-555-copy
 * (fictional-number copy ships with Twilio jargon and its '21211' token
 * triggers the add-phone card), customers-payments-fieldops-m1 (the Twilio
 * error code "21211" is shown to the contractor).
 *
 * Root cause: the assistant chose the recovery card with
 * `/Invalid|21211/i.test(smsFailureReason)` — a regex over TRANSLATED copy —
 * and the only headline it had was "Add their phone to deliver". The send
 * result now carries a structured `smsFailureCode`, and the pure decision
 * lives in shared/quote-flow/sms-failure.ts.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  smsFailureCodeForReasonKey,
  smsRecoveryAsk,
} from "../../shared/quote-flow/sms-failure.ts";

const en: Record<string, string> = require("../../lang/en.json");
const es: Record<string, string> = require("../../lang/es.json");

const OLD_FICTIONAL_EN =
  "that's a fictional 555 number — texts can't reach it (Twilio would reject it: 21211)";

describe("REQ-226 smsRecoveryAsk — which recovery the card asks for", () => {
  test("REQ-226 the demo case: a phone on file + a fictional-number failure asks to CHECK the number, never to add one", () => {
    expect(
      smsRecoveryAsk(
        { smsFailureReason: OLD_FICTIONAL_EN, smsFailureCode: "fictional" },
        "+15125550123",
      ),
    ).toBe("check");
  });

  test("REQ-226 an invalid or non-mobile number on file asks to check it", () => {
    for (const code of ["invalid", "notMobile"] as const) {
      expect(
        smsRecoveryAsk(
          { smsFailureReason: "x", smsFailureCode: code },
          "+15125551234",
        ),
      ).toBe("check");
    }
  });

  test("REQ-226 no phone on file asks to add one", () => {
    expect(
      smsRecoveryAsk(
        { smsFailureReason: "no recipient", smsFailureCode: "missing" },
        undefined,
      ),
    ).toBe("add");
    expect(smsRecoveryAsk({ smsFailureReason: "anything" }, "")).toBe("add");
  });

  test("REQ-226 the decision is the structured code, not words in the reason", () => {
    // A reason that happens to contain "Invalid" or "21211" with a code that
    // says the number is fine to retry elsewhere → no phone recovery.
    expect(
      smsRecoveryAsk(
        { smsFailureReason: "Invalid 21211", smsFailureCode: "optedOut" },
        "+15125551234",
      ),
    ).toBeNull();
    expect(
      smsRecoveryAsk(
        { smsFailureReason: "Invalid 21211", smsFailureCode: "other" },
        "+15125551234",
      ),
    ).toBeNull();
  });

  test("REQ-226 a delivered text or no SMS failure asks for nothing", () => {
    expect(
      smsRecoveryAsk(
        { textedTo: "+15125551234", smsFailureReason: "x" },
        undefined,
      ),
    ).toBeNull();
    expect(smsRecoveryAsk({}, undefined)).toBeNull();
  });

  test("REQ-226 a divider stored before the code existed, with a phone on file, never says 'add their phone' (its text is not parsed)", () => {
    expect(
      smsRecoveryAsk({ smsFailureReason: OLD_FICTIONAL_EN }, "+15125550123"),
    ).toBeNull();
  });
});

describe("REQ-226 smsFailureCodeForReasonKey — the SMS adapter's lang keys", () => {
  test("REQ-226 each recognised provider rejection maps to a code", () => {
    expect(smsFailureCodeForReasonKey("sms.invalidNumber")).toBe("invalid");
    expect(smsFailureCodeForReasonKey("sms.notMobile")).toBe("notMobile");
    expect(smsFailureCodeForReasonKey("sms.optedOut")).toBe("optedOut");
    expect(smsFailureCodeForReasonKey("twilio 500")).toBe("other");
    expect(smsFailureCodeForReasonKey(undefined)).toBe("other");
  });
});

describe("REQ-226 the copy the contractor reads", () => {
  const KEYS = [
    "sms.fictionalNumber",
    "sms.invalidNumber",
    "sms.notMobile",
    "sms.optedOut",
  ];
  test.each([["en", en], ["es", es]])(
    "REQ-226 %s: no provider name or error code in the SMS failure reasons",
    (_lang, dict) => {
      for (const k of KEYS) {
        expect(dict[k]).toBeTruthy();
        expect(dict[k]).not.toMatch(/twilio/i);
        expect(dict[k]).not.toMatch(/\b2\d{4}\b/);
      }
    },
  );

  // REQ-525 (cycle 3, p8-pair2-a): the headline is the action — fix the
  // number — never a restatement of the reason the send card shows.
  test("REQ-226 both languages carry a 'fix the number' headline", () => {
    expect(en["asstChat.recovery.checkPhone"]).toMatch(/fix the number/i);
    expect(es["asstChat.recovery.checkPhone"]).toMatch(/corrige el número/i);
    expect(en["asstChat.recovery.addEmailCheckPhone"]).toBeTruthy();
    expect(es["asstChat.recovery.addEmailCheckPhone"]).toBeTruthy();
  });
});

describe("REQ-226 the assistant uses the structured decision", () => {
  const src = readFileSync(
    resolve(__dirname, "../../front-end/islands/AsstChat.tsx"),
    "utf8",
  );
  test("REQ-226 AsstChat no longer regex-matches the reason text", () => {
    expect(src).not.toMatch(/Invalid\|21211/);
    expect(src).toMatch(/smsRecoveryAsk\(/);
    expect(src).toMatch(/asstChat\.recovery\.checkPhone/);
  });
});
