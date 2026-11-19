/**
 * REQ-1157 (LOOP-007 q3, q3-89) — the HR signing link carries the owner's language. An English
 * owner adds a hire (autoSend on, the default): the text and the email are English, and the link
 * in both — and the hire file's signUrl (the owner's Copy/Open link + the SMS preview) — must end
 * `?lang=en`, so /sign/:token opens in English whatever the phone's pm_lang cookie says (and not
 * the route's Spanish fallback on a fresh phone). Today all three are a bare `/sign/<token>`.
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
  type SendEmailInput,
} from "@communication/domain/data/email-service/mod.ts";
import { type SendSmsInput, SmsService } from "@users/domain/data/sms/mod.ts";

@Module({ imports: [HrModule] })
class TestApp {}
const PORT = 9971;
const J = { "content-type": "application/json" };
// deno-lint-ignore no-explicit-any
type Res = { status: number; body: any; text: string };

for (const lang of ["en", "es"] as const) {
  Deno.test(
    `REQ-1157 (q3-89) a '${lang}' owner's new hire: the text, the email and GET /hr/hires/:id signUrl all link /sign/<token>?lang=${lang}`,
    async () => {
      Deno.env.set("KV_PATH", ":memory:");
      Deno.env.delete("POSTMARK_API_KEY");
      Deno.env.delete("TWILIO_ACCOUNT_SID");
      Deno.env.delete("DENO_DEPLOYMENT_ID");
      await resetKv();
      const mails: SendEmailInput[] = [];
      const texts: SendSmsInput[] = [];
      const origMail = EmailService.prototype.send;
      const origSms = SmsService.prototype.send;
      EmailService.prototype.send = function (input: SendEmailInput) {
        mails.push(input);
        return origMail.call(this, input);
      };
      SmsService.prototype.send = function (input: SendSmsInput) {
        texts.push(input);
        return origSms.call(this, input);
      };
      const port = PORT + (lang === "en" ? 0 : 1);
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
        const phone = lang === "en" ? "+17025550171" : "+17025550172";
        await call("POST", "/auth/send-otp", { phoneNumber: phone });
        const otp = await new OtpStore().get(phone);
        const v = await call("POST", "/auth/verify-otp", {
          phoneNumber: phone,
          code: otp!.code,
        });
        const H = { "x-session-id": v.body.sessionId as string };
        await call("PUT", "/me", {
          name: "Maria Reyes",
          language: lang,
          email: "maria@example.com",
        }, H);
        await call("PUT", "/profile/identity", {
          businessName: "Reyes Lawn & Pool",
        }, H);
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
        }, H);
        assertEquals(cfg.status, 200, cfg.text);

        mails.length = 0;
        texts.length = 0;
        const hire = await call("POST", "/hr/hires", {
          firstName: "Rosa",
          lastName: "Diaz",
          phone: "+17025550142",
          email: "rosa@example.com",
          departmentId: dept.body.id,
        }, H);
        assertEquals(hire.status, 201, hire.text);
        const token = hire.body.token as string;
        assert(token, hire.text);
        const sms = texts.find((s) => s.to === "+17025550142");
        const mail = mails.find((m) => m.to === "rosa@example.com");
        assert(sms, `the invite text went out: ${JSON.stringify(texts)}`);
        assert(mail, `the invite email went out: ${JSON.stringify(mails)}`);
        const detail = await call(
          "GET",
          `/hr/hires/${hire.body.id}`,
          undefined,
          H,
        );
        assertEquals(detail.status, 200, detail.text);

        const want = `/sign/${token}?lang=${lang}`;
        const linkIn = (s: string) =>
          s.match(/https?:\/\/[^\s"<]+\/sign\/[^\s"<]+/)?.[0] ?? null;
        assertEquals(
          {
            sms: linkIn(sms.body)?.endsWith(want) ?? false,
            emailHref: (mail.htmlBody ?? "").includes(`${want}"`),
            signUrl: String(detail.body.signUrl).endsWith(want),
          },
          { sms: true, emailHref: true, signUrl: true },
          `sms link=${linkIn(sms.body)} · email link=${
            linkIn(mail.htmlBody ?? "")
          } · signUrl=${detail.body.signUrl}`,
        );
      } finally {
        EmailService.prototype.send = origMail;
        SmsService.prototype.send = origSms;
        await server.stop();
        await resetKv();
      }
    },
  );
}
