/** REQ-912c — GET /me/systems: what DocuMonster is wired to for this account, in one call. REQ-920d: the line's texting registration. */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { HrModule } from "@hr/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { LineStore } from "@communications/domain/data/line-store/mod.ts";
import { A2pStore } from "@communications/domain/data/a2p-store/mod.ts";

@Module({ imports: [HrModule] })
class TestApp {}
const PORT = 9912;
const J = { "content-type": "application/json" };

Deno.test("REQ-912c /me/systems: email (Postmark), the line, card payments, e-sign, and the HR registry — with and without a line", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  Deno.env.delete("COMMS_TWILIO_ACCOUNT_SID");
  Deno.env.delete("COMMS_ENV_LINE_OWNER");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const call = async (method: string, path: string, body?: unknown, headers: HeadersInit = {}) => {
      const r = await fetch(`http://localhost:${PORT}${path}`, { method, headers: { ...J, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await r.text();
      return { status: r.status, body: text ? JSON.parse(text) : null };
    };
    const phone = "+17025559120";
    await call("POST", "/auth/send-otp", { phoneNumber: phone });
    const otp = await new OtpStore().get(phone);
    const v = await call("POST", "/auth/verify-otp", { phoneNumber: phone, code: otp!.code });
    const H = { "x-session-id": v.body.sessionId as string };
    const me = await call("GET", "/me", undefined, H);
    const userId: string = me.body.id ?? me.body.user?.id;

    assertEquals((await call("GET", "/me/systems")).status, 401);

    const s0 = await call("GET", "/me/systems", undefined, H);
    assertEquals(s0.status, 200);
    assertEquals(s0.body.email.provider, "postmark");
    assertEquals(s0.body.email.configured, false, "no POSTMARK_API_KEY in the test → dev mode");
    assert(String(s0.body.email.from).includes("@"), "the house From is named");
    assertEquals(s0.body.line, { status: "none" });
    assertEquals(s0.body.payments.stripe.connected, false);
    assertEquals(s0.body.payments.square.connected, false);
    assertEquals(s0.body.esign, { provider: "documonster", on: true });
    assertEquals(s0.body.hr.systems, []);
    assertEquals(s0.body.hr.catalog.map((c: { key: string }) => c.key), ["dm-worker", "dm-admin", "dm-email", "dm-text"]);

    // a bought line shows as the account's
    const bought = await new LineStore().create({
      userId,
      subaccountSid: "ACsub912",
      number: "+18435550912",
      numberSid: "PN912",
      apiKeySid: "SK912",
      twimlAppSid: "AP912",
      authToken: "tok",
      apiKeySecret: "sec",
    });
    await call("POST", "/hr/systems", { key: "dm-worker" }, H);
    const s1 = await call("GET", "/me/systems", undefined, H);
    // REQ-920d: a customer line carries its texting registration — not registered until the form is in
    assertEquals(s1.body.line, { status: "active", number: "+18435550912", kind: "subaccount", a2p: "none" });
    assertEquals(s1.body.hr.systems.map((s: { key: string }) => s.key), ["dm-worker"]);
    assertEquals(s1.body.hr.catalog.map((c: { key: string }) => c.key), ["dm-admin", "dm-email", "dm-text"]);

    // REQ-920d: in review while the brand / campaign wait, registered once the campaign is VERIFIED, failed when one fails
    const now = new Date().toISOString();
    const reg = { lineId: bought.id, userId, subaccountSid: "ACsub912", form: {} as never, assigned: [], errors: [], createdAt: now, updatedAt: now };
    const a2p = new A2pStore();
    for (
      const [state, word] of [["brand_pending", "pending"], ["campaign_failed", "failed"], ["registered", "registered"]] as const
    ) {
      await a2p.save({ ...reg, state });
      assertEquals((await call("GET", "/me/systems", undefined, H)).body.line.a2p, word);
    }

    // REQ-920d: the house path (REQ-920b) moved the number to the main account under a VERIFIED campaign → registered (house)
    await new LineStore().markMain(bought.id, {
      apiKeySid: "SKmain912",
      apiKeySecret: "sec",
      twimlAppSid: "APmain912",
      messagingServiceSid: "MGhouse912",
      campaignUsecase: "MIXED",
    });
    assertEquals((await call("GET", "/me/systems", undefined, H)).body.line, {
      status: "active",
      number: "+18435550912",
      kind: "main",
      a2p: "house",
    });
  } finally {
    await server.stop();
    await resetKv();
  }
});
