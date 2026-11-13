import { Body, Context, Controller, Get, Param, Post } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { IsIn, IsString, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { QuoteInquiryStore } from "@paperwork/domain/data/inquiry-store/mod.ts";
import { ReplyToInquiry } from "@paperwork/domain/coordinators/reply-to-inquiry/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";

class ReplyToInquiryDto {
  @IsIn(["text", "email"])
  channel!: "text" | "email";
  @IsString()
  message!: string;
}

/** The reply body, or undefined when it is not one (the route answers 400). */
function parseReply(input: unknown): ReplyToInquiryDto | undefined {
  const dto = plainToInstance(ReplyToInquiryDto, input ?? {});
  return validateSync(dto).length ? undefined : dto;
}

/**
 * InquiryController — REQ-701 (demo-loop cycle 5, issue M21): the questions
 * clients send from the public quote page, for the quote's owner.
 *
 *   GET  quotes/:id/inquiries                    → the quote's questions, newest first
 *   POST quotes/:id/inquiries/:inquiryId/reply   { channel: "text"|"email", message }
 *                                                → ReplyToInquiry's result
 *
 * Another account's quote is a 403, a deleted or unknown one a 404 (the
 * quote store's own errors); the public page has no route here.
 */
@Controller()
export class InquiryController {
  constructor(
    private quotes: QuoteStore,
    private inquiries: QuoteInquiryStore,
    private reply: ReplyToInquiry,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  @Get("quotes/:id/inquiries")
  async list(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const quote = await this.quotes.getOwned(id, user.id);
    return await this.inquiries.listByQuote(quote.id);
  }

  @Post("quotes/:id/inquiries/:inquiryId/reply")
  async answer(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Param("inquiryId") inquiryId: string,
    @Body() body: unknown,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const dto = parseReply(body);
    if (!dto) return ctx.json({ ok: false, reason: "invalid_reply" }, 400);
    return await this.reply.run(user.id, {
      quoteId: id,
      inquiryId,
      channel: dto.channel,
      message: dto.message,
    });
  }
}
