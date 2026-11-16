/**
 * REQ-899/900 e2e — the communications module on a booted app: a logged-in
 * user texts from the line (Twilio stood in by a local server), Twilio's
 * signed webhooks land, unsigned ones are refused, the inbox and the call log
 * read back, and the softphone token decodes.
 */
import "#reflect-metadata";
import { assertEquals, assertStringIncludes } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { CommunicationsModule } from "@communications/mod-root.ts";
import { twilioSignature } from "@communications/domain/business/twilio-signature/mod.ts";
import { decodeJwt } from "@communications/domain/business/voice-token/mod.ts";

@Module({ imports: [UsersModule, CommunicationsModule] })
class TestApp {}

const PORT = 9047;
const TWILIO_PORT = 9048;
const LINE = "+18432588463";
const PEER = "+15125559876";
const TOKEN = "e2e-auth-token";
const PUBLIC_URL = `http://localhost:${PORT}`;

async function drain(res: Response) {
  await res.body?.cancel();
}

async function login(phone = "+15125551234"): Promise<{ sessionId: string; userId: string }> {
  await drain(await fetch(`${PUBLIC_URL}/auth/send-otp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phoneNumber: phone }) }));
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${PUBLIC_URL}/auth/verify-otp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phoneNumber: phone, code: stored!.code }) }).then((r) => r.json());
  const me = await fetch(`${PUBLIC_URL}/me`, { headers: { "x-session-id": v.sessionId } }).then((r) => r.json());
  return { sessionId: v.sessionId, userId: me.id ?? me.user?.id };
}

async function twilioPost(path: string, params: Record<string, string>, sign = true): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (sign) headers["x-twilio-signature"] = await twilioSignature(TOKEN, `${PUBLIC_URL}${path}`, params);
  return await fetch(`${PUBLIC_URL}${path}`, { method: "POST", headers, body: new URLSearchParams(params).toString() });
}

Deno.test("communications e2e: text out, text in, inbox, token, inbound call, and the 403/401 walls", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const env: Record<string, string> = {
    COMMS_TWILIO_ACCOUNT_SID: "ACe2e",
    COMMS_TWILIO_AUTH_TOKEN: TOKEN,
    COMMS_TWILIO_FROM: LINE,
    COMMS_TWILIO_API_KEY_SID: "SKe2e",
    COMMS_TWILIO_API_KEY_SECRET: "e2e-secret",
    COMMS_TWILIO_TWIML_APP_SID: "APe2e",
    COMMS_PUBLIC_URL: PUBLIC_URL,
    COMMS_TWILIO_BASE_URL: `http://localhost:${TWILIO_PORT}`,
    COMMS_RING_IDENTITIES: "e2e_agent",
  };
  for (const [k, v] of Object.entries(env)) Deno.env.set(k, v);

  // Twilio, as far as this test is concerned
  const twilioCalls: { url: string; form: URLSearchParams }[] = [];
  const twilio = Deno.serve({ port: TWILIO_PORT, onListen() {} }, async (req) => {
    twilioCalls.push({ url: new URL(req.url).pathname, form: new URLSearchParams(await req.text()) });
    return new Response(JSON.stringify({ sid: "SMe2e", status: "queued" }), { status: 201, headers: { "content-type": "application/json" } });
  });

  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const { sessionId, userId } = await login();
    const auth = { "x-session-id": sessionId, "content-type": "application/json" };

    // 1. send a text from the line
    const sent = await fetch(`${PUBLIC_URL}/communications/texts`, { method: "POST", headers: auth, body: JSON.stringify({ to: "512-555-9876", body: "Hello from the line" }) }).then((r) => r.json());
    assertEquals(sent.ok, true);
    assertEquals(sent.message.status, "queued");
    assertEquals(sent.message.providerSid, "SMe2e");
    assertEquals(twilioCalls[0].url, "/2010-04-01/Accounts/ACe2e/Messages.json");
    assertEquals(twilioCalls[0].form.get("From"), LINE);
    assertEquals(twilioCalls[0].form.get("To"), PEER);
    assertEquals(twilioCalls[0].form.get("StatusCallback"), `${PUBLIC_URL}/communications/twilio/sms-status`);

    // 2. Twilio reports it delivered, then the peer texts back
    const status = await twilioPost("/communications/twilio/sms-status", { MessageSid: "SMe2e", MessageStatus: "delivered" });
    assertEquals(status.status, 204);
    await drain(status);
    const inbound = await twilioPost("/communications/twilio/sms", { MessageSid: "SMin", From: PEER, To: LINE, Body: "Got it, thanks!" });
    assertEquals(inbound.status, 200);
    assertStringIncludes(inbound.headers.get("content-type") ?? "", "xml");
    assertEquals(await inbound.text(), '<?xml version="1.0" encoding="UTF-8"?><Response></Response>');

    // 3. an unsigned webhook is refused
    const forged = await twilioPost("/communications/twilio/sms", { MessageSid: "SMx", From: PEER, To: LINE, Body: "forged" }, false);
    assertEquals(forged.status, 403);
    await drain(forged);

    // 4. the inbox
    const threads = await fetch(`${PUBLIC_URL}/communications/threads`, { headers: auth }).then((r) => r.json());
    assertEquals(threads.length, 1);
    assertEquals(threads[0].peer, PEER);
    assertEquals(threads[0].unreadCount, 1);
    assertEquals(threads[0].lastPreview, "Got it, thanks!");
    const detail = await fetch(`${PUBLIC_URL}/communications/threads/${encodeURIComponent(PEER)}`, { headers: auth }).then((r) => r.json());
    assertEquals(detail.texts.map((t: { body: string; status: string }) => [t.body, t.status]), [["Hello from the line", "delivered"], ["Got it, thanks!", "received"]]);
    assertEquals(detail.thread.unreadCount, 0);

    // 5. the softphone token
    const tok = await fetch(`${PUBLIC_URL}/communications/voice/token`, { method: "POST", headers: auth }).then((r) => r.json());
    const { payload } = decodeJwt(tok.token);
    assertEquals(payload.iss, "SKe2e");
    assertEquals(payload.grants.identity, userId.replace(/[^A-Za-z0-9_]/g, "_"));
    assertEquals(payload.grants.voice.outgoing.application_sid, "APe2e");

    // 6. an inbound call rings the softphone and shows in the log
    const ring = await twilioPost("/communications/twilio/voice/incoming", { CallSid: "CAe2e", From: PEER, To: LINE, CallStatus: "ringing" });
    assertEquals(ring.status, 200);
    const twiml = await ring.text();
    assertStringIncludes(twiml, `<Dial timeout="20" action="${PUBLIC_URL}/communications/twilio/voice/unanswered" callerId="${PEER}"><Client>e2e_agent</Client></Dial>`);
    const calls = await fetch(`${PUBLIC_URL}/communications/calls`, { headers: auth }).then((r) => r.json());
    assertEquals(calls.length, 1);
    assertEquals(calls[0].providerSid, "CAe2e");
    assertEquals(calls[0].status, "ringing");
    const one = await fetch(`${PUBLIC_URL}/communications/calls/${calls[0].id}`, { headers: auth }).then((r) => r.json());
    assertEquals(one.id, calls[0].id);

    // 7. no session, no inbox
    const anon = await fetch(`${PUBLIC_URL}/communications/threads`);
    assertEquals(anon.status, 401);
    await drain(anon);
  } finally {
    await server.stop();
    await twilio.shutdown();
    for (const k of Object.keys(env)) Deno.env.delete(k);
    await resetKv();
  }
});
