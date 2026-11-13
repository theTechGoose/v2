import { Injectable } from "#danet/core";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { titleFromJobName } from "@agents/domain/business/conversation-title/mod.ts";
import type { AgentConversation } from "@agents/dto/conversation.ts";

/**
 * StartConversation — create a brand-new agent conversation in phase 'quote'.
 *
 * Optionally pre-binds a customer or quote (e.g. when the user clicks
 * "Open in chat" from a quote-list row). Also seeds a synthetic system
 * message? No — leave the message log empty so the chat-viewport renders
 * its empty state, then the user's first input lands as message #1.
 *
 * REQ-447 (demo-loop cycle 3, m14): a conversation bound to a quote — here
 * or later by `bindQuote` — is titled by the quote's jobName, so the thread
 * and its document carry one name.
 */
@Injectable()
export class StartConversation {
  constructor(
    private conversations: AgentConversationStore,
    private quotes?: QuoteStore,
  ) {}

  async run(input: { userId: string; customerId?: string; quoteId?: string }): Promise<AgentConversation> {
    const conv = await this.conversations.create({
      userId: input.userId,
      customerId: input.customerId,
      quoteId: input.quoteId,
      currentPhase: "quote",
    });
    const title = await this.jobTitle(input.userId, input.quoteId);
    return title ? await this.conversations.update(conv.id, { title }) : conv;
  }

  /** REQ-447: bind a quote to an existing conversation; its jobName becomes
   *  the thread's title (the first message's wording is replaced). */
  async bindQuote(input: { userId: string; conversationId: string; quoteId: string }): Promise<AgentConversation> {
    const title = await this.jobTitle(input.userId, input.quoteId);
    return await this.conversations.update(input.conversationId, {
      quoteId: input.quoteId,
      ...(title ? { title } : {}),
    });
  }

  private async jobTitle(userId: string, quoteId?: string): Promise<string | undefined> {
    if (!quoteId || !this.quotes) return undefined;
    const quote = await this.quotes.getOwned(quoteId, userId).catch(() => undefined);
    return titleFromJobName(quote?.jobName);
  }
}
