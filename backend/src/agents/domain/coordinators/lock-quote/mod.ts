import { Injectable } from "#danet/core";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { lockStatusFor, QUOTE_LOCKED } from "#quote-flow/quote-lock.ts";
import { TranslateQuote } from "@agents/domain/coordinators/translate-quote/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { t } from "@core/i18n/mod.ts";
import {
  QuotePriceError,
  storedQuotePriceProblem,
} from "#quote-flow/quote-price-guard.ts";
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
  /** action_card (status=locked) + continue_cta(toPhase=terms) — the
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
 *   2. Stamp quote.lockedAt (first lock only). REQ-234 (demo M3): locking
 *      is NOT sending — status stays "draft", no sentAt, no `quote sent`
 *      event, no customer email. Those belong to Send (SendQuote), after
 *      the terms and the customer are on the quote.
 *   3. (re-locking an already-sent quote leaves it as it is.)
 *   4. Append the locked action_card (status=locked) + a continue_cta
 *      to the terms wizard, so the chat advances forward instead of
 *      dead-ending after the click.
 *   5. Set conv.quoteId so the wizard / send-quote know what to
 *      operate on.
 *
 * The customer-acceptance event lives on the quote (see
 * AcceptQuote), not here — the chain is:
 *   draft → lock (phase 1) → wizard (phase 2) → send → customer
 *   signs the quote → invoice.
 */
@Injectable()
export class LockQuote {
  constructor(
    private conversations: AgentConversationStore,
    private messages: AgentMessageStore,
    private quotes: QuoteStore,
    private users: UserStore,
    /** REQ-264 (M15): fills every document language before dispatch. */
    private translator?: TranslateQuote,
  ) {}

  async run(input: LockQuoteInput): Promise<LockQuoteResult> {
    const conv = await this.conversations.get(input.conversationId);
    if (conv.userId !== input.userId) throw new Error("forbidden");

    // Chat copy is rendered to the contractor in their own UI language.
    const me = await this.users.get(input.userId).catch(() => null);
    const lang = me?.language === "es" ? "es" : "en";

    const quote = await this.quotes.getOwned(input.quoteId, input.userId);

    if (lockStatusFor(quote) === QUOTE_LOCKED && !quote.lockedAt) {
      // REQ-302 (demo B1): a draft with no price — a negative line or a
      // total at or below zero — is never locked. The chat island disables
      // the button for it; this is the server's own refusal. (A quote that
      // is already locked or sent is a no-op re-lock, not judged here.)
      const priceProblem = storedQuotePriceProblem(quote);
      if (priceProblem) {
        throw new QuotePriceError(
          priceProblem,
          t(lang, "chatCoordinator.priceMissing", {
            item: quote.lineItems?.[0]?.description?.trim() ||
              quote.summary || "this job",
          }),
        );
      }
      await this.quotes.update(quote.id, input.userId, {
        lockedAt: new Date().toISOString(),
      });
      // REQ-264 (M15): the customer reads the document in either language
      // (/q?lang=…, the email's) — translate at lock so the review card and
      // the later send carry both; never blocks. REQ-234: lock never sends.
      await this.translator?.run({ userId: input.userId, quoteId: quote.id })
        .catch((err) =>
          console.error(`[lock-quote] translate failed for ${quote.id}:`, err)
        );
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
    const status = lockStatusFor(fresh);

    const card = await this.messages.append({
      conversationId: conv.id,
      role: "assistant",
      kind: "action_card",
      content: fresh.summary ?? t(lang, "lockQuote.card.lockedFallback"),
      payload: {
        actionType: "quote",
        status,
        quoteId: fresh.id,
        ...(fresh.customerId ? { customerId: fresh.customerId } : {}),
        ...(fresh.description ? { description: fresh.description } : {}),
        lineItems,
        totalCents,
      },
    });

    const cta = await this.messages.append({
      conversationId: conv.id,
      role: "assistant",
      kind: "continue_cta",
      content: t(lang, "lockQuote.cta.lockedPrompt"),
      payload: {
        toPhase: "terms",
        quoteId: fresh.id,
      },
    });

    const updated = await this.conversations.update(conv.id, {
      quoteId: fresh.id,
      quoteStatus: status,
      preview: t(
        lang,
        status === QUOTE_LOCKED
          ? "lockQuote.preview.locked"
          : "lockQuote.preview.sent",
        {
          summary: fresh.summary ?? fresh.id,
        },
      ),
    });

    return { conversation: updated, newMessages: [card, cta] };
  }
}
