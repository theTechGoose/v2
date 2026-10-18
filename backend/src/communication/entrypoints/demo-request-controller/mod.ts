import { Body, Context, Controller, Post } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { EmailService } from "@communication/domain/data/email-service/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { CrmLeadCapture } from "@users/domain/coordinators/crm-lead-capture/mod.ts";
import { RateLimiter } from "@core/data/rate-limit/mod.ts";
import { teamInbox } from "@communication/domain/business/team-inbox/mod.ts";
import {
  demoConfirmationSms,
  DemoRequestInvalid,
  demoTeamEmail,
  parseDemoRequest,
} from "@communication/domain/business/demo-request/mod.ts";

const MAX_PER_WINDOW = 5;
const WINDOW_MS = 60 * 60 * 1000;

/**
 * REQ-081 — POST /demo-request: the demo booking on /landing2, public and unauthenticated.
 *
 * A booking is three things at once, in this order: the team's inbox gets it (the same inbox
 * the contact form reaches), the person gets the text the page promised ("Te confirmamos por
 * texto"), and the phone is a CRM lead the way a code request is (REQ-060/072: the outbox
 * carries it, never this request). The reply says what was done — `emailed`, `texted`, `lead` —
 * so a text that could not go out (a landline, an opted-out number) still leaves the booking
 * with the team and the page can say so.
 *
 * Rate-limited per phone at 5 an hour; a malformed body answers `{ ok:false, reason:"invalid",
 * field }` in the 200 envelope the other public forms use (ContactPublicController).
 */
@Controller("demo-request")
export class DemoRequestController {
  constructor(
    private email: EmailService,
    private sms: SmsService,
    private leads: CrmLeadCapture,
    private rateLimiter: RateLimiter,
  ) {}

  @Post()
  async submit(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    let req;
    try {
      req = parseDemoRequest(body);
    } catch (e) {
      if (e instanceof DemoRequestInvalid) {
        return ctx.json({ ok: false, reason: "invalid", field: e.field });
      }
      throw e;
    }
    const decision = await this.rateLimiter.take(
      "demo-request",
      req.phone,
      MAX_PER_WINDOW,
      WINDOW_MS,
    );
    if (!decision.allowed) {
      return ctx.json({
        ok: false,
        reason: "too_many_attempts",
        retryAfterMs: decision.resetMs,
      });
    }

    const mail = demoTeamEmail(req);
    const emailed = await this.email.send({
      to: teamInbox(),
      subject: mail.subject,
      htmlBody: mail.htmlBody,
    });
    const texted = await this.sms.send({
      to: req.phone,
      body: demoConfirmationSms(req),
    });
    await this.leads.enqueue(req.phone);

    return ctx.json({
      ok: true,
      mode: req.mode,
      day: req.day,
      slot: req.slot,
      emailed: emailed.ok,
      texted: texted.ok,
      lead: true,
    });
  }
}
