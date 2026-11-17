/**
 * REQ-899/900/903..905 e2e — the communications module on a booted app: the
 * owner of the env line texts from it (Twilio stood in by a local server),
 * Twilio's signed webhooks land, unsigned ones are refused, the inbox and the
 * call log read back, and the softphone token decodes. Then a second user,
 * who has no line (409), buys a number: a subaccount, API key, TwiML App and
 * number are provisioned on the stand-in, their texts leave from it, Twilio's
 * webhooks for that subaccount verify with ITS token (and not the main one),
 * their token is signed by their key, and the line is released again.
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
import { A2pStandIn, VALID_A2P_FORM } from "@communications/domain/coordinators/_test-support/a2p-stand-in.ts";

@Module({ imports: [UsersModule, CommunicationsModule] })
class TestApp {}

const PORT = 9047;
const TWILIO_PORT = 9048;
const LINE = "+18432588463";
const PEER = "+15125559876";
const TOKEN = "e2e-auth-token";
const SUB_SID = "ACsubE2E";
const SUB_TOKEN = "sub-e2e-token";
const SUB_NUMBER = "+18435550177";
const PUBLIC_URL = `http://localhost:${PORT}`;

async function drain(res: Response) {
  await res.body?.cancel();
}

async function login(phone = "+15125551234", base = PUBLIC_URL): Promise<{ sessionId: string; userId: string }> {
  await drain(await fetch(`${base}/auth/send-otp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phoneNumber: phone }) }));
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${base}/auth/verify-otp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phoneNumber: phone, code: stored!.code }) }).then((r) => r.json());
  const me = await fetch(`${base}/me`, { headers: { "x-session-id": v.sessionId } }).then((r) => r.json());
  return { sessionId: v.sessionId, userId: me.id ?? me.user?.id };
}

async function twilioPost(path: string, params: Record<string, string>, sign: boolean | string = true, base = PUBLIC_URL): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (!("AccountSid" in params)) params = { AccountSid: "ACe2e", ...params };
  if (sign) headers["x-twilio-signature"] = await twilioSignature(sign === true ? TOKEN : sign, `${base}${path}`, params);
  return await fetch(`${base}${path}`, { method: "POST", headers, body: new URLSearchParams(params).toString() });
}

/** Twilio, as far as this test is concerned: Messages plus the subaccount provisioning REST */
function twilioStandIn(method: string, path: string, form: URLSearchParams): { status: number; body: unknown } {
  const json = (body: unknown, status = 201) => ({ status, body });
  if (path === "/2010-04-01/Accounts.json") return json({ sid: SUB_SID, auth_token: SUB_TOKEN, friendly_name: form.get("FriendlyName"), status: "active" });
  if (path === `/2010-04-01/Accounts/${SUB_SID}/Keys.json`) return json({ sid: "SKsubE2E", secret: "sub-e2e-key-secret" });
  if (path === `/2010-04-01/Accounts/${SUB_SID}/Applications.json`) return json({ sid: "APsubE2E", voice_url: form.get("VoiceUrl") });
  if (path === `/2010-04-01/Accounts/${SUB_SID}/IncomingPhoneNumbers.json`) {
    if (form.get("PhoneNumber") === "+18435550000") return json({ code: 21422, message: "The requested phone number is not available", status: 400 }, 400);
    return json({ sid: "PNsubE2E", phone_number: form.get("PhoneNumber") });
  }
  if (method === "DELETE" && path === `/2010-04-01/Accounts/${SUB_SID}/IncomingPhoneNumbers/PNsubE2E.json`) return { status: 204, body: null };
  if (path === `/2010-04-01/Accounts/${SUB_SID}.json`) return json({ sid: SUB_SID, status: form.get("Status") }, 200);
  if (path.startsWith("/2010-04-01/Accounts/ACe2e/AvailablePhoneNumbers/US/Local.json")) {
    return json({ available_phone_numbers: [{ phone_number: SUB_NUMBER, friendly_name: "(843) 555-0177", locality: "Myrtle Beach", region: "SC", capabilities: { voice: true, SMS: true, MMS: true } }] }, 200);
  }
  if (path.endsWith("/Messages.json")) return json({ sid: path.includes(SUB_SID) ? "SMsubE2E" : "SMe2e", status: "queued" });
  return json({ code: 20404, message: `stand-in: no route for ${method} ${path}` }, 404);
}

Deno.test("communications e2e: env line (text out/in, inbox, token, inbound call, 403/401 walls) and a customer line (buy, per-subaccount webhooks, token, release)", async () => {
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
  const twilioCalls: { method: string; url: string; form: URLSearchParams }[] = [];
  const twilio = Deno.serve({ port: TWILIO_PORT, onListen() {} }, async (req) => {
    const u = new URL(req.url);
    const form = new URLSearchParams(await req.text());
    twilioCalls.push({ method: req.method, url: u.pathname + u.search, form });
    const { status, body } = twilioStandIn(req.method, u.pathname, form);
    return body === null ? new Response(null, { status }) : new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });

  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const { sessionId, userId } = await login();
    const auth = { "x-session-id": sessionId, "content-type": "application/json" };
    Deno.env.set("COMMS_ENV_LINE_OWNER", userId); // REQ-904: the env line is this user's
    env.COMMS_ENV_LINE_OWNER = userId;

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

    // ── REQ-903..905: a second user buys their own line ──────────────────────
    const cust = await login("+15125550002");
    const cauth = { "x-session-id": cust.sessionId, "content-type": "application/json" };

    // 8. no line yet: nothing to send from (409 no_line), and the line read says so
    const noLine = await fetch(`${PUBLIC_URL}/communications/texts`, { method: "POST", headers: cauth, body: JSON.stringify({ to: PEER, body: "x" }) });
    assertEquals(noLine.status, 409);
    await drain(noLine);
    assertEquals(await fetch(`${PUBLIC_URL}/communications/line`, { headers: cauth }).then((r) => r.json()), { line: null });

    // 9. shop for a number
    const avail = await fetch(`${PUBLIC_URL}/communications/numbers/available?areaCode=843`, { headers: cauth }).then((r) => r.json());
    assertEquals(avail.numbers.map((n: { phoneNumber: string }) => n.phoneNumber), [SUB_NUMBER]);
    assertEquals(avail.numbers[0].capabilities, { voice: true, sms: true, mms: true });
    assertStringIncludes(twilioCalls.at(-1)!.url, "/Accounts/ACe2e/AvailablePhoneNumbers/US/Local.json?VoiceEnabled=true&SmsEnabled=true&PageSize=20&AreaCode=843");
    const badArea = await fetch(`${PUBLIC_URL}/communications/numbers/available?areaCode=8`, { headers: cauth });
    assertEquals(badArea.status, 400);
    await drain(badArea);

    // 10. a number Twilio refuses: 502, and the subaccount made for it is closed again
    const before = twilioCalls.length;
    const refused = await fetch(`${PUBLIC_URL}/communications/numbers`, { method: "POST", headers: cauth, body: JSON.stringify({ phoneNumber: "+18435550000" }) });
    assertEquals(refused.status, 502);
    await drain(refused);
    const rollback = twilioCalls.slice(before).map((c) => `${c.method} ${c.url}${c.form.get("Status") ? ` Status=${c.form.get("Status")}` : ""}`);
    assertEquals(rollback, [
      "POST /2010-04-01/Accounts.json",
      `POST /2010-04-01/Accounts/${SUB_SID}/Keys.json`,
      `POST /2010-04-01/Accounts/${SUB_SID}/Applications.json`,
      `POST /2010-04-01/Accounts/${SUB_SID}/IncomingPhoneNumbers.json`,
      `POST /2010-04-01/Accounts/${SUB_SID}.json Status=closed`,
    ]);
    assertEquals(await fetch(`${PUBLIC_URL}/communications/line`, { headers: cauth }).then((r) => r.json()), { line: null });

    // 11. buy: subaccount → key → TwiML App → number, every webhook pointed at us; secrets never in the response
    const bought = await fetch(`${PUBLIC_URL}/communications/numbers`, { method: "POST", headers: cauth, body: JSON.stringify({ phoneNumber: SUB_NUMBER, friendlyName: "Shop" }) }).then((r) => r.json());
    assertEquals(bought.status, "active");
    assertEquals(bought.number, SUB_NUMBER);
    assertEquals(bought.subaccountSid, SUB_SID);
    assertEquals(bought.userId, cust.userId);
    assertEquals("authTokenSealed" in bought, false);
    assertEquals("apiKeySecretSealed" in bought, false);
    const buyCall = twilioCalls.find((c) => c.url === `/2010-04-01/Accounts/${SUB_SID}/IncomingPhoneNumbers.json` && c.form.get("PhoneNumber") === SUB_NUMBER)!;
    assertEquals(buyCall.form.get("VoiceUrl"), `${PUBLIC_URL}/communications/twilio/voice/incoming`);
    assertEquals(buyCall.form.get("SmsUrl"), `${PUBLIC_URL}/communications/twilio/sms`);
    assertEquals(buyCall.form.get("StatusCallback"), `${PUBLIC_URL}/communications/twilio/voice/status`);
    assertEquals(buyCall.form.get("FriendlyName"), "Shop");
    const appCall = twilioCalls.find((c) => c.url === `/2010-04-01/Accounts/${SUB_SID}/Applications.json`)!;
    assertEquals(appCall.form.get("VoiceUrl"), `${PUBLIC_URL}/communications/twilio/voice/outgoing`);
    const again = await fetch(`${PUBLIC_URL}/communications/numbers`, { method: "POST", headers: cauth, body: JSON.stringify({ phoneNumber: "+18435550199" }) });
    assertEquals(again.status, 409);
    await drain(again);

    // 12. REQ-920a: not registered for texting yet → 403 a2p_unregistered (a2p e2e below walks the registration);
    //     with the gate off (dev) their text leaves from THEIR number on THEIR subaccount; their inbox is theirs alone
    const gated = await fetch(`${PUBLIC_URL}/communications/texts`, { method: "POST", headers: cauth, body: JSON.stringify({ to: PEER, body: "too early" }) });
    assertEquals(gated.status, 403);
    assertEquals((await gated.json()).code, "a2p_unregistered");
    Deno.env.set("COMMS_A2P_GATE", "off");
    env.COMMS_A2P_GATE = "off";
    const csent = await fetch(`${PUBLIC_URL}/communications/texts`, { method: "POST", headers: cauth, body: JSON.stringify({ to: PEER, body: "From the shop" }) }).then((r) => r.json());
    assertEquals(csent.ok, true);
    assertEquals(csent.message.line, SUB_NUMBER);
    assertEquals(csent.message.providerSid, "SMsubE2E");
    const cmsg = twilioCalls.at(-1)!;
    assertEquals(cmsg.url, `/2010-04-01/Accounts/${SUB_SID}/Messages.json`);
    assertEquals(cmsg.form.get("From"), SUB_NUMBER);
    const cthreads = await fetch(`${PUBLIC_URL}/communications/threads`, { headers: cauth }).then((r) => r.json());
    assertEquals(cthreads.map((t: { line: string; lastPreview: string }) => [t.line, t.lastPreview]), [[SUB_NUMBER, "From the shop"]]);
    assertEquals((await fetch(`${PUBLIC_URL}/communications/threads`, { headers: auth }).then((r) => r.json())).length, 1); // the owner still sees only the env line's

    // 13. Twilio's webhook for the subaccount verifies with the subaccount's token — the main token does not pass for it
    const subIn = await twilioPost("/communications/twilio/sms", { AccountSid: SUB_SID, MessageSid: "SMsubIn", From: PEER, To: SUB_NUMBER, Body: "Hi shop" }, SUB_TOKEN);
    assertEquals(subIn.status, 200);
    await drain(subIn);
    const wrongToken = await twilioPost("/communications/twilio/sms", { AccountSid: SUB_SID, MessageSid: "SMsubX", From: PEER, To: SUB_NUMBER, Body: "forged" }, TOKEN);
    assertEquals(wrongToken.status, 403);
    await drain(wrongToken);
    const stranger = await twilioPost("/communications/twilio/sms", { AccountSid: "ACstranger", MessageSid: "SMsubY", From: PEER, To: SUB_NUMBER, Body: "forged" }, TOKEN);
    assertEquals(stranger.status, 403);
    await drain(stranger);
    const cdetail = await fetch(`${PUBLIC_URL}/communications/threads/${encodeURIComponent(PEER)}`, { headers: cauth }).then((r) => r.json());
    assertEquals(cdetail.texts.map((t: { body: string }) => t.body), ["From the shop", "Hi shop"]);

    // 14. an inbound call on their number rings only them; their token is signed by their key, for their subaccount
    const cring = await twilioPost("/communications/twilio/voice/incoming", { AccountSid: SUB_SID, CallSid: "CAsub", From: PEER, To: SUB_NUMBER, CallStatus: "ringing" }, SUB_TOKEN);
    assertEquals(cring.status, 200);
    assertStringIncludes(await cring.text(), `<Client>${cust.userId}</Client></Dial>`);
    const ctok = await fetch(`${PUBLIC_URL}/communications/voice/token`, { method: "POST", headers: cauth }).then((r) => r.json());
    const cpayload = decodeJwt(ctok.token).payload;
    assertEquals(cpayload.iss, "SKsubE2E");
    assertEquals(cpayload.sub, SUB_SID);
    assertEquals(cpayload.grants.voice.outgoing.application_sid, "APsubE2E");

    // 15. release: the number goes back, the subaccount closes, the line reads released, texting is 409 again
    const released = await fetch(`${PUBLIC_URL}/communications/line/release`, { method: "POST", headers: cauth }).then((r) => r.json());
    assertEquals(released.line.status, "released");
    assertEquals(twilioCalls.slice(-2).map((c) => `${c.method} ${c.url}`), [`DELETE /2010-04-01/Accounts/${SUB_SID}/IncomingPhoneNumbers/PNsubE2E.json`, `POST /2010-04-01/Accounts/${SUB_SID}.json`]);
    assertEquals(twilioCalls.at(-1)!.form.get("Status"), "closed");
    const afterRelease = await fetch(`${PUBLIC_URL}/communications/texts`, { method: "POST", headers: cauth, body: JSON.stringify({ to: PEER, body: "x" }) });
    assertEquals(afterRelease.status, 409);
    await drain(afterRelease);
    assertEquals((await fetch(`${PUBLIC_URL}/communications/line`, { headers: cauth }).then((r) => r.json())).line.status, "released");
  } finally {
    await server.stop();
    await twilio.shutdown();
    for (const k of Object.keys(env)) Deno.env.delete(k);
    await resetKv();
  }
});

const A2P_PORT = 9920;
const A2P_TWILIO_PORT = 9921;

Deno.test("REQ-920a/c e2e: a customer line registers for texting (ISV walk on its subaccount), the a2p-status webhook refreshes it, texting opens once the campaign is VERIFIED", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const base = `http://localhost:${A2P_PORT}`;
  const twilioBase = `http://localhost:${A2P_TWILIO_PORT}`;
  const env: Record<string, string> = {
    COMMS_TWILIO_ACCOUNT_SID: "ACe2e",
    COMMS_TWILIO_AUTH_TOKEN: TOKEN,
    COMMS_TWILIO_FROM: LINE,
    COMMS_PUBLIC_URL: base,
    COMMS_TWILIO_BASE_URL: twilioBase,
    COMMS_TRUSTHUB_BASE_URL: twilioBase,
    COMMS_MESSAGING_BASE_URL: twilioBase,
  };
  for (const [k, v] of Object.entries(env)) Deno.env.set(k, v);
  Deno.env.delete("COMMS_A2P_GATE");
  Deno.env.delete("COMMS_ENV_LINE_OWNER");
  const stand = new A2pStandIn();
  const twilio = Deno.serve({ port: A2P_TWILIO_PORT, onListen() {} }, async (req) => {
    const u = new URL(req.url);
    const form = new URLSearchParams(await req.text());
    const account = atob((req.headers.get("authorization") ?? "Basic Og==").slice(6)).split(":")[0];
    const { status, body } = stand.handle(req.method, u.pathname + u.search, form, account) ?? twilioStandIn(req.method, u.pathname, form);
    return body === null ? new Response(null, { status }) : new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
  const server = await bootstrapServer(TestApp, { port: A2P_PORT, swagger: false });
  await server.listen();
  try {
    const cust = await login("+15125550920", base);
    const H = { "x-session-id": cust.sessionId, "content-type": "application/json" };
    const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = H) => {
      const r = await fetch(`${base}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const text = await r.text();
      return { status: r.status, body: text ? JSON.parse(text) : null };
    };

    // no line yet → 409 no_line; then buy one
    assertEquals((await call("POST", "/communications/a2p", VALID_A2P_FORM)).status, 409);
    assertEquals((await call("POST", "/communications/numbers", { phoneNumber: SUB_NUMBER })).status, 200);

    // 1. not registered: texting is refused in one line, the registration reads null
    const refused = await call("POST", "/communications/texts", { to: PEER, body: "hello" });
    assertEquals(refused.status, 403);
    assertEquals(refused.body.code, "a2p_unregistered");
    assertEquals((await call("GET", "/communications/a2p")).body, { registration: null });
    assertEquals((await call("GET", "/communications/a2p", undefined, {})).status, 401);

    // 2. a broken form names its fields (400 a2p_invalid), touching nothing at Twilio
    const bad = await call("POST", "/communications/a2p", { ...VALID_A2P_FORM, ein: "12", samples: [] });
    assertEquals(bad.status, 400);
    assertEquals(bad.body.code, "a2p_invalid");
    assertEquals(bad.body.fields.map((f: { field: string }) => f.field).sort(), ["ein", "samples"]);
    assertEquals(stand.calls.length, 0);

    // 3. submit: the ISV walk on the line's subaccount, up to the brand (in review) and the messaging service
    const started = await call("POST", "/communications/a2p", VALID_A2P_FORM);
    assertEquals(started.status, 200);
    const reg = started.body;
    assertEquals(reg.state, "brand_pending");
    assertEquals(reg.subaccountSid, SUB_SID);
    assertEquals(reg.errors, []);
    assertEquals(stand.calls.find((c) => c.path === "/v1/CustomerProfiles" && c.method === "POST")!.form.get("StatusCallback"), `${base}/communications/twilio/a2p-status`);
    assertEquals(stand.calls.filter((c) => c.method === "POST").every((c) => c.account === SUB_SID), true);
    assertEquals(stand.calls.find((c) => c.path === `/v1/Services/${reg.serviceSid}/PhoneNumbers`)!.form.get("PhoneNumberSid"), "PNsubE2E");
    assertEquals((await call("GET", "/communications/a2p")).body.registration.brandSid, reg.brandSid);

    // 4. Twilio's TrustHub status callback (signed with the SUBACCOUNT's token) refreshes the line's registration
    stand.profileStatus = "twilio-approved";
    const before = stand.calls.length;
    const hook = await twilioPost("/communications/twilio/a2p-status", { AccountSid: SUB_SID, BundleSid: reg.profileSid, Status: "twilio-approved" }, SUB_TOKEN, base);
    assertEquals(hook.status, 204);
    await drain(hook);
    assertEquals(stand.calls.slice(before).some((c) => c.method === "GET" && c.path === `/v1/CustomerProfiles/${reg.profileSid}`), true);
    assertEquals((await call("GET", "/communications/a2p")).body.registration.profileStatus, "twilio-approved");
    const forged = await twilioPost("/communications/twilio/a2p-status", { AccountSid: SUB_SID, BundleSid: reg.profileSid, Status: "twilio-approved" }, TOKEN, base);
    assertEquals(forged.status, 403);
    await drain(forged);

    // 5. the brand is approved and the campaign verified: "Check status" → registered, and texting opens
    stand.brandStatus = "APPROVED";
    stand.campaignStatus = "VERIFIED";
    const done = await call("POST", "/communications/a2p/refresh", {});
    assertEquals(done.status, 200);
    assertEquals(done.body.state, "registered");
    assertEquals(done.body.campaignStatus, "VERIFIED");
    const sent = await call("POST", "/communications/texts", { to: PEER, body: "registered now" });
    assertEquals(sent.status, 200);
    assertEquals(sent.body.ok, true);
  } finally {
    await server.stop();
    await twilio.shutdown();
    for (const k of Object.keys(env)) Deno.env.delete(k);
    await resetKv();
  }
});
