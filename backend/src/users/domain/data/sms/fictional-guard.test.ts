/**
 * REQ-523 (demo-loop cycle 3, issue m16): "The app says texts were sent to
 * numbers that can't get texts." REQ-403 guarded only the customer
 * quote/invoice texts; every other sender called SmsService.send directly,
 * and with no TWILIO_ACCOUNT_SID send answered ok for ANY number. So the
 * worker welcome said "Le mandamos a Luis Gómez el enlace para entrar y su
 * PIN por texto" to (305) 555-0123, and the editor invite said "We texted
 * (512) 555-0199 an invite".
 *
 * The guard now lives in SmsService.send itself, BEFORE the dev-mode short
 * circuit: a missing, undialable or fictional number is refused with a
 * `failureCode` (and a lang-key `reason`) in dev mode and production alike,
 * and never reaches the provider. A real number still goes out, dialled as
 * E.164.
 */
import { assertEquals } from "#std/assert";
import { SmsService } from "./mod.ts";

/** a provider stand-in that counts dials and answers like Twilio */
function provider() {
  const dialled: string[] = [];
  const fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    dialled.push(new URLSearchParams(String(init?.body ?? "")).get("To") ?? "");
    return Promise.resolve(Response.json({ sid: `SM-${dialled.length}` }));
  }) as typeof globalThis.fetch;
  return { fetch, dialled };
}

const TWILIO_ENV = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"];

async function withTwilio(fn: () => Promise<void>) {
  Deno.env.set("TWILIO_ACCOUNT_SID", "AC-req523");
  Deno.env.set("TWILIO_AUTH_TOKEN", "tok");
  Deno.env.set("TWILIO_FROM", "+18665551234");
  try {
    await fn();
  } finally {
    for (const k of TWILIO_ENV) Deno.env.delete(k);
  }
}

// the demo's numbers: the worker (pair 2), the editor invite (pair 7), the
// claim customer (pair 9) — exchange 555, line 01XX — and area code 555
const FICTIONAL = [
  "+13055550123",
  "(512) 555-0199",
  "5125550142",
  "(555) 123-4567",
];

Deno.test("REQ-523 m16 SmsService.send in dev mode refuses a fictional 555 number: ok false, failureCode fictional, the sms.fictionalNumber key — never 'sent'", async () => {
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  for (const to of FICTIONAL) {
    const p = provider();
    const svc = new SmsService();
    svc.fetchOverride = p.fetch;
    const out = await svc.send({ to, body: "Tu PIN es 1234" });
    assertEquals(
      [out.ok, out.failureCode, out.reason],
      [false, "fictional", "sms.fictionalNumber"],
      `dev mode claimed a text to ${to} went out`,
    );
    assertEquals(p.dialled, [], `${to} reached the provider`);
  }
});

Deno.test("REQ-523 m16 SmsService.send with Twilio configured refuses a fictional number before the provider is called", async () => {
  await withTwilio(async () => {
    for (const to of FICTIONAL) {
      const p = provider();
      const svc = new SmsService();
      svc.fetchOverride = p.fetch;
      const out = await svc.send({ to, body: "x" });
      assertEquals([out.ok, out.failureCode], [false, "fictional"], to);
      assertEquals(p.dialled, [], `${to} was dialled`);
    }
  });
});

Deno.test("REQ-523 m16 SmsService.send refuses a missing or undialable number with its code, in dev mode too", async () => {
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  const svc = new SmsService();
  const missing = await svc.send({ to: "  ", body: "x" });
  assertEquals(
    [missing.ok, missing.failureCode, missing.reason],
    [false, "missing", "sms.invalidNumber"],
  );
  for (const to of ["12345", "555-12", "+1bogus"]) {
    const out = await svc.send({ to, body: "x" });
    assertEquals(
      [out.ok, out.failureCode, out.reason],
      [false, "invalid", "sms.invalidNumber"],
      to,
    );
  }
});

Deno.test("REQ-523 m16 a real number still goes out — 555 outside 01XX included — and a typed 10-digit number is dialled as E.164", async () => {
  await withTwilio(async () => {
    const p = provider();
    const svc = new SmsService();
    svc.fetchOverride = p.fetch;
    const a = await svc.send({ to: "(512) 555-1234", body: "x" });
    const b = await svc.send({ to: "+13055551234", body: "x" });
    assertEquals([a.ok, b.ok], [true, true]);
    assertEquals(p.dialled, ["+15125551234", "+13055551234"]);
  });
});
