import { Injectable } from "#danet/core";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { ContractStore } from "@paperwork/domain/data/contract-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { ShortLinkStore } from "@paperwork/domain/data/shortlink-store/mod.ts";
import type { Quote } from "@paperwork/dto/quote.ts";
import type { Contract } from "@paperwork/dto/contract.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";
import type { Customer } from "@crm/dto/customer.ts";
import type { User } from "@users/dto/user.ts";

export type PaperworkKind = "quote" | "contract" | "invoice";

export interface SendPaperworkSmsInput {
  kind: PaperworkKind;
  resourceId: string;
  /** Optional override; otherwise resolved from the linked customer's phoneNumber. */
  to?: string;
}

export interface SendPaperworkSmsResult {
  ok: boolean;
  /** E.164 number the dispatch was actually sent to (after resolution). */
  to: string;
  /** Twilio message SID, when delivery happened. */
  sid?: string;
  /** Reason if it failed (or 'dev_mode_no_dispatch'). */
  reason?: string;
}

/**
 * SendPaperworkSms — render + dispatch a quote/contract/invoice text.
 *
 * Mirrors SendPaperworkEmail: resolves the customer phone from the bound
 * resource when `to` is omitted, composes a short SMS body with a public
 * link to the document, and hands off to SmsService (Twilio).
 *
 * In dev (no TWILIO_ACCOUNT_SID), SmsService logs the body to stdout and
 * returns ok=true with reason='dev_mode_no_dispatch' — so the chat
 * divider message can still say "sent" without actually billing Twilio.
 */
@Injectable()
export class SendPaperworkSms {
  constructor(
    private quotes: QuoteStore,
    private contracts: ContractStore,
    private invoices: InvoiceStore,
    private customers: CustomerStore,
    private users: UserStore,
    private sms: SmsService,
    private shortlinks: ShortLinkStore,
  ) {}

  async run(userId: string, input: SendPaperworkSmsInput): Promise<SendPaperworkSmsResult> {
    const sender = await this.tryGetUser(userId);

    let recipient: string | undefined = input.to;
    let body: string;

    if (input.kind === "quote") {
      const quote = await this.quotes.getOwned(input.resourceId, userId);
      const customer = await this.tryGetCustomer(userId, quote.customerId);
      if (!recipient) recipient = customer?.phoneNumber ?? undefined;
      const boundContract = await this.findContractForQuote(userId, quote.id);
      // Prefer linking customers straight to the contract page when one
      // exists — same behavior as the email renderer.
      const linkResource: { kind: "quote" | "contract"; id: string } = boundContract
        ? { kind: "contract", id: boundContract.id }
        : { kind: "quote", id: quote.id };
      const shortUrl = await this.mintShortUrl(userId, linkResource);
      body = renderQuoteBody(quote, customer, sender, shortUrl);
    } else if (input.kind === "contract") {
      const contract = await this.contracts.getOwned(input.resourceId, userId);
      const customer = await this.tryGetCustomer(userId, contract.customerId);
      if (!recipient) recipient = customer?.phoneNumber ?? undefined;
      let quoteForBody: Quote | undefined;
      if (contract.quoteId) {
        try { quoteForBody = await this.quotes.getOwned(contract.quoteId, userId); }
        catch { /* fall through */ }
      }
      const shortUrl = await this.mintShortUrl(userId, { kind: "contract", id: contract.id });
      body = renderContractBody(contract, quoteForBody, customer, sender, shortUrl);
    } else {
      const invoice = await this.invoices.getOwned(input.resourceId, userId);
      const customer = await this.tryGetCustomer(userId, invoice.customerId);
      if (!recipient) recipient = customer?.phoneNumber ?? undefined;
      const shortUrl = await this.mintShortUrl(userId, { kind: "invoice", id: invoice.id });
      body = renderInvoiceBody(invoice, customer, sender, shortUrl);
    }

    if (!recipient) {
      return { ok: false, reason: "no recipient: pass `to` or attach a customer with a phone number", to: "" };
    }

    const e164 = normalizeE164(recipient);
    if (!e164) {
      return { ok: false, reason: `invalid phone: ${recipient}`, to: recipient };
    }

    const result = await this.sms.send({ to: e164, body });
    return { ...result, to: e164 };
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

  private async findContractForQuote(userId: string, quoteId: string): Promise<Contract | undefined> {
    try {
      const all = await this.contracts.listByUser(userId);
      return all
        .filter((c) => c.quoteId === quoteId)
        .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))[0];
    } catch {
      return undefined;
    }
  }

  /** Mint (or reuse) a short code for the resource and return the
   *  customer-facing /s/<code> URL. Falls back to the canonical
   *  long URL if the codegen path throws for any reason. */
  private async mintShortUrl(userId: string, r: { kind: "quote" | "contract" | "invoice"; id: string }): Promise<string> {
    try {
      const link = await this.shortlinks.findOrCreate(userId, r.kind, r.id);
      return `${APP_URL}/s/${link.code}`;
    } catch (err) {
      console.error("[send-paperwork-sms] shortlink mint failed; falling back to long URL:", err);
      const path = r.kind === "quote" ? `/q/${r.id}` : r.kind === "contract" ? `/c/${r.id}` : `/i/${r.id}`;
      return `${APP_URL}${path}`;
    }
  }
}

// ---------- public URL ------------------------------------------------------

const APP_URL = (() => {
  const explicit = Deno.env.get("APP_URL")?.trim() || undefined;
  const force = Deno.env.get("APP_URL_FORCE") === "1";
  const isProd = Deno.env.get("APP_ENV")?.toLowerCase() === "prod"
    || !!Deno.env.get("DENO_DEPLOYMENT_ID");
  if (isProd) return explicit ?? "https://paperworkmonsters.com";
  if (force && explicit) return explicit;
  return "http://localhost:5173";
})();

// ---------- bodies ----------------------------------------------------------

function senderFirst(u: User | undefined): string | undefined {
  return u?.name?.trim()?.split(/\s+/)[0] || undefined;
}

function customerFirst(c: Customer | undefined): string | undefined {
  return c?.name?.trim()?.split(/\s+/)[0] || undefined;
}

function fmtUSD(cents: number | undefined): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "—";
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function renderQuoteBody(q: Quote, c: Customer | undefined, sender: User | undefined, url: string): string {
  const hi = customerFirst(c);
  const who = senderFirst(sender);
  const total = q.estimatedTotal ?? q.lineItems.reduce((s, li) => s + (li.price ?? 0) * (li.quantity ?? 1), 0);
  const summary = (q.summary ?? "your project").replace(/^\s*quote\s*:\s*/i, "").trim();
  const lead = hi ? `Hi ${hi}, ` : "";
  const tail = who ? ` — ${who}` : "";
  return `${lead}your quote for ${summary} is ready (${fmtUSD(total)}). Review & accept: ${url}${tail}`;
}

function renderContractBody(c: Contract, q: Quote | undefined, cust: Customer | undefined, sender: User | undefined, url: string): string {
  const hi = customerFirst(cust);
  const who = senderFirst(sender);
  const total = c.totalAmount ?? q?.estimatedTotal;
  const summary = (q?.summary ?? "your project").replace(/^\s*quote\s*:\s*/i, "").trim();
  const lead = hi ? `Hi ${hi}, ` : "";
  const tail = who ? ` — ${who}` : "";
  return `${lead}your contract for ${summary} is ready to sign (${fmtUSD(total)}). Sign here: ${url}${tail}`;
}

function renderInvoiceBody(i: Invoice, cust: Customer | undefined, sender: User | undefined, url: string): string {
  const hi = customerFirst(cust);
  const who = senderFirst(sender);
  const lead = hi ? `Hi ${hi}, ` : "";
  const tail = who ? ` — ${who}` : "";
  return `${lead}your invoice is ready (${fmtUSD(i.amount)}). View & pay: ${url}${tail}`;
}

// ---------- phone normalization --------------------------------------------

function normalizeE164(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (/^\+[1-9]\d{6,14}$/.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return undefined;
}
