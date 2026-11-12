import { Injectable } from "#danet/core";
import { type Lang, t } from "@core/i18n/mod.ts";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { SendChangeOrderAlert } from "@paperwork/domain/coordinators/send-change-order-alert/mod.ts";
import { isChangeOrderMutable } from "#quote-flow/adjustment-guards.ts";
import {
  editedChangeOrderDelta,
  reconcileChangeOrderAmount,
  sameDocNumber,
} from "@agents/domain/business/change-order-intent/mod.ts";
import type { ChangeOrder } from "@paperwork/dto/change-order.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";
import type { Quote } from "@paperwork/dto/quote.ts";

export interface ChatChangeOrderEditInput {
  userId: string;
  lang: Lang;
  /** "CO-001" (any case, any zero padding). */
  changeOrderNumber: string;
  /** The order's new wording. */
  description?: string;
  /** The order's NEW amount in cents (not a difference). */
  amountCents?: number;
  withdraw?: boolean;
  /** What the contractor typed: the amount is checked against its dollars
   *  (REQ-377) and it alone may flip a credit into a charge or back. */
  userText?: string;
}

interface NamedOrder {
  changeOrderId: string;
  number: string;
  invoiceId: string;
  quoteId?: string;
  quoteNumber?: string;
}

export type ChatChangeOrderEditOutcome =
  | (NamedOrder & { kind: "updated"; version: number })
  | (NamedOrder & { kind: "withdrawn" })
  /** approved by the customer — never changed (P-41) */
  | (NamedOrder & { kind: "approved" })
  | (NamedOrder & { kind: "no_change" })
  /** the amount fits nothing typed, or is $0 — asks, writes nothing */
  | (NamedOrder & { kind: "needs_amount" })
  /** nothing said what changes — asks, writes nothing */
  | (NamedOrder & { kind: "ask" })
  | { kind: "none"; number: string };

export interface ChatChangeOrderEditResult {
  /** The assistant's reply, in the contractor's language. */
  text: string;
  outcome: ChatChangeOrderEditOutcome;
}

/** "+$1,000.00" / "−$50.00" — a change order's amount, its direction shown. */
function signedMoney(cents: number): string {
  const sign = cents < 0 ? "−" : "+";
  return `${sign}$${
    (Math.abs(cents) / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }`;
}

interface Linked {
  quote?: Quote;
  invoice?: Invoice;
}

/**
 * UpdateChatChangeOrder — REQ-462 (demo-loop cycle 3, M26). "Change of plan
 * on CO-001: make it $1,000 and the description should just say "…"" edits
 * THAT change order from the assistant, the way the invoices page's Adjust
 * does (PUT /invoices/:id/change-orders/:coId): the edit is the order's next
 * version, back to pending with the invoice's live total re-snapshotted, and
 * the approval alert goes out again; "withdraw CO-001" deletes it (DELETE).
 * A customer-approved order never changes (P-41) — the difference is a new
 * change order. The invoice itself only moves when the customer approves.
 */
@Injectable()
export class UpdateChatChangeOrder {
  constructor(
    private changeOrders: ChangeOrderStore,
    private invoices: InvoiceStore,
    private quotes: QuoteStore,
    private alert: SendChangeOrderAlert,
  ) {}

  private async find(
    userId: string,
    number: string,
  ): Promise<ChangeOrder | undefined> {
    const all = await this.changeOrders.listByUser(userId).catch(
      () => [] as ChangeOrder[],
    );
    return all.find((co) => !!co.number && sameDocNumber(co.number, number));
  }

  private async linked(co: ChangeOrder, userId: string): Promise<Linked> {
    const [invoice, quote] = await Promise.all([
      this.invoices.getOwned(co.invoiceId, userId).catch(() => undefined),
      co.quoteId
        ? this.quotes.getOwned(co.quoteId, userId).catch(() => undefined)
        : Promise.resolve(undefined),
    ]);
    return { invoice, quote };
  }

  private named(co: ChangeOrder, typed: string, l: Linked): NamedOrder {
    const quoteId = l.quote?.id ?? co.quoteId;
    return {
      changeOrderId: co.id,
      number: co.number ?? typed.toUpperCase(),
      invoiceId: co.invoiceId,
      ...(quoteId ? { quoteId } : {}),
      ...(l.quote?.number ? { quoteNumber: l.quote.number } : {}),
    };
  }

  /** "Q-001 Bathroom Remodel" — else the invoice's number. */
  private jobOf(l: Linked, lang: Lang): string {
    const q = l.quote;
    const label = q
      ? [q.number, q.jobName || q.summary].filter(Boolean).join(" ")
      : "";
    return label || l.invoice?.number ||
      t(lang, "chatCoordinator.changeOrderEdit.theJob");
  }

  async run(
    input: ChatChangeOrderEditInput,
  ): Promise<ChatChangeOrderEditResult> {
    const { userId, lang } = input;
    const co = await this.find(userId, input.changeOrderNumber);
    if (!co) {
      const number = input.changeOrderNumber.toUpperCase();
      return {
        text: t(lang, "chatCoordinator.changeOrderEdit.none", { number }),
        outcome: { kind: "none", number },
      };
    }
    const l = await this.linked(co, userId);
    const named = this.named(co, input.changeOrderNumber, l);
    const name = co.customerSnapshot?.name ||
      t(lang, "chatCoordinator.changeOrder.theCustomer");
    const vars = {
      number: named.number,
      job: this.jobOf(l, lang),
      description: co.description,
      amount: signedMoney(co.deltaAmountCents),
      name,
    };

    // P-41: the customer signed off on that exact wording and amount.
    if (!isChangeOrderMutable(co)) {
      return {
        text: t(lang, "chatCoordinator.changeOrderEdit.approved", {
          ...vars,
          name: co.approvedName || name,
        }),
        outcome: { kind: "approved", ...named },
      };
    }

    if (input.withdraw) {
      await this.changeOrders.delete(co.id, userId);
      return {
        text: t(lang, "chatCoordinator.changeOrderEdit.withdrawn", vars),
        outcome: { kind: "withdrawn", ...named },
      };
    }

    const newWording = input.description?.trim() ?? "";
    const hasAmount = typeof input.amountCents === "number" &&
      Number.isFinite(input.amountCents);
    if (!newWording && !hasAmount) {
      return {
        text: t(lang, "chatCoordinator.changeOrderEdit.askWhat", vars),
        outcome: { kind: "ask", ...named },
      };
    }

    let delta = co.deltaAmountCents;
    if (hasAmount) {
      const check = input.userText
        ? reconcileChangeOrderAmount({
          amountCents: input.amountCents!,
          currentCents: co.deltaAmountCents,
          userText: input.userText,
        })
        : {
          kind: "ok" as const,
          amountCents: Math.abs(Math.round(input.amountCents!)),
        };
      if (check.kind === "ask" || check.amountCents === 0) {
        return {
          text: t(lang, "chatCoordinator.changeOrderEdit.askAmount", vars),
          outcome: { kind: "needs_amount", ...named },
        };
      }
      // the order keeps its direction unless the contractor said otherwise
      delta = editedChangeOrderDelta({
        currentCents: co.deltaAmountCents,
        amountCents: check.amountCents,
        userText: input.userText ?? "",
      });
    }
    const description = newWording || co.description;
    if (description === co.description && delta === co.deltaAmountCents) {
      return {
        text: t(lang, "chatCoordinator.changeOrderEdit.noChange", vars),
        outcome: { kind: "no_change", ...named },
      };
    }

    // The same edit the invoices page makes: re-pend as the next version,
    // re-snapshot the invoice's live total, re-alert.
    const updated = await this.changeOrders.update(co.id, userId, {
      description,
      deltaAmountCents: delta,
      originalAmountCents: l.invoice?.amount ?? co.originalAmountCents ?? 0,
    });
    this.alert.run(updated.id).catch((err) =>
      console.error(
        `[chat:update_change_order] alert failed for ${co.id}:`,
        err,
      )
    );
    const version = updated.version ?? 1;
    return {
      text: t(lang, "chatCoordinator.changeOrderEdit.updated", {
        ...vars,
        description,
        amount: signedMoney(delta),
        version,
      }),
      outcome: { kind: "updated", ...named, version },
    };
  }

  /**
   * The model's context for the change orders a message names: each one's
   * state, amount, wording, invoice and job, and how to change it — or that
   * the account has no such order. Undefined when it names none.
   */
  async context(
    userId: string,
    numbers: readonly string[],
  ): Promise<string | undefined> {
    if (numbers.length === 0) return undefined;
    const lines: string[] = [];
    for (const typed of numbers) {
      const co = await this.find(userId, typed);
      if (!co) {
        lines.push(
          t("en", "prompts.changeOrderEdit.missing", {
            number: typed.toUpperCase(),
          }),
        );
        continue;
      }
      const l = await this.linked(co, userId);
      lines.push(
        t("en", "prompts.changeOrderEdit.context", {
          number: co.number ?? typed.toUpperCase(),
          state: co.status,
          amount: signedMoney(co.deltaAmountCents),
          description: co.description,
          invoice: l.invoice?.number ?? co.invoiceId,
          job: this.jobOf(l, "en"),
        }),
      );
    }
    return lines.join("\n");
  }
}
