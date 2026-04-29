import { Injectable } from "#danet/core";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { ContractStore } from "@paperwork/domain/data/contract-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { EmailService, type SendEmailResult } from "@communication/domain/data/email-service/mod.ts";
import type { Quote } from "@paperwork/dto/quote.ts";
import type { Contract } from "@paperwork/dto/contract.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";
import type { Customer } from "@crm/dto/customer.ts";
import type { User } from "@users/dto/user.ts";

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
    private users: UserStore,
    private email: EmailService,
  ) {}

  async run(userId: string, input: SendPaperworkEmailInput): Promise<SendPaperworkEmailResult> {
    const sender = await this.tryGetUser(userId);

    let subject: string;
    let htmlBody: string;
    let recipient: string | undefined = input.to;

    let quoteForStamp: Quote | undefined;
    if (input.kind === "quote") {
      const quote = await this.quotes.getOwned(input.resourceId, userId);
      const customer = await this.tryGetCustomer(userId, quote.customerId);
      if (!recipient) recipient = customer?.email ?? undefined;
      subject = renderQuoteSubject(quote, sender);
      htmlBody = renderQuoteHtml(quote, customer, sender);
      quoteForStamp = quote;
    } else if (input.kind === "contract") {
      const contract = await this.contracts.getOwned(input.resourceId, userId);
      const customer = await this.tryGetCustomer(userId, contract.customerId);
      if (!recipient) recipient = customer?.email ?? undefined;
      subject = renderContractSubject(contract, sender);
      htmlBody = renderContractHtml(contract, customer, sender);
    } else {
      const invoice = await this.invoices.getOwned(input.resourceId, userId);
      const customer = await this.tryGetCustomer(userId, invoice.customerId);
      if (!recipient) recipient = customer?.email ?? undefined;
      subject = renderInvoiceSubject(invoice, sender);
      htmlBody = renderInvoiceHtml(invoice, customer, sender);
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

  private async tryGetCustomer(userId: string, customerId: string | undefined): Promise<Customer | undefined> {
    if (!customerId) return undefined;
    try { return await this.customers.getOwned(customerId, userId); }
    catch { return undefined; }
  }

  private async tryGetUser(userId: string): Promise<User | undefined> {
    try { return await this.users.get(userId); }
    catch { return undefined; }
  }
}

// ---------- shared shell + helpers -------------------------------------------

const APP_URL = Deno.env.get("APP_URL") ?? "http://localhost:5173";

const COLOR_TEAL  = "#144852";
const COLOR_GREEN = "#519843";
const COLOR_INK   = "#1c2c30";
const COLOR_MUTED = "#6b7a7e";
const COLOR_LINE  = "#e3e8e6";
const COLOR_BG    = "#f7f6f1";
const COLOR_CARD  = "#ffffff";

function senderName(u: User | undefined): string {
  return u?.name?.trim() || "your contractor";
}

function customerGreeting(c: Customer | undefined): string {
  const name = c?.name?.trim();
  return name ? `Hi ${escapeHtml(name)},` : "Hi there,";
}

function fmtUSD(amount: number | undefined): string {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "—";
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string | undefined): string {
  if (!iso) return "—";
  // Date-only ISO strings (YYYY-MM-DD) parse as UTC midnight, which
  // shifts a calendar day backward in negative-UTC timezones when run
  // through toLocaleDateString. Anchor to noon UTC so the displayed
  // calendar day matches the input regardless of server timezone.
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = new Date(isDateOnly ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(+d)) return iso;
  return d.toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

/** Wraps the per-doc body in a brand-consistent shell (header, sender block,
 *  CTA button row, footer). All inline-styled — Gmail/Outlook strip <style>. */
function shell(opts: {
  preheader: string;
  kind: "Quote" | "Contract" | "Invoice";
  docNumber: string;
  drafted: string;
  greeting: string;
  intro: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  sender: User | undefined;
}): string {
  const { preheader, kind, docNumber, drafted, greeting, intro, body, ctaLabel, ctaUrl, sender } = opts;
  const senderEmailLine = sender?.email
    ? `<div style="color:${COLOR_MUTED};font-size:13px;margin-top:2px"><a href="mailto:${escapeHtml(sender.email)}" style="color:${COLOR_MUTED};text-decoration:none">${escapeHtml(sender.email)}</a></div>`
    : "";
  const senderPhoneLine = sender?.phoneNumber
    ? `<div style="color:${COLOR_MUTED};font-size:13px;margin-top:2px">${escapeHtml(sender.phoneNumber)}</div>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>${escapeHtml(kind)} ${escapeHtml(docNumber)}</title>
</head>
<body style="margin:0;padding:0;background:${COLOR_BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${COLOR_INK};line-height:1.5;">
  <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all">${escapeHtml(preheader)}</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${COLOR_BG};">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;background:${COLOR_CARD};border-radius:18px;overflow:hidden;box-shadow:0 8px 32px rgba(20,72,82,0.08);">
        <tr><td style="padding:28px 32px 0;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td style="vertical-align:top">
                <div style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${COLOR_GREEN};">${escapeHtml(kind)}</div>
                <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:28px;letter-spacing:-0.02em;color:${COLOR_TEAL};margin-top:4px;">${escapeHtml(docNumber)}</div>
              </td>
              <td style="vertical-align:top;text-align:right;">
                <div style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${COLOR_MUTED};">Drafted</div>
                <div style="color:${COLOR_INK};font-weight:700;margin-top:4px;">${escapeHtml(drafted)}</div>
              </td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding:24px 32px 0;"><div style="height:1px;background:${COLOR_LINE};"></div></td></tr>
        <tr><td style="padding:20px 32px 0;">
          <p style="margin:0 0 8px;font-size:15px;color:${COLOR_INK};">${greeting}</p>
          <p style="margin:0;font-size:15px;color:${COLOR_INK};">${intro}</p>
        </td></tr>
        <tr><td style="padding:24px 32px 0;">${body}</td></tr>
        <tr><td style="padding:28px 32px 0;text-align:center;">
          <a href="${escapeAttr(ctaUrl)}" style="display:inline-block;background:${COLOR_GREEN};color:#ffffff;text-decoration:none;font-weight:800;font-size:15px;padding:14px 28px;border-radius:12px;box-shadow:0 6px 14px rgba(81,152,67,0.35);">${escapeHtml(ctaLabel)} →</a>
          <div style="margin-top:10px;font-size:12px;color:${COLOR_MUTED};">or paste this link into your browser:<br><a href="${escapeAttr(ctaUrl)}" style="color:${COLOR_MUTED};">${escapeHtml(ctaUrl)}</a></div>
        </td></tr>
        <tr><td style="padding:32px 32px 0;"><div style="height:1px;background:${COLOR_LINE};"></div></td></tr>
        <tr><td style="padding:20px 32px 28px;">
          <div style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${COLOR_MUTED};">From</div>
          <div style="margin-top:6px;font-weight:800;color:${COLOR_TEAL};font-size:15px;">${escapeHtml(senderName(sender))}</div>
          ${senderEmailLine}
          ${senderPhoneLine}
        </td></tr>
      </table>
      <div style="margin-top:14px;font-size:11px;color:${COLOR_MUTED};">Powered by Paperwork Monsters</div>
    </td></tr>
  </table>
</body>
</html>`;
}

// ---------- quote -------------------------------------------------------------

function renderQuoteSubject(q: Quote, sender: User | undefined): string {
  const who = sender?.name?.trim();
  const summary = q.summary?.trim() || "Your quote";
  return who ? `${summary} — quote from ${who}` : summary;
}

function renderQuoteHtml(q: Quote, customer: Customer | undefined, sender: User | undefined): string {
  const docNumber = `#${q.id.slice(0, 8)}`;
  const drafted = fmtDate(q.createdAt);
  const total = q.estimatedTotal ?? q.lineItems.reduce((s, li) => s + (li.price ?? 0) * (li.quantity ?? 1), 0);

  const rows = q.lineItems.map((li) => {
    const lineTotal = (li.price ?? 0) * (li.quantity ?? 1);
    const qtyLabel = `${li.quantity ?? 1} ${escapeHtml(li.unit ?? "ea")}`;
    return `<tr>
      <td style="padding:10px 0;border-bottom:1px solid ${COLOR_LINE};color:${COLOR_INK};font-size:14px;">${escapeHtml(li.description)}</td>
      <td style="padding:10px 0;border-bottom:1px solid ${COLOR_LINE};color:${COLOR_MUTED};font-size:13px;text-align:right;white-space:nowrap;">${qtyLabel}</td>
      <td style="padding:10px 0;border-bottom:1px solid ${COLOR_LINE};color:${COLOR_INK};font-size:14px;font-weight:700;text-align:right;white-space:nowrap;">${fmtUSD(lineTotal)}</td>
    </tr>`;
  }).join("");

  const body = `
    <div style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${COLOR_MUTED};">Scope of work</div>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top:8px;border-collapse:collapse;">
      <thead>
        <tr>
          <th align="left" style="padding:8px 0;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${COLOR_MUTED};border-bottom:1px solid ${COLOR_LINE};">Description</th>
          <th align="right" style="padding:8px 0;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${COLOR_MUTED};border-bottom:1px solid ${COLOR_LINE};">Qty</th>
          <th align="right" style="padding:8px 0;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${COLOR_MUTED};border-bottom:1px solid ${COLOR_LINE};">Amount</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top:18px;background:linear-gradient(135deg,rgba(81,152,67,0.10),rgba(72,158,95,0.04));border:1px solid rgba(72,158,95,0.20);border-radius:14px;">
      <tr>
        <td style="padding:18px 20px;">
          <div style="font-size:11px;font-weight:800;letter-spacing:.10em;text-transform:uppercase;color:${COLOR_GREEN};">Estimated total</div>
        </td>
        <td style="padding:18px 20px;text-align:right;">
          <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:28px;letter-spacing:-0.02em;color:${COLOR_TEAL};">${fmtUSD(total)}</div>
        </td>
      </tr>
    </table>`;

  return shell({
    preheader: `${q.summary ?? "Your quote"} — ${fmtUSD(total)}`,
    kind: "Quote",
    docNumber,
    drafted,
    greeting: customerGreeting(customer),
    intro: `Here's the quote we put together for <strong>${escapeHtml(q.summary ?? "your project")}</strong>. Take a look and tap below to accept or send back any tweaks.`,
    body,
    ctaLabel: "View & accept quote",
    ctaUrl: `${APP_URL}/q/${q.id}`,
    sender,
  });
}

// ---------- contract ----------------------------------------------------------

function renderContractSubject(c: Contract, sender: User | undefined): string {
  const who = sender?.name?.trim();
  const tail = `contract #${c.id.slice(0, 8)}`;
  return who ? `Sign ${tail} from ${who}` : `Please sign your ${tail}`;
}

function renderContractHtml(c: Contract, customer: Customer | undefined, sender: User | undefined): string {
  const docNumber = `#${c.id.slice(0, 8)}`;
  const drafted = fmtDate(c.effectiveDate ?? c.startDate);
  const total = c.totalAmount;

  const startLine = c.startDate
    ? `<tr><td style="padding:6px 0;color:${COLOR_MUTED};font-size:13px;">Start</td><td style="padding:6px 0;text-align:right;color:${COLOR_INK};font-weight:700;font-size:14px;">${escapeHtml(fmtDate(c.startDate))}</td></tr>`
    : "";
  const completeLine = c.estimatedCompletionDate
    ? `<tr><td style="padding:6px 0;color:${COLOR_MUTED};font-size:13px;">Estimated completion</td><td style="padding:6px 0;text-align:right;color:${COLOR_INK};font-weight:700;font-size:14px;">${escapeHtml(fmtDate(c.estimatedCompletionDate))}</td></tr>`
    : "";

  const body = `
    <div style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${COLOR_MUTED};">Project details</div>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top:8px;border-collapse:collapse;">
      ${startLine}
      ${completeLine}
      <tr><td style="padding:6px 0;color:${COLOR_MUTED};font-size:13px;">Status</td><td style="padding:6px 0;text-align:right;color:${COLOR_INK};font-weight:700;font-size:14px;text-transform:capitalize;">${escapeHtml(c.status ?? "draft")}</td></tr>
    </table>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top:18px;background:linear-gradient(135deg,rgba(81,152,67,0.10),rgba(72,158,95,0.04));border:1px solid rgba(72,158,95,0.20);border-radius:14px;">
      <tr>
        <td style="padding:18px 20px;">
          <div style="font-size:11px;font-weight:800;letter-spacing:.10em;text-transform:uppercase;color:${COLOR_GREEN};">Contract value</div>
        </td>
        <td style="padding:18px 20px;text-align:right;">
          <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:28px;letter-spacing:-0.02em;color:${COLOR_TEAL};">${fmtUSD(total)}</div>
        </td>
      </tr>
    </table>`;

  return shell({
    preheader: `Sign your contract — ${fmtUSD(total)}`,
    kind: "Contract",
    docNumber,
    drafted,
    greeting: customerGreeting(customer),
    intro: `Your contract is ready. Review the terms and tap below to sign — takes about a minute.`,
    body,
    ctaLabel: "Review & sign",
    ctaUrl: `${APP_URL}/c/${c.id}`,
    sender,
  });
}

// ---------- invoice -----------------------------------------------------------

function renderInvoiceSubject(i: Invoice, sender: User | undefined): string {
  const who = sender?.name?.trim();
  const tail = `Invoice #${i.id.slice(0, 8)} — due ${fmtDate(i.dueDate)}`;
  return who ? `${tail} from ${who}` : tail;
}

function renderInvoiceHtml(i: Invoice, customer: Customer | undefined, sender: User | undefined): string {
  const docNumber = `#${i.id.slice(0, 8)}`;
  const drafted = fmtDate(i.issuedDate ?? new Date().toISOString());
  const amount = i.amount;

  const body = `
    <div style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${COLOR_MUTED};">Invoice details</div>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top:8px;border-collapse:collapse;">
      <tr><td style="padding:6px 0;color:${COLOR_MUTED};font-size:13px;">Issued</td><td style="padding:6px 0;text-align:right;color:${COLOR_INK};font-weight:700;font-size:14px;">${escapeHtml(fmtDate(i.issuedDate))}</td></tr>
      <tr><td style="padding:6px 0;color:${COLOR_MUTED};font-size:13px;">Due</td><td style="padding:6px 0;text-align:right;color:${COLOR_INK};font-weight:700;font-size:14px;">${escapeHtml(fmtDate(i.dueDate))}</td></tr>
      <tr><td style="padding:6px 0;color:${COLOR_MUTED};font-size:13px;">Status</td><td style="padding:6px 0;text-align:right;color:${COLOR_INK};font-weight:700;font-size:14px;text-transform:capitalize;">${escapeHtml(i.status ?? "pending")}</td></tr>
    </table>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top:18px;background:linear-gradient(135deg,rgba(81,152,67,0.10),rgba(72,158,95,0.04));border:1px solid rgba(72,158,95,0.20);border-radius:14px;">
      <tr>
        <td style="padding:18px 20px;">
          <div style="font-size:11px;font-weight:800;letter-spacing:.10em;text-transform:uppercase;color:${COLOR_GREEN};">Amount due</div>
        </td>
        <td style="padding:18px 20px;text-align:right;">
          <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:28px;letter-spacing:-0.02em;color:${COLOR_TEAL};">${fmtUSD(amount)}</div>
        </td>
      </tr>
    </table>`;

  return shell({
    preheader: `Invoice ${docNumber} — ${fmtUSD(amount)} due ${fmtDate(i.dueDate)}`,
    kind: "Invoice",
    docNumber,
    drafted,
    greeting: customerGreeting(customer),
    intro: `Thanks for the work — here's the invoice. Tap below to view and pay.`,
    body,
    ctaLabel: "View & pay invoice",
    ctaUrl: `${APP_URL}/i/${i.id}`,
    sender,
  });
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

function escapeAttr(s: string): string {
  // Same as escapeHtml; kept separate so future tightening (e.g. URL allowlists)
  // can target attribute contexts without touching the body escape.
  return escapeHtml(s);
}
