import { Context, Controller, Get, Param, Query } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { BuildQuoteCards } from "@analytics/domain/coordinators/build-quote-cards/mod.ts";
import { ComputeQuoteWinRate } from "@analytics/domain/coordinators/compute-quote-win-rate/mod.ts";
import { ComputeQuoteInsight } from "@analytics/domain/coordinators/compute-quote-insight/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { ViewStore } from "@paperwork/domain/data/view-store/mod.ts";
import type { QuoteOpenEntry, QuoteOpensResponse } from "@paperwork/dto/quote.ts";
import type { InsightResponse, WinRateResponse } from "@analytics/dto/quotes-stats.ts";
import { deviceFromUa } from "@paperwork/domain/business/device-from-ua/mod.ts";
import { relativeTime } from "@core/business/relative-time/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";

/**
 * QuotesController — page-aligned read controller for the /quotes UI.
 *
 *   GET /quotes[?status=]               → QuoteCard[] with derived stage
 *   GET /quotes/:id/opens               → engagement timeline for the card flip
 *
 * Lives in CoreModule because BuildQuoteCards needs to fan across
 * Paperwork + CRM stores (avoids the crm → core / paperwork → core cycle).
 *
 * The existing PaperworkModule QuoteController still owns POST/PUT/DELETE
 * /quotes and GET /quotes/:id (raw). This controller is the read-side
 * companion for analytics-shaped views.
 */
@Controller()
export class QuotesController {
  constructor(
    private flow:     BuildQuoteCards,
    private winRate:  ComputeQuoteWinRate,
    private insight:  ComputeQuoteInsight,
    private quotes:   QuoteStore,
    private views:    ViewStore,
    private users:    UserStore,
    private sessions: SessionStore,
  ) {}

  @Get("quotes")
  async list(@Context() ctx: ExecutionContext, @Query("status") status?: string) {
    const user  = await requireUser(ctx, this.sessions, this.users);
    const cards = await this.flow.run(user.id);
    return status ? cards.filter((c) => c.status === status) : cards;
  }

  @Get("quotes/:id/opens")
  async opens(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
  ): Promise<QuoteOpensResponse> {
    const user = await requireUser(ctx, this.sessions, this.users);
    // getOwned throws ForbiddenError if the caller doesn't own the quote
    await this.quotes.getOwned(id, user.id);
    const views = await this.views.listByPaperwork("quote", id);
    const now = new Date();
    const sorted = [...views].sort((a, b) => a.viewedAt.localeCompare(b.viewedAt));
    const opens: QuoteOpenEntry[] = sorted.map((v) => ({
      at:     v.viewedAt,
      atRel:  relativeTime(v.viewedAt, now),
      device: deviceFromUa(v.userAgent ?? ""),
      ...(typeof v.durationMs === "number" ? { durationMs: v.durationMs } : {}),
    }));
    return { opens };
  }

  @Get("analytics/quotes/win-rate")
  async winRateRoute(
    @Context() ctx: ExecutionContext,
    @Query("days") days?: string,
  ): Promise<WinRateResponse> {
    const user   = await requireUser(ctx, this.sessions, this.users);
    const window = Math.max(1, Math.min(3650, Number(days ?? "90") || 90));
    return await this.winRate.run(user.id, window);
  }

  @Get("analytics/quotes/insight")
  async insightRoute(@Context() ctx: ExecutionContext): Promise<InsightResponse> {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.insight.run(user.id);
  }
}
