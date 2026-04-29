import { Body, Context, Controller, Post } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { IsOptional, IsString, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";
import { EmailService } from "@communication/domain/data/email-service/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";

class SendEmailDto {
  @IsString() to!: string;
  @IsString() subject!: string;
  @IsString() htmlBody!: string;
  @IsOptional() @IsString() from?: string;
}

function parseSendEmail(input: unknown): SendEmailDto {
  const dto = plainToInstance(SendEmailDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid email: ${JSON.stringify(errors)}`);
  return dto;
}

/**
 * POST /email/send — generic email dispatch.
 *
 * Auth-gated; the contractor (the user) is the implicit sender. The
 * resource-specific wrappers (POST /quotes/:id/email etc.) can call this
 * after rendering their own HTML body, OR call EmailService directly.
 *
 * For v1 this is the single seam between the app and the SMTP provider.
 */
@Controller("email")
export class EmailController {
  constructor(
    private email: EmailService,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  @Post("send")
  async send(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    await requireUser(ctx, this.sessions, this.users);
    const dto = parseSendEmail(body);
    return await this.email.send({ to: dto.to, subject: dto.subject, htmlBody: dto.htmlBody, from: dto.from });
  }
}
