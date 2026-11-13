import { Injectable } from "#danet/core";
import { type Lang, t } from "@core/i18n/mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import {
  type BillingReply,
  billingReply,
} from "@agents/domain/business/chat-answers/mod.ts";
import { derivePreview } from "@agents/domain/business/conversation-title/mod.ts";
import type { AgentConversation } from "@agents/dto/conversation.ts";
import type { AgentMessage } from "@agents/dto/message.ts";

export interface AnswerBillingResult {
  conversation: AgentConversation;
  newMessages: AgentMessage[];
}

/**
 * The chat's invoice action_card for one invoice — what AnswerBilling shows
 * and (REQ-583, demo-loop cycle 4, M2) what ChatBilling shows after a send
 * or a payment. Its number rides on the payload, and `offerSend` (scheduled
 * / drafted) gives the card its "Send now" button, whose words ("Send
 * INV-001 now") the chat reads back as the send.
 */
export function invoiceCardMessage(
  conversationId: string,
  inv: NonNullable<BillingReply["invoice"]>,
  owner: { quoteId?: string; customerId?: string },
): Omit<AgentMessage, "id" | "createdAt"> {
  return {
    conversationId,
    role: "assistant",
    kind: "action_card",
    content: inv.title,
    payload: {
      actionType: "invoice",
      status: inv.status,
      invoiceId: inv.id,
      ...(inv.number ? { number: inv.number } : {}),
      ...(owner.quoteId ? { quoteId: owner.quoteId } : {}),
      ...(owner.customerId ? { customerId: owner.customerId } : {}),
      lineItems: [{
        description: inv.line,
        amountCents: inv.amountCents,
      }],
      totalCents: inv.amountCents,
      ...(inv.dueDate ? { dueDate: inv.dueDate } : {}),
      ...(inv.offerSend ? { offerSend: true } : {}),
    },
  };
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
    /** REQ-673: a pending change order is mentioned in the answer. */
    private changeOrders: ChangeOrderStore = new ChangeOrderStore(),
  ) {}

  /** Undefined when the conversation has no readable quote to talk about —
   *  the caller then takes its own path. */
  async run(input: {
    userId: string;
    conversation: AgentConversation;
    lang: Lang;
    /** REQ-656 (demo-loop cycle 5, M9): "the job is done" was said — a
     *  scheduled invoice is answered with Send now. */
    jobDone?: boolean;
    /** REQ-768: the job the message named, in a thread with none bound —
     *  bound with the answer, unless the answer is the invoice flow (a
     *  finished job whose quote was never signed: the flow makes its own
     *  invoice and the thread keeps its "Start the invoice" button). */
    job?: { quoteId: string; customerId?: string };
    /** REQ-768: the amount typed with a job-done ask. */
    amountCents?: number;
  }): Promise<AnswerBillingResult | undefined> {
    const conv = input.conversation;
    const quoteId = conv.quoteId ?? input.job?.quoteId;
    if (!quoteId) return undefined;
    const quote = await this.quotes.getOwned(quoteId, input.userId)
      .catch(() => undefined);
    if (!quote) return undefined;
    const invoices = (await this.invoices.listByUser(input.userId)
      .catch(() => []))
      .filter((i) => i.quoteId === quote.id);
    const invoiceIds = new Set(invoices.map((i) => i.id));
    const changeOrders = (await this.changeOrders.listByUser(input.userId)
      .catch(() => []))
      .filter((c) => c.quoteId === quote.id || invoiceIds.has(c.invoiceId));
    const reply = billingReply(input.lang, quote, invoices, changeOrders, {
      jobDone: input.jobDone === true,
      ...(input.amountCents ? { amountCents: input.amountCents } : {}),
    });

    const newMessages: AgentMessage[] = [
      await this.messages.append({
        conversationId: conv.id,
        role: "assistant",
        kind: "text",
        content: reply.text,
        ...(reply.invoiceFlow
          ? { payload: { invoiceFlow: reply.invoiceFlow } }
          : {}),
      }),
    ];
    const patch: Partial<AgentConversation> = {
      preview: derivePreview(reply.invoice?.title ?? reply.text),
      ...(!conv.quoteId && input.job && !reply.invoiceFlow
        ? {
          quoteId: input.job.quoteId,
          ...(input.job.customerId ? { customerId: input.job.customerId } : {}),
        }
        : {}),
    };
    if (reply.invoice) {
      const inv = reply.invoice;
      newMessages.push(
        await this.messages.append(
          invoiceCardMessage(conv.id, inv, {
            quoteId: quote.id,
            customerId: quote.customerId,
          }),
        ),
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
