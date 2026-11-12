import { Injectable } from "#danet/core";
import { type Lang, t } from "@core/i18n/mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { namesCustomer } from "@agents/domain/business/change-order-intent/mod.ts";
import { owedReply } from "@agents/domain/business/chat-answers/mod.ts";
import { derivePreview } from "@agents/domain/business/conversation-title/mod.ts";
import type { AgentConversation } from "@agents/dto/conversation.ts";
import type { AgentMessage } from "@agents/dto/message.ts";
import type { Quote } from "@paperwork/dto/quote.ts";

export interface AnswerOwedResult {
  conversation: AgentConversation;
  newMessages: AgentMessage[];
}

/** Whose books the answer reads: a customer on file, or (no customer on
 *  file) the quotes made out to that name. */
type Who =
  | { name: string; customerId: string }
  | { name: string; quoteIds: Set<string> };

/**
 * AnswerOwed — REQ-388 (demo-loop cycle 2, M19): what the chat says to
 * "¿Cuánto me debe Ana López?" / "how much does John Miller owe me?", read
 * from that customer's OWN quotes and invoices — never by the chat model.
 *
 * Pair 2 asked it in a new chat (no quote bound). The model had no customer
 * or invoice data and a prompt that said "say the invoice already went out
 * when they signed"; it answered "El invoice ya se envió cuando firmó." —
 * while Ana's "Pago al finalizar" invoice was scheduled and unsent (REQ-316).
 *
 * Who: the customer named (accent- and case-folded, `namesCustomer`); the
 * conversation's own customer wins a tie; a name on no customer can still be
 * a customer-less quote's. No name: the conversation's customer, else its
 * quote. Nobody, nobody found, or several → one short question. Writes one
 * text message; never bills, sends or binds anything.
 *
 * Built by hand from HandleChatMessage's stores (as AnswerBilling is); the
 * stateless KV stores are defaulted.
 */
@Injectable()
export class AnswerOwed {
  constructor(
    private conversations: AgentConversationStore,
    private messages: AgentMessageStore,
    private quotes: QuoteStore = new QuoteStore(),
    private invoices: InvoiceStore = new InvoiceStore(),
    private customers: CustomerStore = new CustomerStore(),
  ) {}

  async run(input: {
    userId: string;
    conversation: AgentConversation;
    lang: Lang;
    /** The name the contractor asked about (this message or, for a
     *  follow-up, the thread's last one). */
    customerName?: string;
    /** "YYYY-MM-DD" — what is overdue. Defaults to today (UTC). */
    today?: string;
  }): Promise<AnswerOwedResult> {
    const { userId, lang } = input;
    const conv = input.conversation;
    const [customers, allQuotes, invoices] = await Promise.all([
      this.customers.listByUser(userId).catch(() => []),
      this.quotes.listByUser(userId).catch(() => [] as Quote[]),
      this.invoices.listByUser(userId).catch(() => []),
    ]);
    const quotes = allQuotes.filter((q) => !q.isSample);
    const bound = conv.quoteId
      ? quotes.find((q) => q.id === conv.quoteId)
      : undefined;
    const ownCustomerId = conv.customerId ?? bound?.customerId;
    const nameOnQuote = (q: Quote) =>
      q.customerSnapshot?.name?.trim() || q.acceptedName?.trim() || "";

    let who: Who | undefined;
    let text = "";
    const asked = input.customerName?.trim();
    if (asked) {
      let matched = customers.filter((c) => namesCustomer(asked, c.name));
      if (matched.length > 1) {
        const own = matched.find((c) => c.id === ownCustomerId);
        if (own) matched = [own];
      }
      if (matched.length === 1) {
        who = { name: matched[0].name, customerId: matched[0].id };
      } else if (matched.length > 1) {
        text = t(lang, "chatCoordinator.owed.ambiguous", {
          name: asked,
          list: matched.map((c) =>
            c.number ? `${c.name} (${c.number})` : c.name
          )
            .join(", "),
        });
      } else {
        const theirs = quotes.filter((q) =>
          !q.customerId && namesCustomer(asked, nameOnQuote(q))
        );
        if (theirs.length > 0) {
          who = {
            name: nameOnQuote(theirs[0]) || asked,
            quoteIds: new Set(theirs.map((q) => q.id)),
          };
        } else {
          text = t(lang, "chatCoordinator.owed.noCustomer", { name: asked });
        }
      }
    } else {
      const own = ownCustomerId
        ? customers.find((c) => c.id === ownCustomerId)
        : undefined;
      if (own) who = { name: own.name, customerId: own.id };
      else if (bound) {
        who = { name: nameOnQuote(bound), quoteIds: new Set([bound.id]) };
      } else text = t(lang, "chatCoordinator.owed.whichCustomer");
    }

    if (who) {
      const w = who;
      const theirQuotes = quotes.filter((q) =>
        "customerId" in w ? q.customerId === w.customerId : w.quoteIds.has(q.id)
      );
      const ids = new Set(theirQuotes.map((q) => q.id));
      const theirInvoices = invoices.filter((i) =>
        ("customerId" in w && i.customerId === w.customerId) ||
        (!!i.quoteId && ids.has(i.quoteId))
      );
      text = owedReply(lang, {
        name: w.name,
        quotes: theirQuotes,
        invoices: theirInvoices,
        today: input.today ?? new Date().toISOString().slice(0, 10),
      }).text;
    }

    const reply = await this.messages.append({
      conversationId: conv.id,
      role: "assistant",
      kind: "text",
      content: text,
    });
    const conversation = await this.conversations.update(conv.id, {
      preview: derivePreview(text),
    });
    return { conversation, newMessages: [reply] };
  }
}
