import { assert, assertEquals } from "#std/assert";
import { EmailService } from "./mod.ts";
import { aliasFrom, HOUSE_FROM } from "@communication/domain/business/sender/mod.ts";

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

Deno.test("EmailService smoke: posts to /email with X-Postmark-Server-Token header and Postmark body shape, from the house address (REQ-123)", async () => {
  Deno.env.set("POSTMARK_API_KEY", "test-key-xyz");
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
    assertEquals(body.From, HOUSE_FROM);
    assertEquals(body.To, "tom@example.test");
    assertEquals(body.Subject, "Your quote");
    assertEquals(body.HtmlBody, "<p>see attached</p>");
    assertEquals(body.MessageStream, "outbound");
  } finally {
    Deno.env.delete("POSTMARK_API_KEY");
  }
});

Deno.test("EmailService smoke: a per-call From on documonster.com beats the house From; one off the domain is refused (REQ-123)", async () => {
  Deno.env.set("POSTMARK_API_KEY", "k");
  try {
    const mock = makeMockFetch(() => new Response(JSON.stringify({ MessageID: "id" }), { status: 200, headers: { "content-type": "application/json" } }));
    const svc = new EmailService(); svc.fetchOverride = mock.fetch;
    await svc.send({ to: "to@x.test", subject: "s", htmlBody: "h", from: aliasFrom("acme") });
    const body = mock.calls[0].body as { From: string };
    assertEquals(body.From, "acme@documonster.com");

    const refused = await svc.send({ to: "to@x.test", subject: "s", htmlBody: "h", from: "warnings@monsterrg.com" });
    assertEquals(refused.ok, false);
    assertEquals(mock.calls.length, 1, "Postmark never saw the refused one");
  } finally {
    Deno.env.delete("POSTMARK_API_KEY");
  }
});

Deno.test("EmailService smoke: non-2xx response surfaces as ok=false with status in reason", async () => {
  Deno.env.set("POSTMARK_API_KEY", "k");
  try {
    const mock = makeMockFetch(() => new Response("invalid api key", { status: 401 }));
    const svc = new EmailService(); svc.fetchOverride = mock.fetch;
    const out = await svc.send({ to: "to@x.test", subject: "s", htmlBody: "h" });
    assertEquals(out.ok, false);
    assert(out.reason?.includes("postmark 401"));
  } finally {
    Deno.env.delete("POSTMARK_API_KEY");
  }
});

Deno.test("EmailService smoke: fetch throwing is caught and surfaced as ok=false", async () => {
  Deno.env.set("POSTMARK_API_KEY", "k");
  try {
    const f = (() => { throw new Error("network down"); }) as unknown as typeof fetch;
    const svc = new EmailService(); svc.fetchOverride = f;
    const out = await svc.send({ to: "to@x.test", subject: "s", htmlBody: "h" });
    assertEquals(out.ok, false);
    assertEquals(out.reason, "network down");
  } finally {
    Deno.env.delete("POSTMARK_API_KEY");
  }
});

// REQ-123 — the real Postmark server accepts documonster.com as a sender: the house From and an
// alias, each to Postmark's blackhole address (accepted and discarded, never delivered). Needs the
// real key, read before the mock tests above delete it:
// `cd backend && deno test -A --env-file=../.env src/communication/domain/data/email-service/smk.test.ts`.
const REAL_KEY = Deno.env.get("POSTMARK_API_KEY");
Deno.test("REQ-123 smoke (real Postmark): DocuMonster <hello@documonster.com> and <alias>@documonster.com are accepted senders", async () => {
  assert(REAL_KEY && REAL_KEY.length > 20, "POSTMARK_API_KEY is the real server token here — load ../.env");
  Deno.env.set("POSTMARK_API_KEY", REAL_KEY);
  try {
    const svc = new EmailService();
    for (const from of [HOUSE_FROM, aliasFrom("sender-probe")]) {
      const out = await svc.send({
        to: "test@blackhole.postmarkapp.com",
        subject: `REQ-123 sender probe — ${from}`,
        htmlBody: `<p>REQ-123: every email leaves from documonster.com. This probe left from ${from}.</p>`,
        from,
      });
      assertEquals(out.ok, true, `${from}: ${out.reason}`);
      assert(out.messageId, `${from}: Postmark gives a MessageID`);
    }
  } finally {
    Deno.env.delete("POSTMARK_API_KEY");
  }
});
