import { Injectable } from "#danet/core";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import type { AgentConversation } from "@agents/dto/conversation.ts";

/**
 * StartConversation — create a brand-new agent conversation in phase 'quote'.
 *
 * Optionally pre-binds a customer or quote (e.g. when the user clicks
 * "Open in chat" from a quote-list row). Also seeds a synthetic system
 * message? No — leave the message log empty so the chat-viewport renders
 * its empty state, then the user's first input lands as message #1.
 */
@Injectable()
export class StartConversation {
  constructor(private conversations: AgentConversationStore) {}

  async run(input: { userId: string; customerId?: string; quoteId?: string }): Promise<AgentConversation> {
    return await this.conversations.create({
      userId: input.userId,
      customerId: input.customerId,
      quoteId: input.quoteId,
      currentPhase: "quote",
    });
  }
}
