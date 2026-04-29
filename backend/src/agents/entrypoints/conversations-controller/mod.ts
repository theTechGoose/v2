import { Body, Context, Controller, Delete, Get, Param, Post, Query } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { StartConversation } from "@agents/domain/coordinators/start-conversation/mod.ts";
import { LoadConversation } from "@agents/domain/coordinators/load-conversation/mod.ts";
import { TransitionToTerms } from "@agents/domain/coordinators/transition-to-terms/mod.ts";
import { LockQuote } from "@agents/domain/coordinators/lock-quote/mod.ts";
import { AcceptQuote } from "@agents/domain/coordinators/accept-quote/mod.ts";
import { AcceptContract } from "@agents/domain/coordinators/accept-contract/mod.ts";
import { SendContract } from "@agents/domain/coordinators/send-contract/mod.ts";
import { SendInvoice } from "@agents/domain/coordinators/send-invoice/mod.ts";
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
    private acceptQuoteFlow: AcceptQuote,
    private acceptFlow: AcceptContract,
    private sendContractFlow: SendContract,
    private sendInvoiceFlow: SendInvoice,
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

  @Post(":id/accept-quote")
  async acceptQuote(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const quoteId = (body as { quoteId?: unknown } | null | undefined)?.quoteId;
    if (typeof quoteId !== "string" || !quoteId) throw new Error("quoteId is required");
    return ctx.json(await this.acceptQuoteFlow.run({ userId: user.id, conversationId: id, quoteId }));
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
    const contractId = (body as { contractId?: unknown } | null | undefined)?.contractId;
    if (typeof contractId !== "string" || !contractId) throw new Error("contractId is required");
    return ctx.json(await this.sendContractFlow.run({ userId: user.id, conversationId: id, contractId }));
  }

  @Post(":id/send-invoice")
  async sendInvoice(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return ctx.json(await this.sendInvoiceFlow.run({ userId: user.id, conversationId: id }));
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
