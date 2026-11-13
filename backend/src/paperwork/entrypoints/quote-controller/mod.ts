import {
  Body,
  Context,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { quoteDeleteBlock } from "@paperwork/domain/business/quote-delete-guard/mod.ts";
import { parseCreateQuote, parseUpdateQuote } from "@paperwork/dto/quote.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";
import { requestIdOf } from "@core/business/request-id/mod.ts";
import { PreviewQuoteSend } from "@paperwork/domain/coordinators/preview-quote-send/mod.ts";
import { QuoteAllowance } from "@paperwork/domain/coordinators/quote-allowance/mod.ts";
import { parseSendPreviewQuery } from "#quote-flow/send-preview.ts";
import {
  QUOTE_CONTENT_FIELDS,
  quoteEditDecision,
  splitPatch,
} from "#documents/versions.ts";

@Controller("quotes")
export class QuoteController {
  constructor(
    private store: QuoteStore,
    private invoices: InvoiceStore,
    private users: UserStore,
    private sessions: SessionStore,
    private sendPreview: PreviewQuoteSend,
    private allowance: QuoteAllowance,
  ) {}

  @Post()
  async create(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const requestId = requestIdOf(ctx, body); // REQ-200
    const dto = parseCreateQuote(body);
    // REQ-766 (cycle 5v2, m17): Monster Free's "Up to five quotes and
    // contracts a month" — the sixth this month is refused, nothing stored.
    // (The onboarding sample, REQ-241, neither counts nor is capped.)
    if (dto.isSample !== true) {
      const allowed = await this.allowance.check(user.id);
      if (!allowed.ok) return ctx.json(allowed, 402);
    }
    // NW-10 (REQ-003): a quote is born a draft. "sent"/"viewed" describe a
    // dispatch that has not happened at creation time, so the API refuses to
    // record them here — the send coordinators stamp status + sentAt.
    if (dto.status === "sent" || dto.status === "viewed") dto.status = "draft";
    // REQ-572: "shared by link" is the owner's mark on an existing quote
    // (PUT), never something a new draft is born with.
    delete (dto as { sentVia?: unknown }).sentVia;
    // UX-29: derive a missing jobName in the owner's language.
    return await this.store.create(user.id, dto, {
      jobNameLang: user.language === "es" ? "es" : "en",
      requestId,
    });
  }

  /**
   * REQ-778 (demo-loop cycle dv1, issue d8): may this account make another
   * quote this month? The same QuoteAllowance answer POST /quotes gives, so
   * /quotes can say "your five quotes are used" before New quote is tapped.
   * (Declared before `:id` so "allowance" is never read as a quote id.)
   */
  @Get("allowance")
  async allowanceOf(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.allowance.check(user.id);
  }

  @Get(":id")
  async get(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.store.getOwned(id, user.id);
  }

  /**
   * REQ-461 (demo-loop cycle 3, m8): GET /quotes/:id/send-preview?channel&lang
   * — the email subject + body and the text the client gets if the quote is
   * sent now, in the picked language. Sends nothing.
   */
  @Get(":id/send-preview")
  async preview(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Query("channel") channel?: string,
    @Query("lang") lang?: string,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.sendPreview.run(user.id, {
      quoteId: id,
      ...parseSendPreviewQuery({ channel, lang }),
    });
  }

  /**
   * REQ-201/202: a draft edits live. Once the quote is issued, a content
   * edit waits as a pending revision until POST /quotes/:id/publish (the
   * customer's link keeps showing the published version). A signed quote
   * refuses content edits (409 `locked_signed`): scope changes go through
   * change orders. Bookkeeping fields (status, sentAt, …) always apply.
   */
  @Put(":id")
  async update(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const patch = parseUpdateQuote(body);
    const existing = await this.store.getOwned(id, user.id);
    // REQ-572 (demo-loop cycle 4, p4-p7c): "Mark as sent" after Copy link is
    // {status:"sent", sentVia:"link"} — the owner says they shared it. The
    // mark only rides a send (or an already-sent quote), never a draft.
    if (
      patch.sentVia && patch.status !== "sent" && existing.status !== "sent"
    ) {
      return ctx.json({ ok: false, reason: "sent_via_needs_sent" }, 400);
    }
    const decision = quoteEditDecision(
      existing,
      patch as unknown as Record<string, unknown>,
    );
    if (decision.mode === "locked") {
      return ctx.json({
        ok: false,
        reason: decision.reason,
        fields: decision.fields,
      }, 409);
    }
    const { content, meta } = splitPatch(
      patch as unknown as Record<string, unknown>,
      QUOTE_CONTENT_FIELDS,
    );
    // first send: stamp sentAt alongside the status flip (the send coordinators do the same)
    if (meta.status === "sent" && !existing.sentAt && !meta.sentAt) {
      meta.sentAt = new Date().toISOString();
    }
    if (decision.mode === "pending") {
      if (Object.keys(meta).length) await this.store.update(id, user.id, meta);
      return await this.store.setPending(id, user.id, content);
    }
    return await this.store.update(id, user.id, { ...content, ...meta });
  }

  @Delete(":id")
  async delete(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const quote = await this.store.getOwned(id, user.id);
    // REQ-485 (m22): a signed or billed quote is part of the record — it stays.
    const billed = (await this.invoices.listByUser(user.id))
      .filter((i) => i.quoteId === id);
    const reason = quoteDeleteBlock(quote, billed);
    if (reason) return ctx.json({ ok: false, reason }, 409);
    await this.store.delete(id, user.id);
    return { ok: true };
  }
}
