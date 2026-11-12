import { Injectable } from "#danet/core";
import { type Lang, t } from "@core/i18n/mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { billingReply } from "@agents/domain/business/chat-answers/mod.ts";
import { derivePreview } from "@agents/domain/business/conversation-title/mod.ts";
import type { AgentConversation } from "@agents/dto/conversation.ts";
import type { AgentMessage } from "@agents/dto/message.ts";

export interface AnswerBillingResult {
  conversation: AgentConversation;
  newMessages: AgentMessage[];
}

/**
 * AnswerBilling — REQ-368 (demo-loop cycle 1, M32): what the chat says when
 * the contractor asks to bill the conversation's job, read from the quote
 * and that quote's OWN invoices — never by re-locking, re-sending or
 * re-drafting the quote.
 *
 * Pair 1 asked "John signed! Please send him the deposit invoice for $1,600"
 * and got the signed quote back as an APPROVED card, "Is this for a business
 * or a person?", then "All terms answered." — while signing had already sent
 * INV-001 for the $1,600 deposit. This appends:
 *   1. the state in words (signed + which invoice went out and when it's
 *      due / not signed yet / not sent yet / declined / paid up);
 *   2. the open invoice as an invoice action_card, bound to the conversation
 *      (so "Continue to invoice" reuses it instead of billing the job twice);
 *   3. or, signed with nothing billed, the "Continue to invoice" CTA.
 *
 * Used by HandleChatMessage (a billing ask, or a lock/terms action on a quote
 * past drafting) and TransitionToTerms (a finished wizard on an issued
 * quote). Both build it by hand from their own stores; the quote and invoice
 * stores are stateless KV wrappers, defaulted so neither caller needs a new
 * constructor parameter.
 */
@Injectable()
export class AnswerBilling {
  constructor(
    private conversations: AgentConversationStore,
    private messages: AgentMessageStore,
    private quotes: QuoteStore = new QuoteStore(),
    private invoices: InvoiceStore = new InvoiceStore(),
  ) {}

  /** Undefined when the conversation has no readable quote to talk about —
   *  the caller then takes its own path. */
  async run(input: {
    userId: string;
    conversation: AgentConversation;
    lang: Lang;
  }): Promise<AnswerBillingResult | undefined> {
    const conv = input.conversation;
    if (!conv.quoteId) return undefined;
    const quote = await this.quotes.getOwned(conv.quoteId, input.userId)
      .catch(() => undefined);
    if (!quote) return undefined;
    const invoices = (await this.invoices.listByUser(input.userId)
      .catch(() => []))
      .filter((i) => i.quoteId === quote.id);
    const reply = billingReply(input.lang, quote, invoices);

    const newMessages: AgentMessage[] = [
      await this.messages.append({
        conversationId: conv.id,
        role: "assistant",
        kind: "text",
        content: reply.text,
      }),
    ];
    const patch: Partial<AgentConversation> = {
      preview: derivePreview(reply.invoice?.title ?? reply.text),
    };
    if (reply.invoice) {
      const inv = reply.invoice;
      newMessages.push(
        await this.messages.append({
          conversationId: conv.id,
          role: "assistant",
          kind: "action_card",
          content: inv.title,
          payload: {
            actionType: "invoice",
            status: inv.status,
            invoiceId: inv.id,
            quoteId: quote.id,
            ...(quote.customerId ? { customerId: quote.customerId } : {}),
            lineItems: [{
              description: inv.line,
              amountCents: inv.amountCents,
            }],
            totalCents: inv.amountCents,
            ...(inv.dueDate ? { dueDate: inv.dueDate } : {}),
          },
        }),
      );
      if (!conv.invoiceId) {
        patch.invoiceId = inv.id;
        patch.invoiceStatus = inv.status;
      }
    }
    if (reply.offerInvoiceCta) {
      newMessages.push(
        await this.messages.append({
          conversationId: conv.id,
          role: "assistant",
          kind: "continue_cta",
          content: t(input.lang, "acceptQuote.cta.label"),
          payload: {
            toPhase: "invoice",
            quoteId: quote.id,
            summary: t(input.lang, "acceptQuote.cta.summary"),
          },
        }),
      );
    }
    const conversation = await this.conversations.update(conv.id, patch);
    return { conversation, newMessages };
  }
}
