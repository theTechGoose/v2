/** REQ-899 — the wire format of the line's Twilio client, against a mock fetch (never the live API). */
import { assertEquals, assertStringIncludes } from "#std/assert";
import { configFromEnv } from "@communications/domain/data/config/mod.ts";
import { TwilioClient } from "./mod.ts";

function capture(handler: (req: Request, body: string) => Response) {
  const calls: { req: Request; body: string }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input as RequestInfo, init);
    const body = await req.text();
    calls.push({ req, body });
    return handler(req, body);
  }) as typeof fetch;
  return { f, calls };
}

const LIVE = { COMMS_TWILIO_ACCOUNT_SID: "ACtest", COMMS_TWILIO_AUTH_TOKEN: "tok", COMMS_TWILIO_FROM: "+18432588463" };

Deno.test("REQ-899 TwilioClient smoke: dev mode (no account SID) never calls fetch", async () => {
  const { f, calls } = capture(() => new Response("no", { status: 500 }));
  const c = new TwilioClient(configFromEnv({}));
  c.fetchOverride = f;
  const out = await c.sendMessage({ to: "+15125551234", body: "hi" });
  assertEquals(out, { ok: true, reason: "dev_mode_no_dispatch", status: "dev" });
  assertEquals(calls.length, 0);
});

Deno.test("REQ-899 TwilioClient smoke: posts the urlencoded Messages create with basic auth, From = the line, StatusCallback", async () => {
  const { f, calls } = capture(() => new Response(JSON.stringify({ sid: "SM1", status: "queued" }), { status: 201 }));
  const c = new TwilioClient(configFromEnv(LIVE));
  c.fetchOverride = f;
  const out = await c.sendMessage({ to: "+15125551234", body: "hi & bye", statusCallback: "https://x.test/communications/twilio/sms-status" });
  assertEquals(out, { ok: true, sid: "SM1", status: "queued" });
  const { req, body } = calls[0];
  assertEquals(req.url, "https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json");
  assertEquals(req.headers.get("authorization"), `Basic ${btoa("ACtest:tok")}`);
  assertEquals(req.headers.get("content-type"), "application/x-www-form-urlencoded");
  const form = new URLSearchParams(body);
  assertEquals(form.get("To"), "+15125551234");
  assertEquals(form.get("From"), "+18432588463");
  assertEquals(form.get("Body"), "hi & bye");
  assertEquals(form.get("StatusCallback"), "https://x.test/communications/twilio/sms-status");
});

Deno.test("REQ-899 TwilioClient smoke: a Twilio rejection surfaces its code and message; COMMS_TWILIO_BASE_URL redirects the REST origin", async () => {
  const { f, calls } = capture(() => new Response(JSON.stringify({ code: 21211, message: "Invalid 'To' Phone Number" }), { status: 400 }));
  const c = new TwilioClient(configFromEnv({ ...LIVE, COMMS_TWILIO_BASE_URL: "http://localhost:1/" }));
  c.fetchOverride = f;
  const out = await c.sendMessage({ to: "+1", body: "x" });
  assertEquals(out.ok, false);
  assertEquals(out.code, 21211);
  assertStringIncludes(out.reason!, "Invalid 'To'");
  assertStringIncludes(calls[0].req.url, "http://localhost:1/2010-04-01/");
});
