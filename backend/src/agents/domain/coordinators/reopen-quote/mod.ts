import { Injectable } from "#danet/core";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { RewindWizard } from "@agents/domain/coordinators/rewind-wizard/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { lockStatusFor, QUOTE_LOCKED } from "#quote-flow/quote-lock.ts";
import type { AgentConversation } from "@agents/dto/conversation.ts";
import type { AgentMessage } from "@agents/dto/message.ts";

export interface ReopenQuoteInput {
  userId: string;
  conversationId: string;
  /** The quote on the card the user tapped "Re-open" on. */
  quoteId: string;
}

export interface ReopenQuoteResult {
  conversation: AgentConversation;
  /** Transcript rows dropped: the wizard (if running), the locked card and
   *  its "Ready" CTA. */
  removedMessageIds: string[];
  /** A draft card re-emitted when the transcript no longer had one for the
   *  quote (otherwise empty — the original draft card is what shows). */
  newMessages: AgentMessage[];
}

/** The quote was already sent — Re-open can't un-send; revise it instead. */
export class QuoteAlreadySentError extends Error {
  constructor(quoteId: string) {
    super(
      `quote ${quoteId} is already sent — change it with a revision instead`,
    );
    this.name = "QuoteAlreadySentError";
  }
}

/**
 * ReopenQuote — REQ-334 (demo-loop cycle 1, M25): the deterministic handler
 * behind the locked action card's "Re-open" button, the inverse of LockQuote.
 *
 * Before: the button posted the chat text "Re-open the quote." which no code
 * handled, and the terms prompt answered it with "Tap \"Re-open the quote\"
 * to go back to phase 1" — a dead loop. Now:
 *   1. Verify ownership; refuse an issued quote (sent/viewed/accepted) —
 *      nothing un-sends, the client routes those to the revision path.
 *   2. If the terms wizard is running, leave it via RewindWizard's
 *      LEAVE_TERMS (-1): every question, pick and the divider go, the wizard
 *      state is cleared, the conversation is back in the quote phase.
 *   3. Drop what LockQuote appended: the locked card(s) for this quote and
 *      the "Ready" CTA into terms — so the earlier DRAFT card is no longer
 *      superseded and shows Lock it in / Edit again. If no draft card is
 *      left for the quote, append a fresh one.
 *   4. Clear quote.lockedAt (status was never flipped by lock — REQ-234).
 *   5. conv.currentPhase = quote, conv.quoteStatus = draft.
 */
@Injectable()
export class ReopenQuote {
  constructor(
    private conversations: AgentConversationStore,
    private messages: AgentMessageStore,
    private quotes: QuoteStore,
    private rewind: RewindWizard,
  ) {}

  async run(input: ReopenQuoteInput): Promise<ReopenQuoteResult> {
    const conv = await this.conversations.get(input.conversationId);
    if (conv.userId !== input.userId) throw new Error("forbidden");
    const quote = await this.quotes.getOwned(input.quoteId, input.userId);
    if (lockStatusFor(quote) !== QUOTE_LOCKED) {
      throw new QuoteAlreadySentError(quote.id);
    }

    const removed: string[] = [];
    if (conv.currentPhase === "terms") {
      const left = await this.rewind.run({
        userId: input.userId,
        conversationId: conv.id,
        toStepIdx: LEAVE_TERMS,
      });
      removed.push(...left.removedMessageIds);
    }

    const msgs = await this.messages.listByConversation(conv.id);
    const gone = msgs.filter((m) =>
      isLockedCardFor(m, quote.id) || isTermsCta(m)
    ).map((m) => m.id);
    if (gone.length) await this.messages.deleteByIds(conv.id, gone);
    removed.push(...gone);

    if (quote.lockedAt) await this.quotes.unlock(quote.id, input.userId);

    const newMessages: AgentMessage[] = [];
    const hasDraftCard = msgs.some((m) =>
      m.kind === "action_card" && cardOf(m).quoteId === quote.id &&
      cardOf(m).status === "draft"
    );
    if (!hasDraftCard) {
      newMessages.push(
        await this.messages.append({
          conversationId: conv.id,
          role: "assistant",
          kind: "action_card",
          content: quote.summary ?? quote.id,
          payload: {
            actionType: "quote",
            status: "draft",
            quoteId: quote.id,
            ...(quote.number ? { number: quote.number } : {}), // REQ-465
            ...(quote.customerId ? { customerId: quote.customerId } : {}),
            ...(quote.description ? { description: quote.description } : {}),
            // REQ-435 (demo-loop cycle 3, M4): the job address stays shown.
            ...(quote.serviceAddress
              ? { serviceAddress: quote.serviceAddress }
              : {}),
            lineItems: (quote.lineItems ?? []).map((li) => ({
              description: li.description,
              amountCents: Math.round((li.price ?? 0) * (li.quantity ?? 1)),
            })),
            totalCents: quote.estimatedTotal ?? 0,
          },
        }),
      );
    }

    const updated = await this.conversations.update(conv.id, {
      currentPhase: "quote",
      quoteStatus: "draft",
    });
    return { conversation: updated, removedMessageIds: removed, newMessages };
  }
}

/** RewindWizard's `toStepIdx` sentinel for "leave the terms phase" (REQ-005). */
const LEAVE_TERMS = -1;

function cardOf(
  m: AgentMessage,
): { quoteId?: string; status?: string; toPhase?: string } {
  return (m.payload ?? {}) as {
    quoteId?: string;
    status?: string;
    toPhase?: string;
  };
}

function isLockedCardFor(m: AgentMessage, quoteId: string): boolean {
  return m.kind === "action_card" && cardOf(m).quoteId === quoteId &&
    cardOf(m).status !== "draft";
}

function isTermsCta(m: AgentMessage): boolean {
  return m.kind === "continue_cta" && cardOf(m).toPhase === "terms";
}
