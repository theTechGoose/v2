import { Injectable } from "#danet/core";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { ContractStore } from "@paperwork/domain/data/contract-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { EmailService, type SendEmailResult } from "@communication/domain/data/email-service/mod.ts";
import type { Quote } from "@paperwork/dto/quote.ts";
import type { Contract } from "@paperwork/dto/contract.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";

export type PaperworkKind = "quote" | "contract" | "invoice";

export interface SendPaperworkEmailInput {
  kind: PaperworkKind;
  resourceId: string;
  /** Optional override; otherwise resolved from the linked customer. */
  to?: string;
  /** Optional sender override (else falls back to POSTMARK_FROM env). */
  from?: string;
}

export interface SendPaperworkEmailResult extends SendEmailResult {
  /** Address the dispatch was actually sent to (after resolution). */
  to: string;
  subject: string;
}

/**
 * SendPaperworkEmail — render + dispatch a quote/contract/invoice email.
 *
 * Resolves the recipient from the resource's `customerId` if `to` is
 * omitted. Renders a minimal HTML body server-side; richer templates
 * can replace `render*` without touching the dispatch path.
 *
 * Per-user scoped via `getOwned(id, userId)`. If the resource doesn't
 * belong to the calling user, the store throws ForbiddenError before
 * EmailService is even invoked.
 */
@Injectable()
export class SendPaperworkEmail {
  constructor(
    private quotes: QuoteStore,
    private contracts: ContractStore,
    private invoices: InvoiceStore,
    private customers: CustomerStore,
    private email: EmailService,
  ) {}

  async run(userId: string, input: SendPaperworkEmailInput): Promise<SendPaperworkEmailResult> {
    let subject: string;
    let htmlBody: string;
    let recipient: string | undefined = input.to;

    let quoteForStamp: Quote | undefined;
    if (input.kind === "quote") {
      const quote = await this.quotes.getOwned(input.resourceId, userId);
      if (!recipient) recipient = await this.resolveCustomerEmail(userId, quote.customerId);
      subject = renderQuoteSubject(quote);
      htmlBody = renderQuoteHtml(quote);
      quoteForStamp = quote;
    } else if (input.kind === "contract") {
      const contract = await this.contracts.getOwned(input.resourceId, userId);
      if (!recipient) recipient = await this.resolveCustomerEmail(userId, contract.customerId);
      subject = renderContractSubject(contract);
      htmlBody = renderContractHtml(contract);
    } else {
      const invoice = await this.invoices.getOwned(input.resourceId, userId);
      if (!recipient) recipient = await this.resolveCustomerEmail(userId, invoice.customerId);
      subject = renderInvoiceSubject(invoice);
      htmlBody = renderInvoiceHtml(invoice);
    }

    if (!recipient) {
      return { ok: false, reason: "no recipient: pass `to` or attach a customer with an email", to: "", subject };
    }

    const result = await this.email.send({ to: recipient, subject, htmlBody, from: input.from });

    // Stamp the quote's lifecycle: status→"sent" + sentAt→now (idempotent — only if not already set).
    // Mirrors the public-controller's accept-time stamping and powers the /quotes stage derivation.
    if (result.ok && input.kind === "quote" && quoteForStamp && !quoteForStamp.sentAt) {
      await this.quotes.update(input.resourceId, userId, {
        status: "sent",
        sentAt: new Date().toISOString(),
      });
    }

    return { ...result, to: recipient, subject };
  }

  private async resolveCustomerEmail(userId: string, customerId: string | undefined): Promise<string | undefined> {
    if (!customerId) return undefined;
    try {
      const customer = await this.customers.getOwned(customerId, userId);
      return customer.email ?? undefined;
    } catch {
      return undefined;
    }
  }
}

function renderQuoteSubject(q: Quote): string {
  return `Quote: ${q.summary}`;
}

function renderQuoteHtml(q: Quote): string {
  const total = typeof q.estimatedTotal === "number" ? `$${q.estimatedTotal.toFixed(2)}` : "—";
  const rows = q.lineItems.map((li) =>
    `<tr><td>${escapeHtml(li.description)}</td><td>${li.quantity} ${escapeHtml(li.unit)}</td><td>$${li.price.toFixed(2)}</td></tr>`
  ).join("");
  return `
<h2>${escapeHtml(q.summary)}</h2>
<p>Estimated total: <strong>${total}</strong></p>
<table border="1" cellpadding="6" cellspacing="0">
  <thead><tr><th>Description</th><th>Qty</th><th>Unit price</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<p><a href="#" data-quote-id="${q.id}">View &amp; accept this quote</a></p>
`.trim();
}

function renderContractSubject(c: Contract): string {
  return `Contract ready for signature (${c.id.slice(0, 8)})`;
}

function renderContractHtml(c: Contract): string {
  const total = typeof c.totalAmount === "number" ? `$${c.totalAmount.toFixed(2)}` : "—";
  return `
<h2>Your contract is ready</h2>
<p>Contract: <strong>${c.id}</strong></p>
<p>Status: ${escapeHtml(c.status ?? "draft")}</p>
<p>Total: <strong>${total}</strong></p>
<p><a href="#" data-contract-id="${c.id}">Review &amp; sign</a></p>
`.trim();
}

function renderInvoiceSubject(i: Invoice): string {
  return `Invoice ${i.id.slice(0, 8)} — due ${i.dueDate}`;
}

function renderInvoiceHtml(i: Invoice): string {
  const amount = typeof i.amount === "number" ? `$${i.amount.toFixed(2)}` : "—";
  return `
<h2>Invoice ${escapeHtml(i.id.slice(0, 8))}</h2>
<p>Amount due: <strong>${amount}</strong></p>
<p>Due date: ${escapeHtml(i.dueDate)}</p>
<p>Status: ${escapeHtml(i.status ?? "pending")}</p>
<p><a href="#" data-invoice-id="${i.id}">Pay this invoice</a></p>
`.trim();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default:  return "&#39;";
    }
  });
}
