/**
 * REQ-403 (demo-loop cycle 2, issue m11): the one guarded dispatch every
 * customer text goes through, and the channel the signed page may promise a
 * confirmation on.
 */
import { assertEquals } from "#std/assert";
import {
  customerSmsTarget,
  dispatchCustomerSms,
  normalizeE164,
  signedConfirmChannel,
} from "./mod.ts";
import { customerPhoneE164 } from "#quote-flow/customer-contact.ts"; // REQ-1080
import { type SendSmsInput, SmsService } from "@users/domain/data/sms/mod.ts";

function spySms() {
  const sms = new SmsService();
  const sent: SendSmsInput[] = [];
  sms.send = (input: SendSmsInput) => {
    sent.push(input);
    return Promise.resolve({ ok: true, reason: "dev_mode_no_dispatch" });
  };
  return { sms, sent };
}

Deno.test("REQ-403 customerSmsTarget: missing / invalid / fictional are refused with a code; a real number normalizes", () => {
  assertEquals(customerSmsTarget(undefined), {
    ok: false,
    failureCode: "missing",
  });
  assertEquals(customerSmsTarget("  "), { ok: false, failureCode: "missing" });
  assertEquals(customerSmsTarget("12345"), {
    ok: false,
    failureCode: "invalid",
  });
  assertEquals(customerSmsTarget("+1 512 555 0177"), {
    ok: false,
    failureCode: "fictional",
    e164: "+15125550177",
  });
  assertEquals(customerSmsTarget("(555) 123-4567"), {
    ok: false,
    failureCode: "fictional",
    e164: "+15551234567",
  });
  assertEquals(customerSmsTarget("512-555-1234"), {
    ok: true,
    e164: "+15125551234",
  });
});

Deno.test("REQ-403 dispatchCustomerSms: a fictional number never reaches the provider, even in dev mode", async () => {
  const { sms, sent } = spySms();
  const res = await dispatchCustomerSms(sms, {
    to: "+15125550177",
    body: "hi",
    uiLang: "en",
  });
  assertEquals(res.ok, false);
  assertEquals(res.failureCode, "fictional");
  assertEquals(res.to, "+15125550177");
  assertEquals(sent.length, 0);
});

Deno.test("REQ-403 dispatchCustomerSms: an invalid number is refused, a real one is sent", async () => {
  const { sms, sent } = spySms();
  const bad = await dispatchCustomerSms(sms, {
    to: "12",
    body: "hi",
    uiLang: "en",
  });
  assertEquals(bad.ok, false);
  assertEquals(bad.failureCode, "invalid");
  const good = await dispatchCustomerSms(sms, {
    to: "5125551234",
    body: "hi",
    uiLang: "en",
  });
  assertEquals(good.ok, true);
  assertEquals(good.to, "+15125551234");
  assertEquals(sent.map((s) => s.to), ["+15125551234"]);
});

Deno.test("REQ-403 signedConfirmChannel: email wins; a text is promised only to a textable number whose latest text did not fail", () => {
  assertEquals(
    signedConfirmChannel({ email: "a@b.co", phoneNumber: "+15125550177" }),
    "email",
  );
  assertEquals(signedConfirmChannel({ phoneNumber: "+15125551234" }), "text");
  assertEquals(signedConfirmChannel({ phoneNumber: "+15125550177" }), "none");
  assertEquals(signedConfirmChannel({}), "none");
  assertEquals(signedConfirmChannel(undefined), "none");
  // the latest attempt's text failed → no promise
  assertEquals(
    signedConfirmChannel({ phoneNumber: "+15125551234" }, {
      at: "2026-11-12T00:00:00Z",
      channel: "sms",
      smsFailureReason: "That number can't receive texts",
    }),
    "none",
  );
  // the latest attempt texted it → the promise stands
  assertEquals(
    signedConfirmChannel({ phoneNumber: "+15125551234" }, {
      at: "2026-11-12T00:00:00Z",
      channel: "sms",
      textedTo: "+15125551234",
    }),
    "text",
  );
});

// REQ-1080 (LOOP-007 cycle 2, q2-69): REQ-278 promises "a number that is
// accepted [when the customer is saved] is a number the send path can text".
// The save rule (customerPhoneE164) and the send rule (normalizeE164) must
// agree on every input: same E.164, or both refuse.

const PARITY_INPUTS = [
  "+1 (843) 555-0124 ext 9",
  "+1 843 555 0124 x9",
  "(843) 555-0124 ext 9",
  "+1 843 555 01249",
  "(512) 555-1234",
  "512-555-1234",
  "5125551234",
  "1 512 555 1234",
  "+15125551234",
  "+525512345678",
  "+44 20 7946 0958",
  "123",
  "555-12",
  "+12",
];

for (const raw of PARITY_INPUTS) {
  Deno.test(`REQ-1080 q2-69 save rule and SMS send rule agree on ${JSON.stringify(raw)}`, () => {
    // the save rule's answer must equal the send rule's answer
    assertEquals(customerPhoneE164(raw) ?? undefined, normalizeE164(raw));
  });
}

Deno.test("REQ-1080 q2-69 a phone with an extension is not a textable number", () => {
  assertEquals(customerPhoneE164("+1 (843) 555-0124 ext 9"), null);
  assertEquals(customerSmsTarget("+1 (843) 555-0124 ext 9").ok, false);
});
