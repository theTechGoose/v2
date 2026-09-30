import { assert, assertEquals } from "#std/assert";
import { EmailService } from "./mod.ts";

interface CapturedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function makeMockFetch(handler: (call: CapturedCall) => Response): { fetch: typeof fetch; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input as RequestInfo, init);
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => { headers[k] = v; });
    let body: unknown = undefined;
    if (req.method !== "GET" && req.method !== "HEAD") {
      const text = await req.text();
      try { body = JSON.parse(text); } catch { body = text; }
    }
    const call: CapturedCall = { url: req.url, method: req.method, headers, body };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return { fetch: f, calls };
}

Deno.test("EmailService smoke: dev mode (no API key) returns ok with dev_mode reason and never calls fetch", async () => {
  Deno.env.delete("POSTMARK_API_KEY");
  const mock = makeMockFetch(() => new Response("should-not-be-called", { status: 500 }));
  const svc = new EmailService(); svc.fetchOverride = mock.fetch;
  const out = await svc.send({ to: "ops@acme.test", subject: "hi", htmlBody: "<p>hi</p>" });
  assertEquals(out.ok, true);
  assertEquals(out.reason, "dev_mode_no_dispatch");
  assertEquals(mock.calls.length, 0);
});

Deno.test("EmailService smoke: with API key but no FROM returns ok=false", async () => {
  Deno.env.set("POSTMARK_API_KEY", "test-key");
  Deno.env.delete("POSTMARK_FROM");
  try {
    const svc = new EmailService();
    const out = await svc.send({ to: "ops@acme.test", subject: "hi", htmlBody: "<p>hi</p>" });
    assertEquals(out.ok, false);
    assert(out.reason?.includes("POSTMARK_FROM"));
  } finally {
    Deno.env.delete("POSTMARK_API_KEY");
  }
});

Deno.test("EmailService smoke: posts to /email with X-Postmark-Server-Token header and Postmark body shape", async () => {
  Deno.env.set("POSTMARK_API_KEY", "test-key-xyz");
  Deno.env.set("POSTMARK_FROM", "noreply@paperwork.test");
  try {
    const mock = makeMockFetch(() => new Response(JSON.stringify({ MessageID: "abc-123" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const svc = new EmailService(); svc.fetchOverride = mock.fetch;
    const out = await svc.send({ to: "tom@example.test", subject: "Your quote", htmlBody: "<p>see attached</p>" });
    assertEquals(out.ok, true);
    assertEquals(out.messageId, "abc-123");

    assertEquals(mock.calls.length, 1);
    const call = mock.calls[0];
    assertEquals(call.url.endsWith("/email"), true);
    assertEquals(call.method, "POST");
    assertEquals(call.headers["x-postmark-server-token"], "test-key-xyz");
    const body = call.body as { From: string; To: string; Subject: string; HtmlBody: string; MessageStream: string };
    assertEquals(body.From, "noreply@paperwork.test");
    assertEquals(body.To, "tom@example.test");
    assertEquals(body.Subject, "Your quote");
    assertEquals(body.HtmlBody, "<p>see attached</p>");
    assertEquals(body.MessageStream, "outbound");
  } finally {
    Deno.env.delete("POSTMARK_API_KEY");
    Deno.env.delete("POSTMARK_FROM");
  }
});

Deno.test("EmailService smoke: per-call from override beats POSTMARK_FROM", async () => {
  Deno.env.set("POSTMARK_API_KEY", "k");
  Deno.env.set("POSTMARK_FROM", "default@x.test");
  try {
    const mock = makeMockFetch(() => new Response(JSON.stringify({ MessageID: "id" }), { status: 200, headers: { "content-type": "application/json" } }));
    const svc = new EmailService(); svc.fetchOverride = mock.fetch;
    await svc.send({ to: "to@x.test", subject: "s", htmlBody: "h", from: "override@x.test" });
    const body = mock.calls[0].body as { From: string };
    assertEquals(body.From, "override@x.test");
  } finally {
    Deno.env.delete("POSTMARK_API_KEY");
    Deno.env.delete("POSTMARK_FROM");
  }
});

Deno.test("EmailService smoke: non-2xx response surfaces as ok=false with status in reason", async () => {
  Deno.env.set("POSTMARK_API_KEY", "k");
  Deno.env.set("POSTMARK_FROM", "from@x.test");
  try {
    const mock = makeMockFetch(() => new Response("invalid api key", { status: 401 }));
    const svc = new EmailService(); svc.fetchOverride = mock.fetch;
    const out = await svc.send({ to: "to@x.test", subject: "s", htmlBody: "h" });
    assertEquals(out.ok, false);
    assert(out.reason?.includes("postmark 401"));
  } finally {
    Deno.env.delete("POSTMARK_API_KEY");
    Deno.env.delete("POSTMARK_FROM");
  }
});

Deno.test("EmailService smoke: fetch throwing is caught and surfaced as ok=false", async () => {
  Deno.env.set("POSTMARK_API_KEY", "k");
  Deno.env.set("POSTMARK_FROM", "from@x.test");
  try {
    const f = (() => { throw new Error("network down"); }) as unknown as typeof fetch;
    const svc = new EmailService(); svc.fetchOverride = f;
    const out = await svc.send({ to: "to@x.test", subject: "s", htmlBody: "h" });
    assertEquals(out.ok, false);
    assertEquals(out.reason, "network down");
  } finally {
    Deno.env.delete("POSTMARK_API_KEY");
    Deno.env.delete("POSTMARK_FROM");
  }
});
