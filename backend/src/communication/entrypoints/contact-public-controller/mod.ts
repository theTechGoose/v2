import { Body, Context, Controller, Post } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { IsEmail, IsString, MaxLength, MinLength, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";
import { EmailService } from "@communication/domain/data/email-service/mod.ts";
import { RateLimiter } from "@core/data/rate-limit/mod.ts";

const MAX_PER_WINDOW = 5;
const WINDOW_MS = 60 * 60 * 1000;

class ContactDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsEmail() email!: string;
  @IsString() @MinLength(1) @MaxLength(200) subject!: string;
  @IsString() @MinLength(1) @MaxLength(5000) message!: string;
}

function parseContact(input: unknown): ContactDto {
  const dto = plainToInstance(ContactDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid contact: ${JSON.stringify(errors)}`);
  return dto;
}

/**
 * POST /contact — public, unauthenticated landing-page contact form.
 *
 * Rate-limited per email at 5 submissions per hour. The destination
 * inbox falls back to POSTMARK_FROM (i.e. the contractor's own
 * verified sender), so no extra config is required.
 *
 * Returns `{ ok: false, reason: "too_many_attempts" }` instead of HTTP
 * 429 to match the convention used by other public endpoints in this
 * codebase (TaxIdentityPublicController). The proxy layer maps `ok:false`
 * to the appropriate status if it cares.
 */
@Controller("contact")
export class ContactPublicController {
  constructor(
    private email: EmailService,
    private rateLimiter: RateLimiter,
  ) {}

  @Post()
  async submit(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const dto = parseContact(body);
    const decision = await this.rateLimiter.take(
      "contact-form",
      dto.email.toLowerCase(),
      MAX_PER_WINDOW,
      WINDOW_MS,
    );
    if (!decision.allowed) {
      return ctx.json({ ok: false, reason: "too_many_attempts", retryAfterMs: decision.resetMs });
    }

    const subject = `[contact] ${dto.subject}`;
    const htmlBody = renderContactHtml(dto);
    const recipient = Deno.env.get("CONTACT_INBOX") ?? Deno.env.get("POSTMARK_FROM");
    if (!recipient) {
      return ctx.json({ ok: false, reason: "no_destination_configured" });
    }

    const result = await this.email.send({ to: recipient, subject, htmlBody });
    return ctx.json({ ok: result.ok, reason: result.reason });
  }
}

function renderContactHtml(c: ContactDto): string {
  return `
<h2>New contact-form submission</h2>
<p><strong>From:</strong> ${escapeHtml(c.name)} &lt;${escapeHtml(c.email)}&gt;</p>
<p><strong>Subject:</strong> ${escapeHtml(c.subject)}</p>
<hr/>
<pre style="white-space: pre-wrap; font-family: inherit;">${escapeHtml(c.message)}</pre>
`.trim();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default:  return "&#39;";
    }
  });
}
