import { Body, Context, Controller, Delete, Get, Param, Post, Query } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { StartConversation } from "@agents/domain/coordinators/start-conversation/mod.ts";
import { LoadConversation } from "@agents/domain/coordinators/load-conversation/mod.ts";
import { TransitionToTerms } from "@agents/domain/coordinators/transition-to-terms/mod.ts";
import { LockQuote } from "@agents/domain/coordinators/lock-quote/mod.ts";
import { AcceptContract } from "@agents/domain/coordinators/accept-contract/mod.ts";
import { SendContract } from "@agents/domain/coordinators/send-contract/mod.ts";
import { SendInvoice } from "@agents/domain/coordinators/send-invoice/mod.ts";
import { StartOnboardingConversation } from "@agents/domain/coordinators/start-onboarding-conversation/mod.ts";
import { BindConversationCustomer } from "@agents/domain/coordinators/bind-conversation-customer/mod.ts";
import { EnsureSampleQuote } from "@agents/domain/coordinators/ensure-sample-quote/mod.ts";
import { parseCreateAgentConversation } from "@agents/dto/conversation.ts";
import { shouldTransitionToTerms } from "@agents/domain/business/derive-phase/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";

@Controller("agents/conversations")
export class ConversationsController {
  constructor(
    private store: AgentConversationStore,
    private startFlow: StartConversation,
    private loadFlow: LoadConversation,
    private transitionFlow: TransitionToTerms,
    private lockFlow: LockQuote,
    private acceptFlow: AcceptContract,
    private sendContractFlow: SendContract,
    private sendInvoiceFlow: SendInvoice,
    private onboardingFlow: StartOnboardingConversation,
    private bindCustomerFlow: BindConversationCustomer,
    private sampleQuoteFlow: EnsureSampleQuote,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  @Get()
  async list(@Context() ctx: ExecutionContext, @Query("limit") limit?: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const cap = limit ? Math.min(200, Math.max(1, Number(limit) | 0)) : 50;
    return ctx.json(await this.store.listByUser(user.id, { limit: cap }));
  }

  @Post()
  async create(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const dto = parseCreateAgentConversation(body);
    return ctx.json(await this.startFlow.run({ userId: user.id, ...dto }));
  }

  /**
   * POST /agents/conversations/onboarding-start
   *
   * Used by the FE when a user lands on /assistant?onboard=1. Creates a
   * fresh conversation and seeds the first onboarding ask so the user
   * sees the question immediately — no "type to start" friction. Idempotent
   * is up to the caller (we always create a new conversation; the FE is
   * expected to redirect away on the first hit and never call again).
   */
  @Post("onboarding-start")
  async onboardingStart(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return ctx.json(await this.onboardingFlow.run({ userId: user.id }));
  }

  @Get(":id")
  async getOne(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return ctx.json(await this.loadFlow.run({ userId: user.id, conversationId: id }));
  }

  @Get(":id/phase")
  async phase(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const { conversation } = await this.loadFlow.run({ userId: user.id, conversationId: id });
    const canAdvance = shouldTransitionToTerms(conversation);
    const nextPhaseHint = conversation.currentPhase === "quote" ? "terms" : undefined;
    return ctx.json({
      currentPhase: conversation.currentPhase,
      quoteId:      conversation.quoteId,
      contractId:   conversation.contractId,
      canAdvance,
      nextPhaseHint,
    });
  }

  @Post(":id/transition-to-terms")
  async transition(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return ctx.json(await this.transitionFlow.run({ userId: user.id, conversationId: id }));
  }

  @Post(":id/lock-quote")
  async lockQuote(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const quoteId = (body as { quoteId?: unknown } | null | undefined)?.quoteId;
    if (typeof quoteId !== "string" || !quoteId) throw new Error("quoteId is required");
    return ctx.json(await this.lockFlow.run({ userId: user.id, conversationId: id, quoteId }));
  }

  @Post(":id/accept-contract")
  async acceptContract(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const contractId = (body as { contractId?: unknown } | null | undefined)?.contractId;
    if (typeof contractId !== "string" || !contractId) throw new Error("contractId is required");
    return ctx.json(await this.acceptFlow.run({ userId: user.id, conversationId: id, contractId }));
  }

  @Post(":id/send-contract")
  async sendContract(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const b = (body ?? {}) as { contractId?: unknown; channel?: unknown };
    const contractId = b.contractId;
    if (typeof contractId !== "string" || !contractId) throw new Error("contractId is required");
    const channel = b.channel === "sms" || b.channel === "both" || b.channel === "email"
      ? b.channel
      : "email";
    return ctx.json(await this.sendContractFlow.run({ userId: user.id, conversationId: id, contractId, channel }));
  }

  @Post(":id/send-invoice")
  async sendInvoice(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return ctx.json(await this.sendInvoiceFlow.run({ userId: user.id, conversationId: id }));
  }

  /**
   * POST /agents/onboarding/sample-quote
   *
   * Per-user idempotent "see what your customer sees" quote. Returns
   * { quoteId } so the FE can navigate to /q/<quoteId>. Surfaced by the
   * synthetic post-handoff CTA in AsstChat.
   */
  @Post("/sample-quote")
  async sampleQuote(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return ctx.json(await this.sampleQuoteFlow.run({ userId: user.id }));
  }

  @Post(":id/bind-customer")
  async bindCustomer(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const customerId = (body as { customerId?: unknown } | null | undefined)?.customerId;
    if (typeof customerId !== "string" || !customerId) throw new Error("customerId is required");
    return ctx.json(await this.bindCustomerFlow.run({ userId: user.id, conversationId: id, customerId }));
  }

  @Delete(":id")
  async deleteOne(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const conv = await this.store.tryGet(id);
    if (conv && conv.userId !== user.id) throw new Error("forbidden");
    await this.store.delete(id);
    return ctx.json({ ok: true });
  }
}
