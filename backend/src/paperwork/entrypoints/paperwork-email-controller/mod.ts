import { Context, Controller, Param, Post } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { IsOptional, IsString, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";
import { SendPaperworkEmail } from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
import { SendPaperworkSms } from "@paperwork/domain/coordinators/send-paperwork-sms/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";

class EmailDispatchDto {
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsString() from?: string;
}

class SmsDispatchDto {
  @IsOptional() @IsString() to?: string;
}

function parseEmailDispatch(input: unknown): EmailDispatchDto {
  const dto = plainToInstance(EmailDispatchDto, input ?? {});
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid dispatch: ${JSON.stringify(errors)}`);
  return dto;
}

function parseSmsDispatch(input: unknown): SmsDispatchDto {
  const dto = plainToInstance(SmsDispatchDto, input ?? {});
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid dispatch: ${JSON.stringify(errors)}`);
  return dto;
}

/**
 * Read the JSON body tolerantly. These dispatch routes take an OPTIONAL body
 * ({to?, from?}); the common "just send it to the customer on file" call is a
 * bodyless POST, which must NOT 500 on an empty-body JSON parse. Using @Body
 * here threw "Unexpected end of JSON input" for every bodyless send, which the
 * callers silently swallowed — so invoices flipped to "sent" but never went
 * out. Read from the raw request and fall back to {} on empty/invalid.
 */
async function readDispatchBody(ctx: ExecutionContext): Promise<unknown> {
  try {
    return await ctx.req.raw.json();
  } catch {
    return {};
  }
}

/**
 * PaperworkEmailController — three thin POST wrappers around
 * SendPaperworkEmail. Each renders + dispatches the corresponding
 * resource. Body is optional; if omitted the recipient is resolved from
 * the linked customer's email.
 *
 *   POST /quotes/:id/email      { to?, from? }
 *   POST /contracts/:id/email   { to?, from? }
 *   POST /invoices/:id/email    { to?, from? }
 *
 * Note: routes are mounted under their resource prefix so they sit
 * naturally next to the existing CRUD endpoints; the controller is the
 * single dispatch surface.
 */
@Controller()
export class PaperworkEmailController {
  constructor(
    private flow: SendPaperworkEmail,
    private smsFlow: SendPaperworkSms,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  @Post("quotes/:id/email")
  async emailQuote(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const dto = parseEmailDispatch(await readDispatchBody(ctx));
    return await this.flow.run(user.id, { kind: "quote", resourceId: id, to: dto.to, from: dto.from });
  }

  @Post("contracts/:id/email")
  async emailContract(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const dto = parseEmailDispatch(await readDispatchBody(ctx));
    return await this.flow.run(user.id, { kind: "contract", resourceId: id, to: dto.to, from: dto.from });
  }

  @Post("invoices/:id/email")
  async emailInvoice(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const dto = parseEmailDispatch(await readDispatchBody(ctx));
    return await this.flow.run(user.id, { kind: "invoice", resourceId: id, to: dto.to, from: dto.from });
  }

  // ---- SMS dispatch -------------------------------------------------------
  // Thin wrappers around SendPaperworkSms, mirroring the email routes above.
  // Default recipient is the linked customer's phoneNumber; body builds a
  // short link through ShortLinkStore.

  @Post("quotes/:id/text")
  async textQuote(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const dto = parseSmsDispatch(await readDispatchBody(ctx));
    return await this.smsFlow.run(user.id, { kind: "quote", resourceId: id, to: dto.to });
  }

  @Post("contracts/:id/text")
  async textContract(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const dto = parseSmsDispatch(await readDispatchBody(ctx));
    return await this.smsFlow.run(user.id, { kind: "contract", resourceId: id, to: dto.to });
  }

  @Post("invoices/:id/text")
  async textInvoice(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const dto = parseSmsDispatch(await readDispatchBody(ctx));
    return await this.smsFlow.run(user.id, { kind: "invoice", resourceId: id, to: dto.to });
  }
}
