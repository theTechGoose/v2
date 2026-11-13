import { Injectable } from "#danet/core";
import { type Lang, t } from "@core/i18n/mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { SendPaperworkEmail } from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
import { SendPaperworkSms } from "@paperwork/domain/coordinators/send-paperwork-sms/mod.ts";
import { RecordPaymentFromUtterance } from "@paperwork/domain/coordinators/record-payment-from-utterance/mod.ts";
import { SendInvoice } from "@agents/domain/coordinators/send-invoice/mod.ts";
import {
  AnswerBilling,
  invoiceCardMessage,
} from "@agents/domain/coordinators/answer-billing/mod.ts";
import { invoiceCard } from "@agents/domain/business/chat-answers/mod.ts";
import {
  balanceOf,
  isUnsentInvoice,
  namedCustomer,
  type PaymentReport,
  pickPaymentInvoice,
  unsentInvoiceOf,
} from "@agents/domain/business/chat-billing-intent/mod.ts";
import { sameDocNumber } from "@agents/domain/business/invoice-removal-intent/mod.ts";
import { derivePreview } from "@agents/domain/business/conversation-title/mod.ts";
import { formatShortDate } from "#quote-flow/format-helpers.ts";
import {
  type ChannelResult,
  interpretSendResult,
  invoiceNotDeliveredCopy,
} from "#quote-flow/send-result.ts";
import { isAccepted } from "#quote-flow/quote-status.ts";
import type { AgentConversation } from "@agents/dto/conversation.ts";
import type { AgentMessage } from "@agents/dto/message.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";

export interface ChatBillingResult {
  conversation: AgentConversation;
  newMessages: AgentMessage[];
}

export type SendChannel = "email" | "text";

/** One channel's attempt: delivered or not, and why (as the Invoices page
 *  reads it — REQ-480's "not delivered" copy). */
interface Delivery {
  ok: boolean;
  result: ChannelResult;
}

/** "$1,425" — cents only when there are any ("$1,200.50"). */
function money(cents: number): string {
  const dollars = cents / 100;
  return "$" + dollars.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(dollars) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/** Nothing to send to on that channel (no email / phone on file) — not a
 *  failure worth a sentence when the other channel delivered. */
function missingRecipient(r: ChannelResult): boolean {
  return /^no recipient\b/i.test(r.rawReason?.trim() ?? "");
}

/**
 * ChatBilling — REQ-583 (demo-loop cycle 4, run r857a9d67, M2): the chat
 * sends the invoice and records the payment it is told about.
 *
 * The demo's assistant could do neither: "send it to her now please" got
 * "I can't send the invoice directly…" (pair 3), "Mándala ahora por favor"
 * got "No puedo enviar la factura ahora…" (pair 9), and "Linda paid the
 * deposit $1,425 by Zelle today" (pair 1) / "she paid the deposit by check"
 * (pair 7) recorded nothing. HandleChatMessage calls this for the words it
 * reads in code and for the model's send_invoice / record_payment tools.
 *
 *   send          — an invoice not sent yet (scheduled / drafted) goes out by
 *                   email and text through SendPaperworkEmail /
 *                   SendPaperworkSms, which stamp it "sent" only once a
 *                   channel delivered (REQ-480). The reply says what went
 *                   where — or, nothing delivered, why, and that it is still
 *                   scheduled (its card keeps Send now). A signed job with
 *                   nothing billed yet is billed by SendInvoice (the
 *                   "Continue to invoice" path).
 *   recordPayment — the invoice the payment is for (its number, deposit /
 *                   balance, the amount, or the only one still owed — never
 *                   a guess between two: it asks), recorded through
 *                   ConfirmPayment (payment row, receipt, paid / still
 *                   owed). The reply says what is still owed and shows the
 *                   job's next invoice not sent yet, with Send now.
 */
@Injectable()
export class ChatBilling {
  constructor(
    private conversations: AgentConversationStore,
    private messages: AgentMessageStore,
    private quotes: QuoteStore,
    private invoices: InvoiceStore,
    private customers: CustomerStore,
    private emailer: SendPaperworkEmail,
    private texter: SendPaperworkSms,
    private recorder: RecordPaymentFromUtterance,
    private sendInvoice: SendInvoice,
  ) {}

  /** The invoices of the conversation's job; [] when none is bound. */
  async invoicesOf(
    userId: string,
    quoteId: string | undefined,
  ): Promise<Invoice[]> {
    if (!quoteId) return [];
    return (await this.listInvoices(userId)).filter((i) =>
      i.quoteId === quoteId
    );
  }

  // -------------------------------------------------------------------------
  // Send
  // -------------------------------------------------------------------------

  /**
   * Send an invoice now: the one named (id or number), else the
   * conversation's job's first one not sent yet. `channel` limits it to
   * email or text ("text it to her").
   */
  async send(input: {
    userId: string;
    conversation: AgentConversation;
    lang: Lang;
    invoiceId?: string;
    invoiceNumber?: string;
    channel?: SendChannel;
  }): Promise<ChatBillingResult> {
    const { userId, lang } = input;
    const conv = input.conversation;
    const all = await this.listInvoices(userId);
    let inv: Invoice | undefined;
    if (input.invoiceId) {
      inv = all.find((i) => i.id === input.invoiceId);
    } else if (input.invoiceNumber) {
      inv = all.find((i) =>
        typeof i.number === "string" &&
        sameDocNumber(i.number, input.invoiceNumber!)
      );
    } else if (conv.quoteId) {
      const own = all.filter((i) => i.quoteId === conv.quoteId);
      inv = unsentInvoiceOf(own);
      if (!inv) {
        // Signed with nothing billed yet: bill it ("Continue to invoice").
        const quote = await this.quotes.getOwned(conv.quoteId, userId)
          .catch(() => undefined);
        const live = own.filter((i) => i.status !== "void");
        if (quote && isAccepted(quote) && live.length === 0) {
          return await this.sendInvoice.run({
            userId,
            conversationId: conv.id,
            language: lang,
          });
        }
        // Everything billed already went out: where the bill stands.
        const answered = await new AnswerBilling(
          this.conversations,
          this.messages,
          this.quotes,
          this.invoices,
        ).run({ userId, conversation: conv, lang });
        if (answered) return answered;
      }
    }

    if (!inv || inv.status === "void") {
      const number = input.invoiceNumber?.trim();
      return await this.reply(
        conv,
        number
          ? t(lang, "chatCoordinator.sendInvoice.notFound", { number })
          : t(lang, "chatCoordinator.sendInvoice.which"),
      );
    }
    const number = inv.number ?? input.invoiceNumber ?? "";
    if (inv.status === "paid") {
      return await this.reply(
        conv,
        t(lang, "chatCoordinator.sendInvoice.alreadyPaid", { number }),
      );
    }

    const email = input.channel === "text"
      ? undefined
      : await this.deliver("email", userId, inv.id);
    // REQ-770 (demo-loop cycle 5v5, m12): on an email + text send, a number
    // that can't take texts (the reserved 555 block — the send dialog already
    // says so, REQ-569/681) is not texted at all once the email went: the
    // reply says "not texted: <reason>", never "The text didn't go". A
    // text-only send, or one whose email failed too, still reports it.
    const skipText = !input.channel && !!email?.ok &&
      await this.texter.recipientCantText(userId, {
        kind: "invoice",
        resourceId: inv.id,
      }).catch(() => false);
    // REQ-784 (demo-loop dv1, d12): the skipped text is in the outbox —
    // "not sent" and why — next to the email that went.
    if (skipText) {
      await this.texter.noteSkipped(userId, {
        kind: "invoice",
        resourceId: inv.id,
      }, t(lang, "sms.fictionalNumber"));
    }
    const text = input.channel === "email" || skipText
      ? undefined
      : await this.deliver("text", userId, inv.id);
    const fresh = await this.invoices.getOwned(inv.id, userId)
      .catch(() => inv!);
    const name = await this.customerName(userId, fresh, lang);
    const amount = money(fresh.amount ?? 0);
    const card = invoiceCard(lang, fresh);
    const tried = [email, text].filter((d): d is Delivery => !!d);

    let said: string;
    if (tried.some((d) => d.ok)) {
      const channels = email?.ok && text?.ok
        ? "both"
        : email?.ok
        ? "email"
        : "text";
      const due = fresh.dueDate ? formatShortDate(fresh.dueDate, lang) : "";
      const parts = [
        t(
          lang,
          due
            ? "chatCoordinator.sendInvoice.sent"
            : "chatCoordinator.sendInvoice.sentNoDue",
          {
            number,
            amount,
            name,
            channels: t(
              lang,
              `chatCoordinator.sendInvoice.channel.${channels}`,
            ),
            due,
          },
        ),
      ];
      // REQ-030: one channel went, the other really failed — say so (a
      // channel with nothing on file to send to is not a failure).
      for (const [channel, d] of [["email", email], ["text", text]] as const) {
        if (!d || d.ok || missingRecipient(d.result)) continue;
        parts.push(t(lang, "chatCoordinator.sendInvoice.partial", {
          channel: t(lang, `chatCoordinator.sendInvoice.channel.${channel}`),
          reason: (d.result.rawReason ?? "unknown").replace(/[.\s]+$/, ""),
        }));
      }
      if (skipText) {
        parts.push(t(lang, "chatCoordinator.sendInvoice.notTexted", {
          reason: t(lang, "sms.fictionalNumber"),
        }));
      }
      said = parts.join(" ");
    } else {
      // Nothing delivered: the invoice's own honest copy (REQ-480), and it
      // stays scheduled / drafted with Send now on its card.
      const failure = email && text
        ? invoiceNotDeliveredCopy(
          (key, params) => t(lang, key, params),
          { number, email: email.result, text: text.result },
        )
        : t(lang, "chatCoordinator.sendInvoice.partial", {
          channel: t(
            lang,
            `chatCoordinator.sendInvoice.channel.${input.channel ?? "email"}`,
          ),
          reason: (tried[0]?.result.rawReason ?? "unknown").replace(
            /[.\s]+$/,
            "",
          ),
        });
      const still = !isUnsentInvoice(fresh) ? "" : t(
        lang,
        fresh.status === "draft"
          ? "chatCoordinator.sendInvoice.stillDraft"
          : "chatCoordinator.sendInvoice.stillScheduled",
      );
      said = [`${failure.replace(/[.\s]+$/, "")}.`, still].filter(Boolean)
        .join(" ");
    }

    const newMessages = [
      await this.messages.append({
        conversationId: conv.id,
        role: "assistant",
        kind: "text",
        content: said,
      }),
      await this.messages.append(
        invoiceCardMessage(conv.id, card, {
          quoteId: fresh.quoteId,
          customerId: fresh.customerId,
        }),
      ),
    ];
    const conversation = await this.conversations.update(conv.id, {
      preview: derivePreview(said),
      ...this.bindTo(conv, fresh),
    });
    return { conversation, newMessages };
  }

  // -------------------------------------------------------------------------
  // Payments
  // -------------------------------------------------------------------------

  /**
   * Record a payment the contractor reported. Which invoices it can be on:
   * the one numbered; else the named customer's, when the message names
   * someone other than the conversation's customer; else the conversation's
   * job's; else (nothing bound, nobody named) any of the contractor's whose
   * amount matches exactly.
   */
  async recordPayment(input: {
    userId: string;
    conversation: AgentConversation;
    lang: Lang;
    report: PaymentReport;
    /** The contractor's words — who paid, when no invoice is named. */
    text?: string;
    /** Read in code from the contractor's words: a payment that fits no
     *  invoice at all is not this path's to answer (undefined — the chat
     *  model reads the message). The model's own record_payment is
     *  answered either way. */
    fromWords?: boolean;
  }): Promise<ChatBillingResult | undefined> {
    const { userId, lang, report } = input;
    const conv = input.conversation;
    const all = await this.listInvoices(userId);
    const bound = conv.quoteId
      ? all.filter((i) => i.quoteId === conv.quoteId)
      : [];
    const boundCustomerId = conv.customerId ??
      bound.find((i) => i.customerId)?.customerId;
    const customers = report.invoiceNumber
      ? []
      : await this.customers.listByUser(userId).catch(() => []);
    const who = namedCustomer(customers, input.text ?? "");

    let pool: Invoice[];
    let amountMustMatch = false;
    if (report.invoiceNumber) {
      pool = all;
    } else if (who && who.id !== boundCustomerId) {
      pool = all.filter((i) => i.customerId === who.id);
    } else if (conv.quoteId) {
      pool = bound;
    } else {
      pool = all;
      amountMustMatch = true;
    }

    const pick = pickPaymentInvoice(pool, report, { amountMustMatch });
    const say = (key: string, vars: Record<string, string> = {}) =>
      t(lang, `chatCoordinator.payment.${key}`, vars);
    if (pick.kind === "none") {
      if (input.fromWords && !report.invoiceNumber) return undefined;
      return await this.reply(conv, say("none"));
    }
    if (pick.kind === "already_paid") {
      return await this.reply(
        conv,
        say("alreadyPaid", { number: pick.invoice.number ?? "" }),
      );
    }
    if (pick.kind === "ask") {
      const named = pick.candidates.map((i) =>
        `${i.number ?? ""} (${money(balanceOf(i))})`
      );
      const list = named.length > 1
        ? `${named.slice(0, -1).join(", ")} ${say("or")} ${named.at(-1)}`
        : named.join("");
      return await this.reply(conv, say("which", { list }));
    }

    const inv = pick.invoice;
    const number = inv.number ?? "";
    const recorded = await this.recorder.recordOn(userId, inv.id, {
      amountCents: pick.amountCents,
      method: report.method ?? "other",
      ...(report.reference ? { reference: report.reference } : {}),
    }).catch((err) => {
      console.error("[chat-billing] recording the payment failed:", err);
      return { ok: false };
    });
    if (!recorded.ok) return await this.reply(conv, say("failed", { number }));

    const after = await this.invoices.getOwned(inv.id, userId)
      .catch(() => inv);
    const owed = Math.max(0, (after.amount ?? 0) - (after.paidCents ?? 0));
    const name = await this.customerName(userId, after, lang);
    const via = report.method && report.method !== "other"
      ? say(`via.${report.method}`)
      : "";
    const parts = [
      say(
        owed > 0 && after.status !== "paid" ? "recordedPartial" : "recorded",
        {
          amount: money(pick.amountCents),
          via,
          name,
          number,
          balance: money(owed),
        },
      ).replace(/\s{2,}/g, " "),
    ];

    // The job's next invoice not sent yet: when it goes out, and Send now.
    const siblings = after.quoteId
      ? (await this.listInvoices(userId)).filter((i) =>
        i.quoteId === after.quoteId && i.id !== after.id
      )
      : [];
    const next = unsentInvoiceOf(siblings);
    if (next) {
      const when = next.scheduledFor ?? next.dueDate;
      parts.push(
        next.status === "scheduled" && when
          ? t(lang, "chatCoordinator.billing.next", {
            number: next.number ?? "",
            amount: money(next.amount ?? 0),
            date: formatShortDate(when, lang),
          })
          : t(lang, "chatCoordinator.billing.draftInvoice", {
            number: next.number ?? "",
            amount: money(next.amount ?? 0),
          }),
      );
    }
    const said = parts.join(" ");
    const newMessages = [
      await this.messages.append({
        conversationId: conv.id,
        role: "assistant",
        kind: "text",
        content: said,
      }),
    ];
    if (next && isUnsentInvoice(next)) {
      newMessages.push(
        await this.messages.append(
          invoiceCardMessage(conv.id, invoiceCard(lang, next), {
            quoteId: next.quoteId,
            customerId: next.customerId,
          }),
        ),
      );
    }
    const conversation = await this.conversations.update(conv.id, {
      preview: derivePreview(said),
      ...(!conv.quoteId && after.quoteId
        ? {
          quoteId: after.quoteId,
          ...(after.customerId && !conv.customerId
            ? { customerId: after.customerId }
            : {}),
        }
        : {}),
      // the threads list's chip follows the conversation's own invoice
      ...(conv.invoiceId === after.id ? { invoiceStatus: after.status } : {}),
    });
    return { conversation, newMessages };
  }

  // -------------------------------------------------------------------------

  private async listInvoices(userId: string): Promise<Invoice[]> {
    return await this.invoices.listByUser(userId).catch(() => []);
  }

  private async deliver(
    channel: SendChannel,
    userId: string,
    invoiceId: string,
  ): Promise<Delivery> {
    try {
      const r = channel === "email"
        ? await this.emailer.run(userId, {
          kind: "invoice",
          resourceId: invoiceId,
        })
        : await this.texter.run(userId, {
          kind: "invoice",
          resourceId: invoiceId,
        });
      return {
        ok: r.ok,
        result: {
          outcome: interpretSendResult({ httpOk: true, body: r }),
          ...(!r.ok && r.reason ? { rawReason: r.reason } : {}),
        },
      };
    } catch (err) {
      console.error(`[chat-billing] invoice ${channel} failed:`, err);
      return {
        ok: false,
        result: {
          outcome: { delivered: false, reason: "unknown" },
          rawReason: (err as Error)?.message || "dispatch failed",
        },
      };
    }
  }

  /** Who the invoice is for, as the bill names them. */
  private async customerName(
    userId: string,
    inv: Invoice,
    lang: Lang,
  ): Promise<string> {
    const onBill = inv.billTo?.name?.trim() ||
      inv.billTo?.businessName?.trim() ||
      inv.customerSnapshot?.name?.trim() ||
      inv.customerSnapshot?.businessName?.trim();
    if (onBill) return onBill;
    const customer = inv.customerId
      ? await this.customers.getOwned(inv.customerId, userId)
        .catch(() => undefined)
      : undefined;
    return customer?.name?.trim() ||
      t(lang, "chatCoordinator.payment.customerFallback");
  }

  /** The conversation follows the invoice it just sent: its own job's, or —
   *  no job bound yet — that invoice's job. Another job's leaves it be. */
  private bindTo(
    conv: AgentConversation,
    inv: Invoice,
  ): Partial<AgentConversation> {
    if (conv.quoteId && conv.quoteId !== inv.quoteId) return {};
    return {
      invoiceId: inv.id,
      invoiceStatus: inv.status,
      ...(!conv.quoteId && inv.quoteId ? { quoteId: inv.quoteId } : {}),
      ...(!conv.customerId && inv.customerId
        ? { customerId: inv.customerId }
        : {}),
    };
  }

  private async reply(
    conv: AgentConversation,
    text: string,
  ): Promise<ChatBillingResult> {
    const message = await this.messages.append({
      conversationId: conv.id,
      role: "assistant",
      kind: "text",
      content: text,
    });
    const conversation = await this.conversations.update(conv.id, {
      preview: derivePreview(text),
    });
    return { conversation, newMessages: [message] };
  }
}
