import { assert, assertEquals } from "#std/assert";
import { SmsService } from "./mod.ts";

interface CapturedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

function makeMockFetch(handler: (call: CapturedCall) => Response): { fetch: typeof fetch; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input as RequestInfo, init);
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => { headers[k] = v; });
    const body = req.method !== "GET" && req.method !== "HEAD" ? await req.text() : "";
    const call: CapturedCall = { url: req.url, method: req.method, headers, body };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return { fetch: f, calls };
}

Deno.test("SmsService smoke: dev mode (no SID) returns ok and never calls fetch", async () => {
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  const mock = makeMockFetch(() => new Response("nope", { status: 500 }));
  const svc = new SmsService();
  svc.fetchOverride = mock.fetch;
  const out = await svc.send({ to: "+15125551234", body: "Your code is 123456" });
  assertEquals(out.ok, true);
  assertEquals(out.reason, "dev_mode_no_dispatch");
  assertEquals(mock.calls.length, 0);
});

Deno.test("SmsService smoke: SID set but no AUTH_TOKEN returns ok=false", async () => {
  Deno.env.set("TWILIO_ACCOUNT_SID", "AC-x");
  Deno.env.delete("TWILIO_AUTH_TOKEN");
  Deno.env.delete("TWILIO_FROM");
  try {
    const svc = new SmsService();
    const out = await svc.send({ to: "+15125551234", body: "x" });
    assertEquals(out.ok, false);
    assert(out.reason?.includes("TWILIO_AUTH_TOKEN"));
  } finally { Deno.env.delete("TWILIO_ACCOUNT_SID"); }
});

Deno.test("SmsService smoke: SID + AUTH_TOKEN but no FROM returns ok=false", async () => {
  Deno.env.set("TWILIO_ACCOUNT_SID", "AC-x");
  Deno.env.set("TWILIO_AUTH_TOKEN",   "tok");
  Deno.env.delete("TWILIO_FROM");
  try {
    const svc = new SmsService();
    const out = await svc.send({ to: "+15125551234", body: "x" });
    assertEquals(out.ok, false);
    assert(out.reason?.includes("TWILIO_FROM"));
  } finally {
    Deno.env.delete("TWILIO_ACCOUNT_SID");
    Deno.env.delete("TWILIO_AUTH_TOKEN");
  }
});

Deno.test("SmsService smoke: posts form-urlencoded to /Accounts/:sid/Messages.json with Basic auth", async () => {
  Deno.env.set("TWILIO_ACCOUNT_SID", "AC-test");
  Deno.env.set("TWILIO_AUTH_TOKEN",  "tok-test");
  Deno.env.set("TWILIO_FROM",        "+15550000000");
  try {
    const mock = makeMockFetch(() =>
      new Response(JSON.stringify({ sid: "SM-abc-123" }), {
        status: 200, headers: { "content-type": "application/json" },
      }));
    const svc = new SmsService();
    svc.fetchOverride = mock.fetch;
    const out = await svc.send({ to: "+15125551234", body: "Your code is 654321" });
    assertEquals(out.ok, true);
    assertEquals(out.sid, "SM-abc-123");

    assertEquals(mock.calls.length, 1);
    const call = mock.calls[0];
    assert(call.url.includes("/2010-04-01/Accounts/AC-test/Messages.json"));
    assertEquals(call.method, "POST");
    assertEquals(call.headers["content-type"], "application/x-www-form-urlencoded");
    // Basic auth = base64("AC-test:tok-test")
    assertEquals(call.headers["authorization"], `Basic ${btoa("AC-test:tok-test")}`);
    // Body is form-urlencoded; parse and check fields.
    const params = new URLSearchParams(call.body);
    assertEquals(params.get("To"),   "+15125551234");
    assertEquals(params.get("From"), "+15550000000");
    assertEquals(params.get("Body"), "Your code is 654321");
  } finally {
    Deno.env.delete("TWILIO_ACCOUNT_SID");
    Deno.env.delete("TWILIO_AUTH_TOKEN");
    Deno.env.delete("TWILIO_FROM");
  }
});

Deno.test("SmsService smoke: 4xx response surfaces as ok=false with status in reason", async () => {
  Deno.env.set("TWILIO_ACCOUNT_SID", "AC");
  Deno.env.set("TWILIO_AUTH_TOKEN",  "t");
  Deno.env.set("TWILIO_FROM",        "+15550000000");
  try {
    const mock = makeMockFetch(() => new Response("invalid number", { status: 400 }));
    const svc = new SmsService();
    svc.fetchOverride = mock.fetch;
    const out = await svc.send({ to: "+1bogus", body: "x" });
    assertEquals(out.ok, false);
    assert(out.reason?.includes("twilio 400"));
  } finally {
    Deno.env.delete("TWILIO_ACCOUNT_SID");
    Deno.env.delete("TWILIO_AUTH_TOKEN");
    Deno.env.delete("TWILIO_FROM");
  }
});

Deno.test("SmsService smoke: fetch throwing is caught and surfaced", async () => {
  Deno.env.set("TWILIO_ACCOUNT_SID", "AC");
  Deno.env.set("TWILIO_AUTH_TOKEN",  "t");
  Deno.env.set("TWILIO_FROM",        "+15550000000");
  try {
    const f = (() => { throw new Error("network down"); }) as unknown as typeof fetch;
    const svc = new SmsService();
    svc.fetchOverride = f;
    const out = await svc.send({ to: "+15125551234", body: "x" });
    assertEquals(out.ok, false);
    assertEquals(out.reason, "network down");
  } finally {
    Deno.env.delete("TWILIO_ACCOUNT_SID");
    Deno.env.delete("TWILIO_AUTH_TOKEN");
    Deno.env.delete("TWILIO_FROM");
  }
});
