import { Injectable } from "#danet/core";
import { type Lang, t } from "@core/i18n/mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { QuoteInquiryStore } from "@paperwork/domain/data/inquiry-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import {
  type InquiryForReply,
  inquiryReply,
} from "@agents/domain/business/chat-answers/mod.ts";
import { derivePreview } from "@agents/domain/business/conversation-title/mod.ts";
import { docNumberOf } from "#documents/numbering.ts";
import { quoteJobTitle } from "#quote-flow/job-name.ts";
import type { AgentConversation } from "@agents/dto/conversation.ts";
import type { AgentMessage } from "@agents/dto/message.ts";
import type { Quote } from "@paperwork/dto/quote.ts";

export interface AnswerInquiriesResult {
  conversation: AgentConversation;
  newMessages: AgentMessage[];
}

/** Accent- and case-folded words. */
const fold = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** The message names this person: their first name is one of its words. */
function mentions(text: string, name: string | undefined): boolean {
  const first = fold(name?.trim() ?? "").split(/\s+/)[0];
  if (!first || first.length < 2) return false;
  return fold(text).split(/[^\p{L}\p{N}]+/u).includes(first);
}

/**
 * AnswerInquiries — REQ-701 (demo-loop cycle 5, issue M21): what the chat
 * says to "¿dónde le contesto?" / "where do I answer her?" / "what did Linda
 * ask?", read from the questions clients sent (QuoteInquiryStore) — never
 * by the chat model.
 *
 * Pair 9 typed "Ya terminamos… mándale la factura ahora… y Linda preguntó…
 * ¿dónde le contesto?"; the assistant answered only the invoice half — it had
 * no idea Linda had asked anything, and the quote panel had no question to
 * answer from. Which questions: the unanswered ones on live quotes; when the
 * message names someone who asked (first name, accents folded), only theirs;
 * the conversation's own quote first, then newest. One text message, linking
 * (payload.inquiry) to the first one's quote questions. Writes nothing else.
 *
 * `onlyRelevant` (a how-to-reply ask that names no question — "how should I
 * respond to him? he says the price is too high", see isReplyAdviceAsk): only
 * the questions of the person the message names, else of the thread's quote;
 * none such → undefined and nothing written, so the chat model answers.
 *
 * Built by hand from HandleChatMessage's stores (as AnswerOwed is); the
 * stateless KV stores are defaulted.
 */
@Injectable()
export class AnswerInquiries {
  constructor(
    private conversations: AgentConversationStore,
    private messages: AgentMessageStore,
    private inquiries: QuoteInquiryStore = new QuoteInquiryStore(),
    private quotes: QuoteStore = new QuoteStore(),
    private customers: CustomerStore = new CustomerStore(),
  ) {}

  async run(input: {
    userId: string;
    conversation: AgentConversation;
    lang: Lang;
    /** the contractor's message — who it names */
    text: string;
    /** answer only from a question the message's person (or the thread's
     *  quote) has waiting — else undefined, nothing written */
    onlyRelevant?: boolean;
  }): Promise<AnswerInquiriesResult | undefined> {
    const { userId, lang } = input;
    const conv = input.conversation;
    const [open, quotes, customers] = await Promise.all([
      this.inquiries.listOpenByUser(userId).catch(() => []),
      this.quotes.listByUser(userId).catch(() => [] as Quote[]),
      this.customers.listByUser(userId).catch(() => []),
    ]);
    const live = new Map(quotes.map((q) => [q.id, q]));
    const customerName = new Map(customers.map((c) => [c.id, c.name]));
    const rows = open.flatMap((i) => {
      const q = live.get(i.quoteId);
      if (!q) return []; // a deleted quote's question is not waiting
      const realName = i.name?.trim() ||
        customerName.get(i.customerId ?? q.customerId ?? "")?.trim() ||
        q.customerSnapshot?.name?.trim() || undefined;
      const row: InquiryForReply & { realName?: string } = {
        quoteId: q.id,
        quoteNumber: docNumberOf(q),
        ...(quoteJobTitle(q, lang) ? { job: quoteJobTitle(q, lang) } : {}),
        name: realName ?? t(lang, "quotesPage.inquiries.someone"),
        question: i.question,
        ...(i.contactBack ? { contactBack: i.contactBack } : {}),
        at: i.createdAt,
        realName,
      };
      return [row];
    });
    const named = rows.filter((r) => mentions(input.text, r.realName));
    const pool = named.length
      ? named
      : input.onlyRelevant
      ? rows.filter((r) => r.quoteId === conv.quoteId)
      : rows;
    if (input.onlyRelevant && pool.length === 0) return undefined;
    const shown = pool
      .sort((a, b) =>
        Number(b.quoteId === conv.quoteId) -
          Number(a.quoteId === conv.quoteId) ||
        b.at.localeCompare(a.at)
      )
      .map(({ realName: _r, ...row }) => row);
    const reply = inquiryReply(lang, shown);

    const message = await this.messages.append({
      conversationId: conv.id,
      role: "assistant",
      kind: "text",
      content: reply.text,
      ...(reply.link
        ? { payload: { inquiry: { kind: "open", ...reply.link } } }
        : {}),
    });
    const conversation = await this.conversations.update(conv.id, {
      preview: derivePreview(reply.text),
    });
    return { conversation, newMessages: [message] };
  }
}
