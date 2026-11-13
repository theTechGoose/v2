import { Injectable } from "#danet/core";
import { t } from "@core/i18n/mod.ts";
import {
  type ChatI18nRef,
  type ChatI18nVar,
  renderChatI18n,
} from "#quote-flow/chat-i18n.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { isAccepted } from "#quote-flow/quote-status.ts";
import { shortDate } from "#documents/linked-view.ts";
import {
  recurringFromTerms,
  recurringTermText,
} from "#quote-flow/recurring-billing.ts"; // REQ-699
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import {
  type QuoteSignedEvent,
  QuoteSignedPort,
} from "@paperwork/domain/coordinators/quote-signed-port/mod.ts";
import type { AgentConversation } from "@agents/dto/conversation.ts";
import type { AgentMessage } from "@agents/dto/message.ts";

export interface AcceptQuoteInput {
  userId: string;
  conversationId: string;
  quoteId: string;
}

export interface AcceptQuoteResult {
  conversation: AgentConversation;
  /** phase_divider message announcing the acceptance, for the chat. */
  newMessages: AgentMessage[];
}

/**
 * AcceptQuote — fires when the customer accepts (signs) the quote
 * (in real life, via POST /quotes/:id/accept from the public /q page;
 * in dev, via a "Simulate customer accepted" trigger button on the chat).
 *
 *   1. Verify the quote belongs to the conversation owner.
 *   2. If already accepted, short-circuit (idempotent).
 *   3. Flip quote.status = 'accepted' + stamp acceptedAt, emit
 *      `quote:accepted`.
 *   4. Bump conversation.updatedAt + set `hasUnreadEvent = true` and a
 *      preview line so the threads sidebar shows the badge and the
 *      conversation bubbles to the top.
 *   5. Append a phase_divider message to the chat so when the user
 *      opens the thread they see exactly what happened.
 *
 * The unread flag is *cleared* by LoadConversation on the next thread
 * read — that's what makes the badge disappear when the user opens it.
 */
@Injectable()
export class AcceptQuote {
  constructor(
    private conversations: AgentConversationStore,
    private messages: AgentMessageStore,
    private quotes: QuoteStore,
    private users: UserStore,
    private bus: EventBus,
    // REQ-563: optional so the hand-built coordinator (its own tests) runs
    // without them; the app injects both and registers on the port.
    private invoices?: InvoiceStore,
    port?: QuoteSignedPort,
  ) {
    port?.register((e) => this.recordSigned(e));
  }

  /**
   * REQ-563 (demo-loop cycle 4, m3): the customer signed on the public /q
   * page. Every thread of the owner's bound to that quote gets ONE system
   * divider naming who signed, the quote number and the invoice the
   * signature billed — "Linda Perez signed Q-001 · deposit INV-001 $1,425.00
   * sent" — in the owner's language, and the row carries the invoice (so the
   * list's chip and the header both read "Signed · Invoiced"), the unread
   * badge and the preview. The quote itself is already accepted and billed by
   * the public route; this only tells the chat. A replay is a no-op.
   */
  async recordSigned(e: QuoteSignedEvent): Promise<AgentMessage[]> {
    const quote = await this.quotes.getOwned(e.quoteId, e.userId);
    const convs = (await this.conversations.listByUser(e.userId, {
      limit: 1000,
    })).filter((c) => c.quoteId === quote.id);
    if (convs.length === 0) return [];
    const me = await this.users.get(e.userId).catch(() => null);
    const lang = me?.language === "es" ? "es" : "en";
    const invoice = e.invoiceId && this.invoices
      ? await this.invoices.getOwned(e.invoiceId, e.userId).catch(() => null)
      : null;
    // REQ-697 (demo-loop cycle 5, m22): "Payment upon completion" sends
    // nothing at signing — it schedules the bill and the owner is reminded to
    // send it. The line says which invoice, the reminder day and the due day.
    const scheduled = !invoice && e.scheduledInvoiceId && this.invoices
      ? await this.invoices.getOwned(e.scheduledInvoiceId, e.userId).catch(
        () => null,
      )
      : null;
    const billed = invoice ?? scheduled;
    // REQ-699 (demo-loop cycle 5, M20): a recurring quote bills no invoice at
    // signing — the divider says what Field → Subscriptions bills instead,
    // only when the signature did make that subscription.
    const recurring = !invoice && e.subscriptionId
      ? recurringFromTerms(quote.terms)
      : null;
    // REQ-712 (cycle 5, m7): the divider and the preview store their key
    // and vars (REQ-589's ChatI18nRef) so the island words them in the live
    // language; the text worded now is only the fallback. (The dates and the
    // recurring billing are worded in the language of the moment.)
    const vars: Record<string, ChatI18nVar> = {
      name: quote.acceptedName?.trim() || { key: "acceptQuote.signed.someone" },
      quote: quote.number?.trim() || { key: "acceptQuote.signed.theQuote" },
      invoice: billed?.number ?? "",
      amount: fmtUSD(billed?.amount),
      date: shortDate(scheduled?.scheduledFor, lang),
      due: shortDate(scheduled?.dueDate, lang),
      billing: recurring ? recurringTermText(recurring, lang) : "",
    };
    const key = scheduled?.scheduledFor
      ? "acceptQuote.signed.scheduled"
      : !invoice
      ? recurring ? "acceptQuote.signed.recurring" : "acceptQuote.signed.plain"
      : (invoice.installmentTotal ?? 1) > 1
      ? "acceptQuote.signed.deposit"
      : "acceptQuote.signed.invoice";
    const i18n: ChatI18nRef = { key, vars };
    const tr = (
      l: "en" | "es",
      k: string,
      v?: Record<string, string | number>,
    ) => t(l, k, v);
    const label = renderChatI18n(i18n, lang, tr);
    const previewI18n: ChatI18nRef = {
      key: "acceptQuote.signed.preview",
      vars: { label: i18n },
    };
    const out: AgentMessage[] = [];
    for (const conv of convs) {
      const prior = await this.messages.listByConversation(conv.id);
      if (
        prior.some((m) =>
          m.kind === "phase_divider" && m.payload?.signed === true &&
          m.payload?.quoteId === quote.id
        )
      ) continue;
      out.push(
        await this.messages.append({
          conversationId: conv.id,
          role: "system",
          kind: "phase_divider",
          content: label,
          payload: {
            phase: 4,
            label,
            i18n,
            quoteId: quote.id,
            signed: true,
            ...(invoice
              ? { invoiceId: invoice.id, invoiceStatus: invoice.status }
              : {}),
            ...(scheduled ? { scheduledInvoiceId: scheduled.id } : {}),
          },
        }),
      );
      await this.conversations.update(conv.id, {
        hasUnreadEvent: true,
        quoteStatus: "accepted",
        preview: renderChatI18n(previewI18n, lang, tr),
        previewI18n,
        ...(invoice
          ? { invoiceId: invoice.id, invoiceStatus: invoice.status }
          : {}),
      });
    }
    return out;
  }

  async run(input: AcceptQuoteInput): Promise<AcceptQuoteResult> {
    const conv = await this.conversations.get(input.conversationId);
    if (conv.userId !== input.userId) throw new Error("forbidden");
    if (conv.quoteId !== input.quoteId) {
      throw new Error("quoteId does not match this conversation's quote");
    }

    // Resolve the contractor's UI language so the chat divider / CTA copy
    // reads in their language (matches handle-chat-message's resolution).
    const me = await this.users.get(input.userId).catch(() => null);
    const lang = me?.language === "es" ? "es" : "en";

    const quote = await this.quotes.getOwned(input.quoteId, input.userId);
    const wasAlreadyAccepted = isAccepted(quote);

    if (!wasAlreadyAccepted) {
      await this.quotes.update(quote.id, input.userId, {
        status: "accepted",
        acceptedAt: new Date().toISOString(),
      });
      await this.bus.emit({
        userId: input.userId,
        entityType: "quote",
        entityId: quote.id,
        action: "accepted",
      });
    }

    const note = await this.messages.append({
      conversationId: conv.id,
      role: "system",
      kind: "phase_divider",
      content: t(lang, "acceptQuote.dividerLabel"),
      payload: {
        phase: 4,
        label: t(lang, "acceptQuote.dividerLabel"),
        quoteId: quote.id,
      },
    });

    // Per the quote → invoice chain, customer acceptance of the agreement
    // is the user's prompt to draft + send the invoice.
    const cta = await this.messages.append({
      conversationId: conv.id,
      role: "assistant",
      kind: "continue_cta",
      content: t(lang, "acceptQuote.cta.label"),
      payload: {
        toPhase: "invoice",
        quoteId: quote.id,
        summary: t(lang, "acceptQuote.cta.summary"),
      },
    });

    const updatedConv = await this.conversations.update(conv.id, {
      hasUnreadEvent: true,
      quoteStatus: "accepted",
      preview: `✓ ${t(lang, "acceptQuote.dividerLabel")}`,
    });

    return { conversation: updatedConv, newMessages: [note, cta] };
  }
}

/** "$1,425.00" from integer cents (the signed confirmation's format). */
function fmtUSD(cents: number | undefined): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "";
  return `$${
    (cents / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }`;
}
