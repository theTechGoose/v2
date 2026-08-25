import { Context, Controller, Param, Post } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { IsOptional, IsString, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";
import {
  SENDER_NAME_REQUIRED_REASON,
  SendPaperworkEmail,
} from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
import { SendPaperworkSms } from "@paperwork/domain/coordinators/send-paperwork-sms/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";
import { outboundSenderName } from "#quote-flow/outbound-identity.ts";

class EmailDispatchDto {
  @IsOptional() @IsString()
  to?: string;
  @IsOptional() @IsString()
  from?: string;
}

class SmsDispatchDto {
  @IsOptional() @IsString()
  to?: string;
}

function parseEmailDispatch(input: unknown): EmailDispatchDto {
  const dto = plainToInstance(EmailDispatchDto, input ?? {});
  const errors = validateSync(dto);
  if (errors.length) {
    throw new Error(`invalid dispatch: ${JSON.stringify(errors)}`);
  }
  return dto;
}

function parseSmsDispatch(input: unknown): SmsDispatchDto {
  const dto = plainToInstance(SmsDispatchDto, input ?? {});
  const errors = validateSync(dto);
  if (errors.length) {
    throw new Error(`invalid dispatch: ${JSON.stringify(errors)}`);
  }
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
 * P-06 — a skip-setup account (placeholder name "Nuevo usuario"/"New user",
 * no business identity) must never introduce itself to a customer. The SMS
 * coordinator opens with the sender's first name ("Hi …, this is Nuevo."),
 * so the text routes refuse HERE with the machine-readable needs-name signal
 * before any dispatch or comms-log write. (The email coordinator carries its
 * own guard; module-level helper — Danet chokes on undecorated controller
 * methods.)
 */
async function smsSenderRefusal(
  identity: BusinessIdentityStore,
  user: { name?: string },
  userId: string,
): Promise<
  { ok: false; reason: string; needsName: true; to: string } | undefined
> {
  let biz: { businessName?: string; legalName?: string } | undefined;
  try {
    biz = (await identity.get(userId)) ?? undefined;
  } catch { /* no identity record yet */ }
  const name = outboundSenderName({
    userName: user.name,
    businessName: biz?.businessName ?? biz?.legalName,
  });
  if (name) return undefined;
  return {
    ok: false,
    reason: SENDER_NAME_REQUIRED_REASON,
    needsName: true,
    to: "",
  };
}

/**
 * PaperworkEmailController — thin POST wrappers around
 * SendPaperworkEmail. Each renders + dispatches the corresponding
 * resource. Body is optional; if omitted the recipient is resolved from
 * the linked customer's email.
 *
 *   POST /quotes/:id/email      { to?, from? }
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
    private identity: BusinessIdentityStore,
  ) {}

  @Post("quotes/:id/email")
  async emailQuote(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const dto = parseEmailDispatch(await readDispatchBody(ctx));
    return await this.flow.run(user.id, {
      kind: "quote",
      resourceId: id,
      to: dto.to,
      from: dto.from,
    });
  }

  @Post("invoices/:id/email")
  async emailInvoice(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const dto = parseEmailDispatch(await readDispatchBody(ctx));
    return await this.flow.run(user.id, {
      kind: "invoice",
      resourceId: id,
      to: dto.to,
      from: dto.from,
    });
  }

  // ---- SMS dispatch -------------------------------------------------------
  // Thin wrappers around SendPaperworkSms, mirroring the email routes above.
  // Default recipient is the linked customer's phoneNumber; body builds a
  // short link through ShortLinkStore.

  @Post("quotes/:id/text")
  async textQuote(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const refusal = await smsSenderRefusal(this.identity, user, user.id);
    if (refusal) return refusal;
    const dto = parseSmsDispatch(await readDispatchBody(ctx));
    return await this.smsFlow.run(user.id, {
      kind: "quote",
      resourceId: id,
      to: dto.to,
    });
  }

  @Post("invoices/:id/text")
  async textInvoice(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const refusal = await smsSenderRefusal(this.identity, user, user.id);
    if (refusal) return refusal;
    const dto = parseSmsDispatch(await readDispatchBody(ctx));
    return await this.smsFlow.run(user.id, {
      kind: "invoice",
      resourceId: id,
      to: dto.to,
    });
  }
}
