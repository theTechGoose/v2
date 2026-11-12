import { Injectable } from "#danet/core";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { computeProgress } from "@agents/domain/business/wizard-progress/mod.ts";
import { getWizardSpec } from "@agents/domain/business/terms-wizard-spec/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import type { AgentConversation } from "@agents/dto/conversation.ts";
import type { AgentMessage } from "@agents/dto/message.ts";
import type { WizardState } from "@agents/dto/wizard.ts";
import type { WizardProgress } from "@agents/domain/business/wizard-progress/mod.ts";
import type { Quote } from "@paperwork/dto/quote.ts";
import type { Customer } from "@crm/dto/customer.ts";
import type { AssistantDraft } from "#quote-flow/assistant-draft.ts";
import { isPricePick, pricePickRef } from "#quote-flow/price-pick.ts"; // REQ-688
import { renderChatI18n } from "#quote-flow/chat-i18n.ts";
import { t } from "@core/i18n/mod.ts";

export interface ConversationSnapshot {
  conversation: AgentConversation;
  messages: AgentMessage[];
  /** Only present when conversation.currentPhase === 'terms'. */
  wizard?: { state: WizardState; progress: WizardProgress };
  /** Bound quote (the agreement) — populated once a quote is locked. */
  quote?: Quote;
  /** Bound customer — resolved from conv.customerId or quote.customerId. */
  customer?: Customer;
  /** REQ-230: the assistant's in-flight flow (options, pick, price, view),
   *  so any window's reload rebuilds it. Absent when none was saved. */
  draft?: AssistantDraft;
}

/**
 * LoadConversation — composite read for `GET /agents/conversations/:id`.
 *
 * Returns the conversation, its full message history (oldest → newest),
 * and — if in terms phase — the wizard's state + computed progress.
 */
@Injectable()
export class LoadConversation {
  constructor(
    private conversations: AgentConversationStore,
    private messages: AgentMessageStore,
    private quotes: QuoteStore,
    private customers: CustomerStore,
  ) {}

  async run(
    input: { userId: string; conversationId: string },
  ): Promise<ConversationSnapshot> {
    let conv = await this.conversations.get(input.conversationId);
    if (conv.userId !== input.userId) throw new Error("forbidden");
    if (conv.hasUnreadEvent) {
      conv = await this.conversations.clearUnreadEvent(conv.id);
    }
    let msgs = await this.messages.listByConversation(input.conversationId);

    let wizard: ConversationSnapshot["wizard"];
    if (conv.currentPhase === "terms") {
      const state = await this.conversations.getWizardState(
        input.conversationId,
      );
      if (state) {
        const progress = computeProgress(getWizardSpec(state.specId), state);
        wizard = { state, progress };
      }
    }

    let quote: Quote | undefined;
    if (conv.quoteId) {
      try {
        quote = await this.quotes.getOwned(conv.quoteId, conv.userId);
      } catch {
        /* quote was deleted out from under the conversation — surface conv state without it */
      }
    }

    // REQ-688 (demo-loop cycle 5, m65): the "Price: $…" pick line follows a
    // later price edit (Back to the price card, a preview or chat change).
    if (quote) msgs = await this.syncPricePick(conv.id, msgs, quote);

    // Bound customer — prefer the conversation's customerId, fall back to
    // the quote's. Needed so the recovery UI (and any per-customer
    // surfaces) can render without a follow-up fetch. Best-effort: a
    // forbidden/missing row just leaves customer undefined.
    let customer: Customer | undefined;
    const customerId = conv.customerId ?? quote?.customerId;
    if (customerId) {
      try {
        customer = await this.customers.getOwned(customerId, conv.userId);
      } catch { /* surface the rest of the snapshot without customer */ }
    }

    const draft = await this.conversations.getDraft(input.conversationId);

    return {
      conversation: conv,
      messages: msgs,
      wizard,
      quote,
      customer,
      ...(draft ? { draft } : {}),
    };
  }

  /** REQ-688: rewrite a stale price pick line to the quote's total, stored
   *  so every reader sees the same line. */
  private async syncPricePick(
    conversationId: string,
    msgs: AgentMessage[],
    quote: Quote,
  ): Promise<AgentMessage[]> {
    const cents = quote.estimatedTotal;
    if (typeof cents !== "number" || cents <= 0) return msgs;
    const rounded = Math.round(cents);
    const out: AgentMessage[] = [];
    for (const m of msgs) {
      const stored = (m.payload as { priceCents?: unknown } | undefined)
        ?.priceCents;
      if (!isPricePick(m) || stored === rounded) {
        out.push(m);
        continue;
      }
      const ref = pricePickRef(rounded);
      // The line keeps the language it was written in; readers re-render it
      // from the key anyway (REQ-589).
      const lang = m.content.startsWith(t("es", "wizardAnswer.pick.priceLabel"))
        ? "es"
        : "en";
      const next = await this.messages.replace(conversationId, m.id, {
        content: renderChatI18n(ref, lang, t),
        payload: { ...(m.payload ?? {}), i18n: ref, priceCents: rounded },
      });
      out.push(next ?? m);
    }
    return out;
  }
}
