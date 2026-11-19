/**
 * REQ-1003 (LOOP-007 q1, q1-88) — the new-hire email names the business, not DocuMonster.
 * POST /hr/hires (autoSend on) sends the signing link by email; the payload that reaches
 * EmailService must carry the business's name as the From display name, and the subject and
 * HTML must say which business is hiring. Today: From "DocuMonster" <hello@documonster.com>,
 * subject "You're almost MONSTERIZED 🦷 …", body "Welcome aboard, Jose!" with no company.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { HrModule } from "@hr/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import {
  EmailService,
  postmarkPayload,
  type SendEmailInput,
} from "@communication/domain/data/email-service/mod.ts";
import {
  HOUSE_FROM,
  senderAddress,
} from "@communication/domain/business/sender/mod.ts";
import { HrSystemStore } from "@hr/domain/data/hr-stores/mod.ts";

@Module({ imports: [HrModule] })
class TestApp {}
const PORT = 9953;
const J = { "content-type": "application/json" };
// deno-lint-ignore no-explicit-any
type Res = { status: number; body: any; text: string };
const BUSINESS = "Reyes Lawn & Landscape";

Deno.test(
  "REQ-1003 the new-hire invite email is From the business and names it in subject + body",
  async () => {
    Deno.env.set("KV_PATH", ":memory:");
    Deno.env.delete("POSTMARK_API_KEY");
    Deno.env.delete("TWILIO_ACCOUNT_SID");
    Deno.env.delete("DENO_DEPLOYMENT_ID");
    await resetKv();
    const sent: SendEmailInput[] = [];
    const orig = EmailService.prototype.send;
    EmailService.prototype.send = function (input: SendEmailInput) {
      sent.push(input);
      return orig.call(this, input);
    };
    const server = await bootstrapServer(TestApp, {
      port: PORT,
      swagger: false,
    });
    await server.listen();
    const call = async (
      method: string,
      path: string,
      body?: unknown,
      h = {},
    ): Promise<Res> => {
      const r = await fetch(`http://localhost:${PORT}${path}`, {
        method,
        headers: { ...J, ...h },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await r.text();
      try {
        return { status: r.status, body: JSON.parse(text), text };
      } catch {
        return { status: r.status, body: text, text };
      }
    };
    try {
      const phone = "+17025550142";
      await call("POST", "/auth/send-otp", { phoneNumber: phone });
      const otp = await new OtpStore().get(phone);
      const v = await call("POST", "/auth/verify-otp", {
        phoneNumber: phone,
        code: otp!.code,
      });
      const H = { "x-session-id": v.body.sessionId as string };
      await call("PUT", "/me", {
        name: "Maria Reyes",
        language: "en",
        email: "maria@example.com",
      }, H);
      await call("PUT", "/profile/identity", { businessName: BUSINESS }, H);
      const dept = await call("POST", "/hr/departments", {
        name: "Crew",
        division: "outbound",
      }, H);
      assertEquals(dept.status, 201, dept.text);
      // REQ-932 (q1-18): a hire needs a department with a document to sign
      const doc = await call("POST", "/hr/documents", {
        name: "Handbook",
        kind: "ack",
        contentHtml: "<p>Be kind.</p>",
      }, H);
      assertEquals(doc.status, 201, doc.text);
      const cfg = await call("PUT", `/hr/departments/${dept.body.id}`, {
        docIds: [doc.body.id],
      }, H);
      assertEquals(cfg.status, 200, cfg.text);

      sent.length = 0;
      const hire = await call("POST", "/hr/hires", {
        firstName: "Jose",
        lastName: "Diaz",
        email: "jose.diaz@example.com",
        departmentId: dept.body.id,
      }, H);
      assertEquals(hire.status, 201, hire.text);
      const mail = sent.find((s) => s.to === "jose.diaz@example.com");
      assert(mail, `the invite email went out: ${JSON.stringify(sent)}`);

      const wire = postmarkPayload(mail);
      const fromName = wire.From.match(/^"([^"]*)"/)?.[1] ?? wire.From;
      assertEquals(
        {
          fromName,
          subjectNamesBusiness: wire.Subject.includes(BUSINESS),
          htmlNamesBusiness: wire.HtmlBody.includes(
            "Reyes Lawn &amp; Landscape",
          ),
        },
        {
          fromName: BUSINESS,
          subjectNamesBusiness: true,
          htmlNamesBusiness: true,
        },
        `From=${wire.From} Subject=${wire.Subject}`,
      );
    } finally {
      EmailService.prototype.send = orig;
      await server.stop();
      await resetKv();
    }
  },
);

/**
 * REQ-1036 (LOOP-007 q2, q2-19) — AMENDMENT of REQ-1003: the SECOND new-hire email, the
 * provisioner's "Welcome email (Postmark)" arm (dm-email, REQ-913), is From the business too.
 * The hire signs their last document with dm-email attached to the department and autoProvision
 * on (the default) → Provisioner.sendWelcomeEmail. Today it calls EmailService.send with no
 * `from`, so postmarkPayload fills HOUSE_FROM "DocuMonster" <hello@documonster.com>: the invite
 * comes from the business and the welcome note from DocuMonster.
 */
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

Deno.test(
  "REQ-1036 (q2-19) the provisioner's welcome email (dm-email) is From the business, not DocuMonster, and the catalog card does not say 'from DocuMonster'",
  async () => {
    Deno.env.set("KV_PATH", ":memory:");
    Deno.env.delete("POSTMARK_API_KEY");
    Deno.env.delete("TWILIO_ACCOUNT_SID");
    Deno.env.delete("DENO_DEPLOYMENT_ID");
    await resetKv();
    const sent: SendEmailInput[] = [];
    const orig = EmailService.prototype.send;
    EmailService.prototype.send = function (input: SendEmailInput) {
      sent.push(input);
      return orig.call(this, input);
    };
    const port = PORT + 1;
    const server = await bootstrapServer(TestApp, { port, swagger: false });
    await server.listen();
    const call = async (
      method: string,
      path: string,
      body?: unknown,
      h = {},
    ): Promise<Res> => {
      const r = await fetch(`http://localhost:${port}${path}`, {
        method,
        headers: { ...J, ...h },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await r.text();
      try {
        return { status: r.status, body: JSON.parse(text), text };
      } catch {
        return { status: r.status, body: text, text };
      }
    };
    try {
      const phone = "+17025550143";
      await call("POST", "/auth/send-otp", { phoneNumber: phone });
      const otp = await new OtpStore().get(phone);
      const v = await call("POST", "/auth/verify-otp", {
        phoneNumber: phone,
        code: otp!.code,
      });
      const H = { "x-session-id": v.body.sessionId as string };
      await call("PUT", "/me", {
        name: "Maria Reyes",
        language: "en",
        email: "maria@example.com",
      }, H);
      await call("PUT", "/profile/identity", { businessName: BUSINESS }, H);

      // the Settings › Systems catalog card for this arm (GET /me/systems → hr.catalog)
      const sys = await call("GET", "/me/systems", undefined, H);
      assertEquals(sys.status, 200, sys.text);
      const card = (sys.body.hr.catalog as { key: string; desc: string }[])
        .find((c) => c.key === "dm-email");
      assert(card, `dm-email is in the catalog: ${sys.text}`);

      const settings = await call("GET", "/hr/settings", undefined, H);
      assertEquals(settings.body.autoProvision, true, settings.text);
      const emailSys = await call(
        "POST",
        "/hr/systems",
        { key: "dm-email" },
        H,
      );
      assertEquals(emailSys.status, 201, emailSys.text);
      const dept = await call("POST", "/hr/departments", {
        name: "Crew",
        division: "outbound",
      }, H);
      assertEquals(dept.status, 201, dept.text);
      const doc = await call("POST", "/hr/documents", {
        name: "Handbook",
        kind: "ack",
        contentHtml: "<p>Be kind.</p>",
      }, H);
      assertEquals(doc.status, 201, doc.text);
      const cfg = await call("PUT", `/hr/departments/${dept.body.id}`, {
        docIds: [doc.body.id],
        systemIds: [emailSys.body.id],
      }, H);
      assertEquals(cfg.status, 200, cfg.text);
      const hire = await call("POST", "/hr/hires", {
        firstName: "Jose",
        lastName: "Diaz",
        email: "jose.diaz@example.com",
        departmentId: dept.body.id,
      }, H);
      assertEquals(hire.status, 201, hire.text);

      sent.length = 0;
      const signed = await call(
        "POST",
        `/hr/sign/${hire.body.token}/docs/${doc.body.id}`,
        { printedName: "Jose Diaz", consent: true, signaturePng: PNG },
      );
      assertEquals(signed.status, 201, signed.text);
      assertEquals(signed.body.complete, true, signed.text);
      const after = await call(
        "GET",
        `/hr/hires/${hire.body.id}`,
        undefined,
        H,
      );
      const arm = (after.body.provisioning ?? []).find((
        a: { name: string },
      ) => a.name === "Welcome email (Postmark)");
      assertEquals(arm?.state, "ok", `the welcome arm ran: ${after.text}`);
      const mail = sent.find((s) => s.to === "jose.diaz@example.com");
      assert(mail, `the welcome email went out: ${JSON.stringify(sent)}`);

      const wire = postmarkPayload(mail);
      const fromName = wire.From.match(/^"([^"]*)"/)?.[1] ?? wire.From;
      assertEquals(
        {
          fromName,
          // the house inbox, not the domain: the business's alias lives on documonster.com
          // by design (REQ-123 — every From is on SEND_DOMAIN), e.g. <reyes-…@documonster.com>
          fromIsHouse: senderAddress(wire.From) === senderAddress(HOUSE_FROM),
          cardSaysFromDocuMonster: /documonster/i.test(card.desc),
        },
        {
          fromName: BUSINESS,
          fromIsHouse: false,
          cardSaysFromDocuMonster: false,
        },
        `welcome From=${wire.From} · catalog desc=${JSON.stringify(card.desc)}`,
      );
    } finally {
      EmailService.prototype.send = orig;
      await server.stop();
      await resetKv();
    }
  },
);

Deno.test(
  "REQ-1036 (q2-19) a dm-email system attached before the copy changed reads with today's catalog desc; an owner-written desc is kept",
  async () => {
    Deno.env.set("KV_PATH", ":memory:");
    await resetKv();
    try {
      const store = new HrSystemStore();
      const now = new Date().toISOString();
      const base = {
        userId: "u-1036",
        name: "Welcome email (Postmark)",
        kind: "email",
        status: "connected",
        webhookUrl: null,
        createdAt: now,
        updatedAt: now,
      } as const;
      await store.put({
        ...base,
        id: "old",
        key: "dm-email",
        desc: "A welcome note with the handbook portal's login, from DocuMonster",
      });
      await store.put({ ...base, id: "mine", key: "dm-email", desc: "Our note" });
      const list = await store.listByUser("u-1036");
      const byId = Object.fromEntries(list.map((s) => [s.id, s.desc]));
      assertEquals(
        {
          listed: byId,
          got: (await store.get("old")).desc,
          found: (await store.find("old"))?.desc,
        },
        {
          listed: {
            old: "A welcome note with the handbook portal's login, from your business",
            mine: "Our note",
          },
          got: "A welcome note with the handbook portal's login, from your business",
          found: "A welcome note with the handbook portal's login, from your business",
        },
      );
    } finally {
      await resetKv();
    }
  },
);
