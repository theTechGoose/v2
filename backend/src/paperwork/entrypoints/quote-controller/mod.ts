import {
  Body,
  Context,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { parseCreateQuote, parseUpdateQuote } from "@paperwork/dto/quote.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";
import { requestIdOf } from "@core/business/request-id/mod.ts";
import {
  QUOTE_CONTENT_FIELDS,
  quoteEditDecision,
  splitPatch,
} from "#documents/versions.ts";

@Controller("quotes")
export class QuoteController {
  constructor(
    private store: QuoteStore,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  @Post()
  async create(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const requestId = requestIdOf(ctx, body); // REQ-200
    const dto = parseCreateQuote(body);
    // NW-10 (REQ-003): a quote is born a draft. "sent"/"viewed" describe a
    // dispatch that has not happened at creation time, so the API refuses to
    // record them here — the send coordinators stamp status + sentAt.
    if (dto.status === "sent" || dto.status === "viewed") dto.status = "draft";
    // UX-29: derive a missing jobName in the owner's language.
    return await this.store.create(user.id, dto, {
      jobNameLang: user.language === "es" ? "es" : "en",
      requestId,
    });
  }

  @Get(":id")
  async get(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.store.getOwned(id, user.id);
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
    await this.store.delete(id, user.id);
    return { ok: true };
  }
}
