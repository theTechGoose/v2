import { Injectable } from "#danet/core";
import { type Lang, t } from "@core/i18n/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import { SendChangeOrderAlert } from "@paperwork/domain/coordinators/send-change-order-alert/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import {
  isInvoiceLocked,
  isQuoteIssued,
  isQuoteLocked,
} from "#documents/versions.ts";
import { pickChangeOrderTarget } from "@agents/domain/business/change-order-intent/mod.ts";
import type { Quote } from "@paperwork/dto/quote.ts";

export interface ChatChangeOrderInput {
  userId: string;
  lang: Lang;
  /** The conversation's bound quote, if any. */
  boundQuoteId?: string;
  customerName?: string;
  description: string;
  /** Signed INTEGER CENTS. */
  deltaAmountCents: number;
}

export type ChatChangeOrderOutcome =
  | {
    kind: "change_order";
    quoteId: string;
    invoiceId: string;
    changeOrderId: string;
  }
  | { kind: "pending_revision"; quoteId: string }
  | { kind: "draft_updated"; quoteId: string }
  | { kind: "needs_invoice"; quoteId: string }
  | { kind: "ambiguous"; quoteIds: string[] }
  | { kind: "none" }
  | { kind: "ask_customer" };

export interface ChatChangeOrderResult {
  /** The assistant's reply, in the contractor's language. */
  text: string;
  outcome: ChatChangeOrderOutcome;
}

type LineItem = Quote["lineItems"][number];

function money(cents: number): string {
  const sign = cents < 0 ? "−" : "";
  return `${sign}$${
    (Math.abs(cents) / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }`;
}

function totalOf(items: LineItem[]): number {
  return items.reduce((s, l) => s + (l.price ?? 0) * (l.quantity ?? 1), 0);
}

/**
 * ApplyChatChangeOrder — REQ-238 (demo M27). "Change order for Maria: add
 * fridge cleaning $40" changes Maria's EXISTING job; it never drafts a new
 * quote. Which change it becomes depends on where that job is:
 *
 *   - it has an open invoice  → a pending change order on that invoice
 *     (the customer approves it at /co/:id; the contractor is alerted with
 *     the link) — the same thing the invoice page's "Change order" makes;
 *   - its quote is a draft    → the line is added to the draft;
 *   - its quote is issued but unsigned → a pending revision (REQ-201) the
 *     contractor publishes with "Publish revision";
 *   - its quote is signed with no invoice → nothing is written; the reply
 *     says to invoice it first (a signed quote is locked, REQ-202).
 *
 * Several matching quotes → a clarifying question; none → says so.
 */
@Injectable()
export class ApplyChatChangeOrder {
  constructor(
    private quotes: QuoteStore,
    private invoices: InvoiceStore,
    private changeOrders: ChangeOrderStore,
    private customers: CustomerStore,
    private alert: SendChangeOrderAlert,
  ) {}

  async run(input: ChatChangeOrderInput): Promise<ChatChangeOrderResult> {
    const { userId, lang, description } = input;
    const delta = Math.trunc(input.deltaAmountCents);
    const [quotes, customers] = await Promise.all([
      this.quotes.listByUser(userId),
      this.customers.listByUser(userId),
    ]);
    const nameOf = (q: Quote): string => {
      const c = customers.find((c) => c.id === q.customerId);
      return c?.name ?? q.customerSnapshot?.name ?? "";
    };
    const labelOf = (q: Quote): string =>
      [q.number, q.jobName || q.summary].filter(Boolean).join(" ");

    const target = pickChangeOrderTarget({
      quotes: quotes.map((q) => ({
        id: q.id,
        customerId: q.customerId,
        status: q.status,
        createdAt: q.createdAt,
      })),
      customers: customers.map((c) => ({ id: c.id, name: c.name })),
      customerName: input.customerName,
      boundQuoteId: input.boundQuoteId,
    });

    if (target.kind === "ask_customer") {
      return {
        text: t(lang, "chatCoordinator.changeOrder.askCustomer"),
        outcome: target,
      };
    }
    if (target.kind === "none") {
      return {
        text: t(lang, "chatCoordinator.changeOrder.none", {
          name: input.customerName ?? "",
        }),
        outcome: target,
      };
    }
    if (target.kind === "ambiguous") {
      const list = target.quoteIds
        .map((id) => quotes.find((q) => q.id === id)!)
        .map((q) =>
          `• ${labelOf(q)} — ${nameOf(q)} (${
            money(q.estimatedTotal ?? totalOf(q.lineItems ?? []))
          })`
        )
        .join("\n");
      return {
        text: t(lang, "chatCoordinator.changeOrder.ambiguous", { list }),
        outcome: target,
      };
    }

    const quote = quotes.find((q) => q.id === target.quoteId)!;
    const vars = {
      description,
      amount: money(delta),
      job: labelOf(quote),
      name: nameOf(quote) || t(lang, "chatCoordinator.changeOrder.theCustomer"),
    };

    // 1) An open invoice for this job → a change order on it.
    const invoice = (await this.invoices.listByUser(userId))
      .filter((i) => i.quoteId === quote.id && !isInvoiceLocked(i))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (invoice) {
      const co = await this.changeOrders.create(userId, invoice.id, {
        description,
        deltaAmountCents: delta,
        quoteId: quote.id,
        ...(invoice.customerId ?? quote.customerId
          ? { customerId: invoice.customerId ?? quote.customerId }
          : {}),
        originalAmountCents: invoice.amount ?? 0,
      });
      this.alert.run(co.id).catch((err) =>
        console.error(`[chat:change_order] alert failed for ${co.id}:`, err)
      );
      return {
        text: t(lang, "chatCoordinator.changeOrder.created", vars),
        outcome: {
          kind: "change_order",
          quoteId: quote.id,
          invoiceId: invoice.id,
          changeOrderId: co.id,
        },
      };
    }

    // 2) Signed and not invoiced: locked (REQ-202), and a change order needs an invoice.
    if (isQuoteLocked(quote)) {
      return {
        text: t(lang, "chatCoordinator.changeOrder.needsInvoice", vars),
        outcome: { kind: "needs_invoice", quoteId: quote.id },
      };
    }

    const line: LineItem = {
      description,
      quantity: 1,
      unit: "ea",
      price: delta,
    };

    // 3) Issued, unsigned → the next revision (REQ-201), published by the contractor.
    if (isQuoteIssued(quote)) {
      const base =
        (quote.pendingRevision?.lineItems as LineItem[] | undefined) ??
          quote.lineItems ?? [];
      const lineItems = [...base, line];
      await this.quotes.setPending(quote.id, userId, {
        lineItems,
        estimatedTotal: totalOf(lineItems),
      });
      return {
        text: t(lang, "chatCoordinator.changeOrder.pendingRevision", vars),
        outcome: { kind: "pending_revision", quoteId: quote.id },
      };
    }

    // 4) A draft → the line lands on it.
    const lineItems = [...(quote.lineItems ?? []), line];
    await this.quotes.update(quote.id, userId, {
      lineItems,
      estimatedTotal: totalOf(lineItems),
    });
    return {
      text: t(lang, "chatCoordinator.changeOrder.draftUpdated", vars),
      outcome: { kind: "draft_updated", quoteId: quote.id },
    };
  }
}
