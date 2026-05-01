import { Injectable } from "#danet/core";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { SendPaperworkEmail } from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import type { AgentConversation } from "@agents/dto/conversation.ts";
import type { AgentMessage } from "@agents/dto/message.ts";

export interface LockQuoteInput {
  userId: string;
  conversationId: string;
  /** Explicit quote id from the action card the user clicked. Lets the
   *  user lock a SPECIFIC card even if the LLM has since drafted others. */
  quoteId: string;
}

export interface LockQuoteResult {
  conversation: AgentConversation;
  /** action_card (status=sent) + continue_cta(toPhase=terms) — the
   *  user's prompt to advance to phase 2 (terms wizard). */
  newMessages: AgentMessage[];
}

/**
 * LockQuote — deterministic counterpart to the LLM's `lock_quote` tool.
 *
 * The LLM-driven path (handle-chat-message) is unreliable for "lock"
 * intents — gpt-4o-mini sometimes drafts another quote instead of
 * locking. Surfacing this as its own endpoint behind the action_card's
 * "Lock it in" button removes the model from the loop entirely.
 *
 * This is the phase-1 → phase-2 handoff in the chat:
 *   1. Verify ownership of conversation + quote.
 *   2. If quote already 'sent', short-circuit (idempotent).
 *   3. Flip quote.status = 'sent', emit `quote sent`, dispatch the
 *      customer email (best-effort — failure doesn't abort).
 *   4. Append the locked action_card (status=sent) + a continue_cta
 *      to the terms wizard, so the chat advances forward instead of
 *      dead-ending after the click.
 *   5. Set conv.quoteId so the wizard / send-contract know what to
 *      operate on.
 *
 * The customer-acceptance event lives on the contract (see
 * AcceptContract), not here — the chain is:
 *   draft → lock (phase 1) → wizard (phase 2) → send → customer
 *   signs contract → invoice.
 */
@Injectable()
export class LockQuote {
  constructor(
    private conversations: AgentConversationStore,
    private messages: AgentMessageStore,
    private quotes: QuoteStore,
    private bus: EventBus,
    private emailer: SendPaperworkEmail,
  ) {}

  async run(input: LockQuoteInput): Promise<LockQuoteResult> {
    const conv = await this.conversations.get(input.conversationId);
    if (conv.userId !== input.userId) throw new Error("forbidden");

    const quote = await this.quotes.getOwned(input.quoteId, input.userId);

    const wasAlreadySent = quote.status === "sent";
    if (!wasAlreadySent) {
      // Stamp sentAt here too — the /quotes stage derivation reads sentAt
      // (not status), and the email-side stamping in SendPaperworkEmail is
      // skipped when there's no recipient on file. Without this, locking
      // a quote with no customer email leaves stage="draft" forever even
      // though status="sent" — which broke the pipeline view (audit #2).
      await this.quotes.update(quote.id, input.userId, {
        status: "sent",
        sentAt: new Date().toISOString(),
      });
      await this.bus.emit({
        userId: input.userId,
        entityType: "quote",
        entityId: quote.id,
        action: "sent",
      });
      try {
        await this.emailer.run(input.userId, { kind: "quote", resourceId: quote.id });
      } catch (err) {
        console.error(`[lock-quote] email dispatch failed for quote ${quote.id}:`, err);
      }
    }

    // Re-read so the action_card mirrors what's actually persisted.
    const fresh = await this.quotes.getOwned(quote.id, input.userId);
    // Audit1 #3 — QuoteStore now persists per-unit price in INTEGER CENTS,
    // so per-line totals are price × quantity (no more × 100). Same for
    // estimatedTotal.
    const lineItems = (fresh.lineItems ?? []).map((li) => ({
      description: li.description,
      amountCents: Math.round((li.price ?? 0) * (li.quantity ?? 1)),
    }));
    const totalCents = fresh.estimatedTotal ?? 0;

    const card = await this.messages.append({
      conversationId: conv.id,
      role: "assistant",
      kind: "action_card",
      content: fresh.summary ?? "Quote locked",
      payload: {
        actionType: "quote",
        status: "sent",
        quoteId: fresh.id,
        ...(fresh.customerId ? { customerId: fresh.customerId } : {}),
        lineItems,
        totalCents,
      },
    });

    const cta = await this.messages.append({
      conversationId: conv.id,
      role: "assistant",
      kind: "continue_cta",
      content: "Continue to terms",
      payload: {
        toPhase: "terms",
        quoteId: fresh.id,
        summary: "Payment, warranty, dispute, governing state — a few quick questions",
      },
    });

    const updated = await this.conversations.update(conv.id, {
      quoteId: fresh.id,
      quoteStatus: "sent",
      preview: `Quote sent: ${fresh.summary ?? fresh.id}`,
    });

    return { conversation: updated, newMessages: [card, cta] };
  }
}
