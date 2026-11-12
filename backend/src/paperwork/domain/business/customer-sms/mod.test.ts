/**
 * REQ-403 (demo-loop cycle 2, issue m11): the one guarded dispatch every
 * customer text goes through, and the channel the signed page may promise a
 * confirmation on.
 */
import { assertEquals } from "#std/assert";
import {
  customerSmsTarget,
  dispatchCustomerSms,
  signedConfirmChannel,
} from "./mod.ts";
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
