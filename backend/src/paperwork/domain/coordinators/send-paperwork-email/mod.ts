import { Injectable } from "#danet/core";
import { type Lang, t } from "@core/i18n/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { ContractStore } from "@paperwork/domain/data/contract-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import type { BusinessIdentity } from "@users/dto/business-identity.ts";
import {
  EmailService,
  type SendEmailResult,
} from "@communication/domain/data/email-service/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
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
  /** Per-send language override (the "Send in <lang>" button). When set it
   *  wins over the contractor's stored `commsLanguage` default. */
  language?: "en" | "es";
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
    private identity: BusinessIdentityStore,
    private email: EmailService,
    private commsLog: LogPaperworkMessage,
  ) {}

  async run(
    userId: string,
    input: SendPaperworkEmailInput,
  ): Promise<SendPaperworkEmailResult> {
    const sender = await this.tryGetUser(userId);
    const rawBiz = await this.tryGetBusinessIdentity(userId);
    // Per-send language override (the "Send in <lang>" button) beats the
    // stored default. Overriding commsLanguage on the resolved identity lets
    // every downstream subject/body helper honor it without new params.
    const senderBiz = input.language && rawBiz
      ? { ...rawBiz, commsLanguage: input.language }
      : rawBiz;

    let subject: string;
    let htmlBody: string;
    let recipient: string | undefined = input.to;

    let quoteForStamp: Quote | undefined;
    let customerIdForLog: string | undefined;
    if (input.kind === "quote") {
      const quote = await this.quotes.getOwned(input.resourceId, userId);
      const customer = await this.tryGetCustomer(userId, quote.customerId);
      customerIdForLog = customer?.id;
      if (!recipient) recipient = customer?.email ?? undefined;
      // The customer-facing flow goes: email → contract page → sign.
      // No separate contract email exists — the quote email IS the
      // outbound, and its CTA jumps straight into the bonafide contract.
      // If a contract has already been finalized for this quote, link to
      // it directly. Otherwise we fall back to the quote-public page.
      const boundContract = await this.findContractForQuote(userId, quote.id);
      subject = renderQuoteSubject(quote, sender, senderBiz, customer);
      htmlBody = renderQuoteHtml(
        quote,
        customer,
        sender,
        senderBiz,
        boundContract,
      );
      quoteForStamp = quote;
    } else if (input.kind === "contract") {
      const contract = await this.contracts.getOwned(input.resourceId, userId);
      const customer = await this.tryGetCustomer(userId, contract.customerId);
      customerIdForLog = customer?.id;
      if (!recipient) recipient = customer?.email ?? undefined;
      // Single email design across the board: render the same WOW quote
      // email, but with the CTA pointing at the contract page (so the
      // customer signs without an extra hop). We resolve the bound quote
      // for line items + summary; if missing, the quote-render falls
      // back gracefully.
      let quoteForBody: Quote | undefined;
      if (contract.quoteId) {
        try {
          quoteForBody = await this.quotes.getOwned(contract.quoteId, userId);
        } catch { /* fall through to contract-only */ }
      }
      // The customer sees a quote-styled email with a "sign" CTA — the
      // subject must match that framing. "Sign your contract #ABCD..."
      // confused customers (audit2 N9) since the body and CTA copy
      // present this as a quote review. Reuse the quote subject builder
      // with the resolved quote (or a synthesized one when missing).
      // The email goes to the customer, so it follows the contractor's
      // outgoing-comms language (default en), not their UI language.
      const lang: Lang = senderBiz?.commsLanguage === "es" ? "es" : "en";
      const quoteForSubject = quoteForBody ?? quoteFromContract(contract, lang);
      subject = renderQuoteSubject(
        quoteForSubject,
        sender,
        senderBiz,
        customer,
      );
      htmlBody = renderQuoteHtml(
        quoteForBody ?? quoteFromContract(contract, lang),
        customer,
        sender,
        senderBiz,
        contract,
      );
    } else {
      const invoice = await this.invoices.getOwned(input.resourceId, userId);
      const customer = await this.tryGetCustomer(userId, invoice.customerId);
      customerIdForLog = customer?.id;
      if (!recipient) recipient = customer?.email ?? undefined;
      // The email goes to the customer, so it follows the contractor's
      // outgoing-comms language (default en), not their UI language.
      const lang: Lang = senderBiz?.commsLanguage === "es" ? "es" : "en";
      // Resolve the linked agreement + quote so the email mirrors the signed
      // agreement (itemized job, totals, signed-agreement link) — minus the
      // legal clauses + signature. Both are best-effort; a standalone invoice
      // falls back to the lightweight amount-only email.
      let invContract: Contract | undefined;
      let invQuote: Quote | undefined;
      if (invoice.contractId) {
        try {
          invContract = await this.contracts.getOwned(
            invoice.contractId,
            userId,
          );
        } catch { /* standalone or missing */ }
      }
      if (invContract?.quoteId) {
        try {
          invQuote = await this.quotes.getOwned(invContract.quoteId, userId);
        } catch { /* fall through */ }
      }
      subject = renderInvoiceSubject(invoice, sender, lang);
      htmlBody = renderInvoiceHtml(
        invoice,
        customer,
        sender,
        senderBiz,
        invQuote,
        invContract,
      );
    }

    if (!recipient) {
      return {
        ok: false,
        reason: "no recipient: pass `to` or attach a customer with an email",
        to: "",
        subject,
      };
    }

    // Roadmap p.7: contractor lands a copy on every outbound, so they can
    // forward and have a paper trail in their own inbox.
    const cc = sender?.email ? [sender.email] : undefined;
    // Roadmap p.7 + scope answer: From is a per-business alias at the
    // SEND_DOMAIN (e.g. acme@paperworkmonster.com) when the business identity
    // has one set. Falls back to noreply@... and then to the configured
    // POSTMARK_FROM env when neither is available.
    const from = input.from ?? resolveSenderFrom(senderBiz);

    const result = await this.email.send({
      to: recipient,
      subject,
      htmlBody,
      from,
      cc,
    });

    // Stamp the quote's lifecycle: status→"sent" + sentAt→now (idempotent — only if not already set).
    // Mirrors the public-controller's accept-time stamping and powers the /quotes stage derivation.
    if (
      result.ok && input.kind === "quote" && quoteForStamp &&
      !quoteForStamp.sentAt
    ) {
      await this.quotes.update(input.resourceId, userId, {
        status: "sent",
        sentAt: new Date().toISOString(),
      });
    }

    // Comms trail (roadmap p.8): record the dispatch in the customer's
    // thread so every outbound email is queryable per document.
    if (result.ok) {
      await this.commsLog.run({
        userId,
        customerId: customerIdForLog,
        channel: "email",
        content: `${input.kind} ${input.resourceId} emailed to ${recipient}`,
        subject,
        toAddress: recipient,
        paperworkId: input.resourceId,
        paperworkType: input.kind,
      });
    }

    return { ...result, to: recipient, subject };
  }

  private async tryGetCustomer(
    userId: string,
    customerId: string | undefined,
  ): Promise<Customer | undefined> {
    if (!customerId) return undefined;
    try {
      return await this.customers.getOwned(customerId, userId);
    } catch {
      return undefined;
    }
  }

  private async tryGetUser(userId: string): Promise<User | undefined> {
    try {
      return await this.users.get(userId);
    } catch {
      return undefined;
    }
  }

  private async tryGetBusinessIdentity(
    userId: string,
  ): Promise<BusinessIdentity | undefined> {
    try {
      return (await this.identity.get(userId)) ?? undefined;
    } catch {
      return undefined;
    }
  }

  /** Find a contract owned by `userId` whose quoteId matches `quoteId`.
   *  Used by the quote-email path so the CTA can link straight to the
   *  bonafide contract page (no separate accept-quote step). */
  private async findContractForQuote(
    userId: string,
    quoteId: string,
  ): Promise<Contract | undefined> {
    try {
      const all = await this.contracts.listByUser(userId);
      // Prefer the most recently updated contract bound to the quote so a
      // stale draft from before the wizard re-ran doesn't shadow the
      // current one.
      return all
        .filter((c) => c.quoteId === quoteId)
        .sort((a, b) =>
          (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")
        )[0];
    } catch {
      return undefined;
    }
  }
}

// ---------- shared shell + helpers -------------------------------------------

/**
 * Resolve the public-facing app URL for customer-facing email links.
 *
 * In **dev** (APP_ENV unset or "dev") always hand out
 * `http://localhost:5280` (the serve.ts orchestrator default) so the
 * contractor's local Vite server picks the link up. APP_URL is honored
 * when it targets localhost. Set `APP_URL_FORCE=1` to opt in to
 * ngrok-style / public URLs for a demo.
 *
 * In **prod** (`APP_ENV=prod` or running on Deno Deploy), prefer
 * `APP_URL`; fall back to the production host so a missing env doesn't
 * silently send customers to localhost.
 */
const APP_URL = (() => {
  const explicit = Deno.env.get("APP_URL")?.trim() || undefined;
  const force = Deno.env.get("APP_URL_FORCE") === "1";
  const isProd = Deno.env.get("APP_ENV")?.toLowerCase() === "prod" ||
    !!Deno.env.get("DENO_DEPLOYMENT_ID");
  if (isProd) {
    return explicit ?? "https://paperworkmonster.com";
  }
  // Honor explicit APP_URL in dev when it targets localhost — that's how
  // the serve.ts orchestrator wires the backend to the *running* frontend
  // port. The FORCE gate stays as the opt-in for ngrok / tunnel URLs we
  // don't want to trust by accident.
  if (explicit && /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(explicit)) {
    return explicit;
  }
  if (force && explicit) {
    return explicit;
  }
  return "http://localhost:5280";
})();

/** Outbound domain for the per-business alias system (roadmap p.7). All
 *  customer-facing email goes out as `<alias>@${SEND_DOMAIN}` so contractors
 *  get a unique address that can be forwarded to their personal inbox. */
const SEND_DOMAIN = "paperworkmonster.com";

/** Resolve the per-business From address. Uses the business identity's
 *  `emailAlias` when present; falls back to `noreply@${SEND_DOMAIN}`. The
 *  EmailService falls back further to POSTMARK_FROM env if needed. */
function resolveSenderFrom(biz: BusinessIdentity | undefined): string {
  const alias = biz?.emailAlias?.trim();
  if (alias && /^[a-z0-9-]+$/.test(alias)) {
    return `${alias}@${SEND_DOMAIN}`;
  }
  return `noreply@${SEND_DOMAIN}`;
}

const COLOR_TEAL = "#144852";
const COLOR_GREEN = "#519843";
const COLOR_INK = "#1c2c30";
const COLOR_MUTED = "#6b7a7e";
const COLOR_LINE = "#e3e8e6";
const COLOR_BG = "#f7f6f1";
const COLOR_CARD = "#ffffff";

function senderName(u: User | undefined, lang: Lang): string {
  return u?.name?.trim() || t(lang, "paperworkEmail.senderFallback");
}

function customerGreeting(c: Customer | undefined, lang: Lang): string {
  const name = c?.name?.trim();
  return name
    ? t(lang, "paperworkEmail.shell.greeting", { name: escapeHtml(name) })
    : t(lang, "paperworkEmail.shell.greetingFallback");
}

function fmtUSD(cents: number | undefined): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "—";
  // Audit1 #3 — money fields are INTEGER CENTS across the backend now.
  // Divide once at the format step.
  return `$${
    (cents / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }`;
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
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Wraps the per-doc body in a brand-consistent shell (header, sender block,
 *  CTA button row, footer). All inline-styled — Gmail/Outlook strip <style>. */
function shell(opts: {
  preheader: string;
  /** Localized document-kind label shown in the eyebrow + <title>. */
  kindLabel: string;
  docNumber: string;
  drafted: string;
  greeting: string;
  intro: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  sender: User | undefined;
  lang: Lang;
}): string {
  const {
    preheader,
    kindLabel,
    docNumber,
    drafted,
    greeting,
    intro,
    body,
    ctaLabel,
    ctaUrl,
    sender,
    lang,
  } = opts;
  const senderEmailLine = sender?.email
    ? `<div style="color:${COLOR_MUTED};font-size:13px;margin-top:2px"><a href="mailto:${
      escapeHtml(sender.email)
    }" style="color:${COLOR_MUTED};text-decoration:none">${
      escapeHtml(sender.email)
    }</a></div>`
    : "";
  const senderPhoneLine = sender?.phoneNumber
    ? `<div style="color:${COLOR_MUTED};font-size:13px;margin-top:2px">${
      escapeHtml(sender.phoneNumber)
    }</div>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>${escapeHtml(kindLabel)} ${escapeHtml(docNumber)}</title>
</head>
<body style="margin:0;padding:0;background:${COLOR_BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${COLOR_INK};line-height:1.5;">
  <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all">${
    escapeHtml(preheader)
  }</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${COLOR_BG};">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;background:${COLOR_CARD};border-radius:18px;overflow:hidden;box-shadow:0 8px 32px rgba(20,72,82,0.08);">
        <tr><td align="center" style="padding:24px 32px 0;">
          <img src="${APP_URL}/logo-email.png" alt="Paperwork Monster" width="160" style="display:block;border:0;outline:none;text-decoration:none;height:auto;max-width:160px;">
        </td></tr>
        <tr><td style="padding:24px 32px 0;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td style="vertical-align:top">
                <div style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${COLOR_GREEN};">${
    escapeHtml(kindLabel)
  }</div>
                <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:28px;letter-spacing:-0.02em;color:${COLOR_TEAL};margin-top:4px;">${
    escapeHtml(docNumber)
  }</div>
              </td>
              <td style="vertical-align:top;text-align:right;">
                <div style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${COLOR_MUTED};">${
    escapeHtml(t(lang, "paperworkEmail.shell.draftedLabel"))
  }</div>
                <div style="color:${COLOR_INK};font-weight:700;margin-top:4px;">${
    escapeHtml(drafted)
  }</div>
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
          <a href="${
    escapeAttr(ctaUrl)
  }" style="display:inline-block;background:${COLOR_GREEN};color:#ffffff;text-decoration:none;font-weight:800;font-size:15px;padding:14px 28px;border-radius:12px;box-shadow:0 6px 14px rgba(81,152,67,0.35);">${
    escapeHtml(ctaLabel)
  } →</a>
          <div style="margin-top:10px;font-size:12px;color:${COLOR_MUTED};">${
    escapeHtml(t(lang, "paperworkEmail.pasteLink"))
  }<br><a href="${
    escapeAttr(ctaUrl)
  }" style="color:${COLOR_MUTED};">${escapeHtml(ctaUrl)}</a></div>
        </td></tr>
        <tr><td style="padding:32px 32px 0;"><div style="height:1px;background:${COLOR_LINE};"></div></td></tr>
        <tr><td style="padding:20px 32px 28px;">
          <div style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${COLOR_MUTED};">${
    escapeHtml(t(lang, "paperworkEmail.shell.fromLabel"))
  }</div>
          <div style="margin-top:6px;font-weight:800;color:${COLOR_TEAL};font-size:15px;">${
    escapeHtml(senderName(sender, lang))
  }</div>
          ${senderEmailLine}
          ${senderPhoneLine}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ---------- quote -------------------------------------------------------------

const COLOR_PINK = "#FF6B6B";
const COLOR_PINK_DARK = "#d94e4e";

function renderQuoteSubject(
  q: Quote,
  sender: User | undefined,
  senderBiz: BusinessIdentity | undefined,
  customer: Customer | undefined,
): string {
  // Roadmap p.13: the SUBJECT goes to the customer, so it follows the
  // contractor's outgoing-comms language (default en), not their UI language.
  const lang: Lang = senderBiz?.commsLanguage === "es" ? "es" : "en";
  // Roadmap p.7: drop the literal quote marks → {Business} Quote for {Customer}, {Job Name}
  const businessName = senderBiz?.businessName?.trim() ||
    senderBiz?.legalName?.trim() ||
    sender?.name?.trim() ||
    t(lang, "brand.name");
  const customerName = customer?.name?.trim() ||
    t(lang, "paperworkEmail.subject.customerFallback");
  const jobName = (q.jobNameByLang?.[lang] ?? q.jobName)?.trim() ||
    (q.summaryByLang?.[lang] ?? q.summary)?.replace(/^\s*quote\s*:\s*/i, "")
      .trim() ||
    t(lang, "paperworkEmail.subject.jobFallback");
  return t(lang, "paperworkEmail.quote.subject", {
    businessName,
    customerName,
    jobName,
  });
}

/**
 * Custom WOW-factor quote email. Bypasses the generic shell() because the
 * quote is the FIRST customer-facing surface — it sets the brand tone.
 *
 * Hierarchy:
 *   1. Pink ribbon header with "QUOTE · No. xxxxxxxx"
 *   2. The QUOTE SUMMARY as the hero headline (not the doc number)
 *   3. Greeting + warm intro from the contractor (first name)
 *   4. "Here's what we'll handle" line-item list (not a boring table)
 *   5. Bold gradient total card with the cents-correct figure
 *   6. CTA: "Sound good? Accept this quote →"
 *   7. "What happens next" 4-step timeline so the customer isn't left
 *      wondering what comes after the click
 *   8. Personal contact card with avatar disc + name + role
 *
 * All inline styles, table-based layout for Gmail/Outlook safety, no
 * remote images that mail clients block.
 */
function renderQuoteHtml(
  q: Quote,
  customer: Customer | undefined,
  sender: User | undefined,
  senderBiz: BusinessIdentity | undefined,
  contract?: Contract,
): string {
  const docNumber = `#${q.id.slice(0, 8).toUpperCase()}`;
  const drafted = fmtDate(q.createdAt);
  const total = q.estimatedTotal ??
    q.lineItems.reduce((s, li) => s + (li.price ?? 0) * (li.quantity ?? 1), 0);
  // Roadmap p.13: the email goes to the customer, so it follows the
  // contractor's outgoing-comms language (default en), not their UI language.
  const es = senderBiz?.commsLanguage === "es";
  const lang: Lang = es ? "es" : "en";
  const L = {
    docLang: lang,
    titleWord: t(lang, "paperworkEmail.quote.titleWord"),
    quoteTag: t(lang, "paperworkEmail.quote.titleWord"),
    drafted: t(lang, "paperworkEmail.shell.draftedLabel"),
    preparedFor: t(lang, "paperworkEmail.quote.preparedFor"),
    by: t(lang, "paperworkEmail.quote.by"),
    introTail: t(lang, "paperworkEmail.quote.introTail"),
    jobDetails: t(lang, "paperworkEmail.quote.jobDetails"),
    whatWeHandle: t(lang, "paperworkEmail.quote.whatWeHandle"),
    estimatedTotal: t(lang, "paperworkEmail.quote.estimatedTotal"),
    allIn: t(lang, "paperworkEmail.quote.allIn"),
    pasteLink: t(lang, "paperworkEmail.pasteLink"),
    whatNext: t(lang, "paperworkEmail.quote.whatNext"),
    questions: t(lang, "paperworkEmail.quote.questions"),
    yourContractor: t(lang, "paperworkEmail.quote.yourContractor"),
    steps: [
      [
        "1",
        t(lang, "paperworkEmail.quote.step1Title"),
        t(lang, "paperworkEmail.quote.step1Sub"),
      ],
      [
        "2",
        t(lang, "paperworkEmail.quote.step2Title"),
        t(lang, "paperworkEmail.quote.step2Sub"),
      ],
      [
        "3",
        t(lang, "paperworkEmail.quote.step3Title"),
        t(lang, "paperworkEmail.quote.step3Sub"),
      ],
      [
        "4",
        t(lang, "paperworkEmail.quote.step4Title"),
        t(lang, "paperworkEmail.quote.step4Sub"),
      ],
    ],
  };
  // CTA points at the contract page when a contract has been finalized;
  // otherwise the legacy quote-public page (still cents-correct, still
  // accept/decline). Customers in both cases land on a real document.
  const ctaUrl = contract
    ? `${APP_URL}/c/${contract.id}`
    : `${APP_URL}/q/${q.id}`;
  const ctaLabel = contract
    ? t(lang, "paperworkEmail.quote.ctaSign")
    : t(lang, "paperworkEmail.quote.ctaAccept");

  const customerFirst = customer?.name?.trim().split(/\s+/)[0];
  const senderFirst = sender?.name?.trim()?.split(/\s+/)[0];
  const senderInitials = (() => {
    const n = sender?.name?.trim();
    if (!n) return "PM";
    const parts = n.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return parts[0].slice(0, 2).toUpperCase();
  })();

  const summaryClean = (q.summary ?? t(lang, "paperworkEmail.quote.summaryFallback"))
    .replace(/^\s*quote\s*:\s*/i, "")
    .trim();
  // Title case for visual weight in the hero.
  const heroTitle = summaryClean.replace(/\b\w/g, (c) => c.toUpperCase());

  const preheader = `${
    customerFirst
      ? `${t(lang, "paperworkEmail.quote.preheaderFor")} ${customerFirst} — `
      : ""
  }${summaryClean} · ${fmtUSD(total)}`;

  // Line items rendered as visual rows (not a generic header-table) — each
  // line gets a small pink dot and right-aligned amount. Reads more like a
  // proposal than a receipt.
  const lineRows = q.lineItems.map((li, i) => {
    const lineTotal = (li.price ?? 0) * (li.quantity ?? 1);
    const qty = li.quantity ?? 1;
    const subBits = [
      qty > 1 ? `${qty} ${escapeHtml(li.unit ?? "ea")}` : null,
      qty > 1
        ? t(lang, "paperworkEmail.quote.lineEach", { price: fmtUSD(li.price ?? 0) })
        : null,
    ].filter(Boolean).join(" · ");
    const sub = subBits
      ? `<div style="margin-top:2px;color:${COLOR_MUTED};font-size:12px">${subBits}</div>`
      : "";
    const last = i === q.lineItems.length - 1;
    const border = last ? "" : `border-bottom:1px solid ${COLOR_LINE};`;
    return `<tr>
      <td style="padding:14px 0;${border}vertical-align:middle">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
          <tr>
            <td style="vertical-align:middle;width:18px">
              <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${COLOR_PINK};vertical-align:middle"></span>
            </td>
            <td style="vertical-align:middle;color:${COLOR_INK};font-size:15px;font-weight:600">
              ${escapeHtml(li.description)}
              ${sub}
            </td>
            <td style="vertical-align:middle;text-align:right;color:${COLOR_INK};font-weight:800;font-size:15px;font-variant-numeric:tabular-nums;white-space:nowrap;padding-left:14px">
              ${fmtUSD(lineTotal)}
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
  }).join("");

  // Job-details block. The "I know my price" flow stores newline-separated
  // scope lines in description; legacy/LLM flows store a 1–3 sentence
  // paragraph. Render email-safe dot+text rows when multi-line (mirrors the
  // line-item dot styling), else a paragraph.
  const descLines = (q.description ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[••\-*]\s*/, "").trim())
    .filter(Boolean);
  const descBlock = descLines.length > 1
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top:8px;border-collapse:collapse"><tbody>${
      descLines.map((l) =>
        `<tr>
            <td style="vertical-align:top;width:18px;padding:8px 0 0"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${COLOR_PINK}"></span></td>
            <td style="vertical-align:top;padding:3px 0;font-size:15px;line-height:1.5;color:${COLOR_INK}">${
          escapeHtml(l)
        }</td>
          </tr>`
      ).join("")
    }</tbody></table>`
    : `<p style="margin:8px 0 0;font-size:15px;line-height:1.55;color:${COLOR_INK};white-space:pre-wrap">${
      escapeHtml(descLines[0] ?? "")
    }</p>`;

  const greeting = customerFirst
    ? t(lang, "paperworkEmail.quote.greeting", { name: escapeHtml(customerFirst) })
    : t(lang, "paperworkEmail.quote.greetingFallback");
  const senderBizName = senderBiz?.businessName?.trim() ||
    (senderBiz as { legalName?: string } | undefined)?.legalName?.trim();
  const introLine = senderFirst
    ? `${escapeHtml(senderFirst)}${
      senderBizName
        ? ` ${t(lang, "paperworkEmail.quote.introFrom")} ${escapeHtml(senderBizName)}`
        : ""
    } ${t(lang, "paperworkEmail.quote.introTailLine")}`
    : t(lang, "paperworkEmail.quote.introFallback");
  const senderRoleLine = sender?.name?.trim()
    ? `${escapeHtml(sender.name.trim())}`
    : L.yourContractor;

  return `<!doctype html>
<html lang="${L.docLang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>${L.titleWord} ${escapeHtml(docNumber)}</title>
</head>
<body style="margin:0;padding:0;background:${COLOR_BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${COLOR_INK};line-height:1.5;">
  <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all">${
    escapeHtml(preheader)
  }</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${COLOR_BG};">
    <tr><td align="center" style="padding:40px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="640" style="max-width:640px;background:${COLOR_CARD};border-radius:24px;overflow:hidden;box-shadow:0 12px 40px rgba(20,72,82,0.10);">

        <!-- pink ribbon header -->
        <tr><td style="height:6px;background:linear-gradient(90deg,${COLOR_PINK} 0%,${COLOR_PINK_DARK} 100%);font-size:0;line-height:0">&nbsp;</td></tr>

        <!-- doc tag + drafted date -->
        <tr><td style="padding:32px 36px 0;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td style="vertical-align:top">
                <span style="display:inline-block;background:rgba(255,107,107,0.10);color:${COLOR_PINK_DARK};font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;padding:6px 12px;border-radius:999px">${L.quoteTag} · ${
    escapeHtml(docNumber)
  }</span>
              </td>
              <td style="vertical-align:top;text-align:right;color:${COLOR_MUTED};font-size:12px;font-weight:600">
                ${L.drafted} ${escapeHtml(drafted)}
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- hero title -->
        <tr><td style="padding:18px 36px 0;">
          <h1 style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:36px;letter-spacing:-0.025em;color:${COLOR_TEAL};line-height:1.05">${
    escapeHtml(heroTitle)
  }</h1>
          ${
    customerFirst
      ? `<div style="margin-top:10px;color:${COLOR_MUTED};font-size:14px">${L.preparedFor} <strong style="color:${COLOR_INK}">${
        escapeHtml(customerFirst)
      }</strong>${
        senderFirst
          ? ` ${L.by} <strong style="color:${COLOR_INK}">${
            escapeHtml(senderFirst)
          }</strong>`
          : ""
      }</div>`
      : ""
  }
        </td></tr>

        <!-- greeting + warm intro -->
        <tr><td style="padding:28px 36px 0;">
          <p style="margin:0 0 8px;font-size:16px;font-weight:700;color:${COLOR_INK}">${greeting}</p>
          <p style="margin:0;font-size:15px;color:${COLOR_INK};line-height:1.55">
            ${introLine} ${L.introTail}
          </p>
        </td></tr>

        <!-- divider -->
        <tr><td style="padding:24px 36px 0"><div style="height:1px;background:${COLOR_LINE}"></div></td></tr>

        ${
    q.description
      ? `
        <!-- job-details: bulleted scope of work (or paragraph if single line) -->
        <tr><td style="padding:18px 36px 0">
          <div style="font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:${COLOR_MUTED}">${L.jobDetails}</div>
          ${descBlock}
        </td></tr>
        <tr><td style="padding:18px 36px 0"><div style="height:1px;background:${COLOR_LINE}"></div></td></tr>
        `
      : ""
  }

        <!-- line-item breakdown: only for multi-line quotes. A single line
             just repeats the total below, and the Job details block above
             already covers the scope. -->
        ${
    q.lineItems.length > 1
      ? `
        <tr><td style="padding:18px 36px 0">
          <div style="font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:${COLOR_MUTED}">${L.whatWeHandle}</div>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top:6px;border-collapse:collapse">
            <tbody>${lineRows}</tbody>
          </table>
        </td></tr>
        `
      : ""
  }

        <!-- total card (the money moment) -->
        <tr><td style="padding:24px 36px 0">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:linear-gradient(135deg,#e8f3e2 0%,#dceadb 100%);border:1px solid rgba(81,152,67,0.25);border-radius:18px">
            <tr>
              <td style="padding:22px 24px">
                <div style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${COLOR_GREEN}">${L.estimatedTotal}</div>
                <div style="margin-top:4px;color:${COLOR_MUTED};font-size:12px">${L.allIn}</div>
              </td>
              <td style="padding:22px 24px;text-align:right;vertical-align:middle">
                <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:42px;letter-spacing:-0.03em;color:${COLOR_TEAL};line-height:1;font-variant-numeric:tabular-nums">${
    fmtUSD(total)
  }</div>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- big CTA -->
        <tr><td style="padding:28px 36px 0;text-align:center">
          <a href="${
    escapeAttr(ctaUrl)
  }" style="display:inline-block;background:${COLOR_GREEN};color:#ffffff;text-decoration:none;font-weight:800;font-size:16px;padding:18px 32px;border-radius:14px;box-shadow:0 10px 22px -6px rgba(81,152,67,0.55);letter-spacing:.005em">${
    escapeHtml(ctaLabel)
  } &nbsp;→</a>
          <div style="margin-top:14px;font-size:11px;color:${COLOR_MUTED}">${L.pasteLink}<br><a href="${
    escapeAttr(ctaUrl)
  }" style="color:${COLOR_MUTED};word-break:break-all">${
    escapeHtml(ctaUrl)
  }</a></div>
        </td></tr>

        <!-- "what happens next" timeline strip -->
        <tr><td style="padding:32px 36px 0">
          <div style="font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:${COLOR_MUTED};text-align:center;margin-bottom:14px">${L.whatNext}</div>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              ${
    L.steps.map(([n, t, sub]) =>
      `<td valign="top" align="center" style="width:25%;padding:0 6px">
                <div style="display:inline-block;width:30px;height:30px;border-radius:50%;background:${COLOR_PINK};color:#fff;font-weight:800;line-height:30px;text-align:center;font-size:13px">${n}</div>
                <div style="margin-top:8px;color:${COLOR_INK};font-weight:700;font-size:13px">${t}</div>
                <div style="margin-top:2px;color:${COLOR_MUTED};font-size:11px;line-height:1.4">${sub}</div>
              </td>`
    ).join("")
  }
            </tr>
          </table>
        </td></tr>

        <!-- divider -->
        <tr><td style="padding:32px 36px 0"><div style="height:1px;background:${COLOR_LINE}"></div></td></tr>

        <!-- contact card -->
        <tr><td style="padding:22px 36px 32px">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td valign="middle" style="width:48px">
                <div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,${COLOR_GREEN} 0%,#71a85f 100%);color:#fff;font-weight:800;font-size:14px;line-height:44px;text-align:center;letter-spacing:.04em">${
    escapeHtml(senderInitials)
  }</div>
              </td>
              <td valign="middle" style="padding-left:14px">
                <div style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${COLOR_MUTED}">${L.questions}</div>
                <div style="margin-top:3px;font-weight:800;color:${COLOR_TEAL};font-size:15px">${
    escapeHtml(senderRoleLine)
  }</div>
                ${
    sender?.phoneNumber
      ? `<div style="margin-top:1px;color:${COLOR_INK};font-size:13px"><a href="tel:${
        escapeAttr(sender.phoneNumber)
      }" style="color:${COLOR_INK};text-decoration:none">${
        escapeHtml(sender.phoneNumber)
      }</a></div>`
      : ""
  }
                ${
    sender?.email
      ? `<div style="margin-top:1px;color:${COLOR_INK};font-size:13px"><a href="mailto:${
        escapeAttr(sender.email)
      }" style="color:${COLOR_INK};text-decoration:none">${
        escapeHtml(sender.email)
      }</a></div>`
      : ""
  }
              </td>
            </tr>
          </table>
        </td></tr>

      </table>
      <div style="margin-top:18px;font-size:11px;color:#a8b2b3;letter-spacing:.04em">${
    escapeHtml(
      t(lang, "paperworkEmail.quote.sentBecause", {
        name: senderFirst ?? t(lang, "paperworkEmail.senderFallback"),
      }),
    )
  }</div>
    </td></tr>
  </table>
</body>
</html>`;
}

// ---------- contract ----------------------------------------------------------

/**
 * Synthesize a Quote-shaped object from a Contract when no real quote is
 * bound. Lets renderQuoteHtml work as the universal customer-facing
 * email body — even contracts that lost their linked quote get a
 * dignified-looking email with the contract value as the total.
 */
function quoteFromContract(c: Contract, lang: Lang): Quote {
  const serviceAgreement = t(lang, "paperworkEmail.contract.serviceAgreement");
  return {
    id: c.id,
    userId: c.userId,
    summary: serviceAgreement,
    lineItems: [{
      description: serviceAgreement,
      quantity: 1,
      unit: "ea",
      price: c.totalAmount ?? 0,
    }],
    estimatedTotal: c.totalAmount ?? 0,
    status: c.status ?? "draft",
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  } as Quote;
}

// ---------- invoice -----------------------------------------------------------

function renderInvoiceSubject(
  i: Invoice,
  sender: User | undefined,
  lang: Lang,
): string {
  const who = sender?.name?.trim();
  const tail = t(lang, "paperworkEmail.invoice.subjectTail", {
    docNumber: i.id.slice(0, 8),
    dueDate: fmtDate(i.dueDate),
  });
  return who
    ? t(lang, "paperworkEmail.invoice.subjectFrom", { tail, who })
    : tail;
}

/**
 * Rich invoice email — mirrors the WOW quote email (renderQuoteHtml): pink
 * ribbon, hero, job-details, line items, a prominent amount-due card, and a
 * personal contact card. Drops the agreement's legal clauses + signature
 * block (an invoice is a bill, not the contract). Adds a "View signed
 * agreement" link when the linked contract is signed.
 *
 * Quote-linked invoices only — a standalone invoice (no linked quote/contract)
 * has no itemized job to show and falls back to renderInvoiceBasicHtml.
 */
function renderInvoiceHtml(
  i: Invoice,
  customer: Customer | undefined,
  sender: User | undefined,
  senderBiz: BusinessIdentity | undefined,
  quote?: Quote,
  contract?: Contract,
): string {
  const es = senderBiz?.commsLanguage === "es";
  const lang: Lang = es ? "es" : "en";
  const items = quote?.lineItems ?? [];
  const agreementTotal = contract?.totalAmount ?? quote?.estimatedTotal ??
    (items.length
      ? items.reduce((s, li) => s + (li.price ?? 0) * (li.quantity ?? 1), 0)
      : undefined);
  // Standalone invoice → lightweight amount-only email (unchanged behavior).
  if (items.length === 0 && agreementTotal == null) {
    return renderInvoiceBasicHtml(i, customer, sender, lang);
  }

  const docNumber = `#${i.id.slice(0, 8).toUpperCase()}`;
  const issued = fmtDate(i.issuedDate ?? i.createdAt);
  const amount = i.amount;
  const isMilestone = (i.installmentTotal ?? 1) > 1;
  const showAgreementContext = agreementTotal != null &&
    (isMilestone || agreementTotal !== amount);

  const L = {
    docLang: lang,
    kindLabel: t(lang, "paperworkEmail.invoice.kindLabel"),
    issuedLabel: t(lang, "paperworkEmail.invoice.issuedLabel"),
    preparedFor: t(lang, "paperworkEmail.quote.preparedFor"),
    by: t(lang, "paperworkEmail.quote.by"),
    jobDetails: t(lang, "paperworkEmail.quote.jobDetails"),
    whatWeHandle: t(lang, "paperworkEmail.quote.whatWeHandle"),
    agreementValue: t(lang, "contractDoc.agreementValue"),
    amountDue: t(lang, "paperworkEmail.invoice.amountDueLabel"),
    dueLabel: t(lang, "paperworkEmail.invoice.dueLabel"),
    pasteLink: t(lang, "paperworkEmail.pasteLink"),
    cta: t(lang, "paperworkEmail.invoice.cta"),
    viewSigned: t(lang, "publicInvoice.viewSignedAgreement"),
    downloadPdf: t(lang, "publicInvoice.downloadPdf"),
    questions: t(lang, "paperworkEmail.quote.questions"),
    yourContractor: t(lang, "paperworkEmail.quote.yourContractor"),
  };

  const jobName = (quote?.jobNameByLang?.[lang] ?? quote?.jobName)?.trim();
  const summaryClean = ((quote?.summaryByLang?.[lang] ?? quote?.summary) ?? "")
    .replace(/^\s*quote\s*:\s*/i, "").trim();
  const heroRaw = jobName || summaryClean ||
    t(lang, "publicInvoice.jobNameFallback");
  const heroTitle = heroRaw.replace(/\b\w/g, (c) => c.toUpperCase());
  const description = quote?.descriptionByLang?.[lang] ?? quote?.description;

  const ctaUrl = `${APP_URL}/i/${i.id}`;
  const signedUrl = contract && contract.status === "signed"
    ? `${APP_URL}/c/${contract.id}`
    : undefined;
  const pdfUrl = `${APP_URL}/api/invoices/${i.id}/pdf`;

  const customerFirst = customer?.name?.trim().split(/\s+/)[0];
  const senderFirst = sender?.name?.trim()?.split(/\s+/)[0];
  const senderInitials = (() => {
    const n = sender?.name?.trim();
    if (!n) return "PM";
    const parts = n.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return parts[0].slice(0, 2).toUpperCase();
  })();
  const senderRoleLine = sender?.name?.trim()
    ? escapeHtml(sender.name.trim())
    : L.yourContractor;

  const preheader = `${
    customerFirst
      ? `${t(lang, "paperworkEmail.quote.preheaderFor")} ${customerFirst} — `
      : ""
  }${heroRaw} · ${fmtUSD(amount)}`;

  const lineRows = items.map((li, idx) => {
    const lineTotal = (li.price ?? 0) * (li.quantity ?? 1);
    const qty = li.quantity ?? 1;
    const subBits = [
      qty > 1 ? `${qty} ${escapeHtml(li.unit ?? "ea")}` : null,
      qty > 1
        ? t(lang, "paperworkEmail.quote.lineEach", {
          price: fmtUSD(li.price ?? 0),
        })
        : null,
    ].filter(Boolean).join(" · ");
    const sub = subBits
      ? `<div style="margin-top:2px;color:${COLOR_MUTED};font-size:12px">${subBits}</div>`
      : "";
    const last = idx === items.length - 1;
    const border = last ? "" : `border-bottom:1px solid ${COLOR_LINE};`;
    return `<tr>
      <td style="padding:14px 0;${border}vertical-align:middle">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
          <tr>
            <td style="vertical-align:middle;width:18px">
              <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${COLOR_PINK};vertical-align:middle"></span>
            </td>
            <td style="vertical-align:middle;color:${COLOR_INK};font-size:15px;font-weight:600">
              ${escapeHtml(li.description)}
              ${sub}
            </td>
            <td style="vertical-align:middle;text-align:right;color:${COLOR_INK};font-weight:800;font-size:15px;font-variant-numeric:tabular-nums;white-space:nowrap;padding-left:14px">
              ${fmtUSD(lineTotal)}
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
  }).join("");

  const descLines = (description ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[••\-*]\s*/, "").trim())
    .filter(Boolean);
  const descBlock = descLines.length > 1
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top:8px;border-collapse:collapse"><tbody>${
      descLines.map((l) =>
        `<tr>
            <td style="vertical-align:top;width:18px;padding:8px 0 0"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${COLOR_PINK}"></span></td>
            <td style="vertical-align:top;padding:3px 0;font-size:15px;line-height:1.5;color:${COLOR_INK}">${
          escapeHtml(l)
        }</td>
          </tr>`
      ).join("")
    }</tbody></table>`
    : `<p style="margin:8px 0 0;font-size:15px;line-height:1.55;color:${COLOR_INK};white-space:pre-wrap">${
      escapeHtml(descLines[0] ?? "")
    }</p>`;

  const greeting = customerGreeting(customer, lang);
  const dueSub = i.dueDate
    ? `<div style="margin-top:4px;color:${COLOR_MUTED};font-size:12px">${
      escapeHtml(t(lang, "publicInvoice.dueOn", { date: fmtDate(i.dueDate) }))
    }</div>`
    : "";
  const milestoneSub = (isMilestone && i.installmentIndex && i.installmentTotal)
    ? `<div style="margin-top:2px;color:${COLOR_MUTED};font-size:12px">${
      escapeHtml(
        t(lang, "publicInvoice.milestone.head", {
          idx: i.installmentIndex,
          total: i.installmentTotal,
        }),
      )
    }${
      showAgreementContext
        ? ` · ${escapeHtml(L.agreementValue)} ${fmtUSD(agreementTotal)}`
        : ""
    }</div>`
    : (showAgreementContext
      ? `<div style="margin-top:2px;color:${COLOR_MUTED};font-size:12px">${
        escapeHtml(L.agreementValue)
      } ${fmtUSD(agreementTotal)}</div>`
      : "");

  return `<!doctype html>
<html lang="${L.docLang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>${escapeHtml(L.kindLabel)} ${escapeHtml(docNumber)}</title>
</head>
<body style="margin:0;padding:0;background:${COLOR_BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${COLOR_INK};line-height:1.5;">
  <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all">${
    escapeHtml(preheader)
  }</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${COLOR_BG};">
    <tr><td align="center" style="padding:40px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="640" style="max-width:640px;background:${COLOR_CARD};border-radius:24px;overflow:hidden;box-shadow:0 12px 40px rgba(20,72,82,0.10);">

        <!-- pink ribbon header -->
        <tr><td style="height:6px;background:linear-gradient(90deg,${COLOR_PINK} 0%,${COLOR_PINK_DARK} 100%);font-size:0;line-height:0">&nbsp;</td></tr>

        <!-- doc tag + issued date -->
        <tr><td style="padding:32px 36px 0;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td style="vertical-align:top">
                <span style="display:inline-block;background:rgba(255,107,107,0.10);color:${COLOR_PINK_DARK};font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;padding:6px 12px;border-radius:999px">${
    escapeHtml(L.kindLabel)
  } · ${escapeHtml(docNumber)}</span>
              </td>
              <td style="vertical-align:top;text-align:right;color:${COLOR_MUTED};font-size:12px;font-weight:600">
                ${escapeHtml(L.issuedLabel)} ${escapeHtml(issued)}
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- hero title -->
        <tr><td style="padding:18px 36px 0;">
          <h1 style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:36px;letter-spacing:-0.025em;color:${COLOR_TEAL};line-height:1.05">${
    escapeHtml(heroTitle)
  }</h1>
          ${
    customerFirst
      ? `<div style="margin-top:10px;color:${COLOR_MUTED};font-size:14px">${L.preparedFor} <strong style="color:${COLOR_INK}">${
        escapeHtml(customerFirst)
      }</strong>${
        senderFirst
          ? ` ${L.by} <strong style="color:${COLOR_INK}">${
            escapeHtml(senderFirst)
          }</strong>`
          : ""
      }</div>`
      : ""
  }
        </td></tr>

        <!-- greeting + intro -->
        <tr><td style="padding:28px 36px 0;">
          <p style="margin:0 0 8px;font-size:16px;font-weight:700;color:${COLOR_INK}">${greeting}</p>
          <p style="margin:0;font-size:15px;color:${COLOR_INK};line-height:1.55">${
    escapeHtml(t(lang, "paperworkEmail.invoice.intro"))
  }</p>
        </td></tr>

        <!-- divider -->
        <tr><td style="padding:24px 36px 0"><div style="height:1px;background:${COLOR_LINE}"></div></td></tr>

        ${
    description
      ? `
        <tr><td style="padding:18px 36px 0">
          <div style="font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:${COLOR_MUTED}">${L.jobDetails}</div>
          ${descBlock}
        </td></tr>
        <tr><td style="padding:18px 36px 0"><div style="height:1px;background:${COLOR_LINE}"></div></td></tr>
        `
      : ""
  }

        ${
    items.length > 1
      ? `
        <tr><td style="padding:18px 36px 0">
          <div style="font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:${COLOR_MUTED}">${L.whatWeHandle}</div>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top:6px;border-collapse:collapse">
            <tbody>${lineRows}</tbody>
          </table>
        </td></tr>
        `
      : ""
  }

        <!-- amount due card (the money moment) -->
        <tr><td style="padding:24px 36px 0">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:linear-gradient(135deg,#e8f3e2 0%,#dceadb 100%);border:1px solid rgba(81,152,67,0.25);border-radius:18px">
            <tr>
              <td style="padding:22px 24px">
                <div style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${COLOR_GREEN}">${
    escapeHtml(L.amountDue)
  }</div>
                ${dueSub}
                ${milestoneSub}
              </td>
              <td style="padding:22px 24px;text-align:right;vertical-align:middle">
                <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:42px;letter-spacing:-0.03em;color:${COLOR_TEAL};line-height:1;font-variant-numeric:tabular-nums">${
    fmtUSD(amount)
  }</div>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- big CTA -->
        <tr><td style="padding:28px 36px 0;text-align:center">
          <a href="${
    escapeAttr(ctaUrl)
  }" style="display:inline-block;background:${COLOR_GREEN};color:#ffffff;text-decoration:none;font-weight:800;font-size:16px;padding:18px 32px;border-radius:14px;box-shadow:0 10px 22px -6px rgba(81,152,67,0.55);letter-spacing:.005em">${
    escapeHtml(L.cta)
  } &nbsp;→</a>
          <div style="margin-top:14px;font-size:11px;color:${COLOR_MUTED}">${
    escapeHtml(L.pasteLink)
  }<br><a href="${escapeAttr(ctaUrl)}" style="color:${COLOR_MUTED};word-break:break-all">${
    escapeHtml(ctaUrl)
  }</a></div>
        </td></tr>

        <!-- secondary actions: download PDF + (when signed) view agreement -->
        <tr><td style="padding:18px 36px 0;text-align:center">
          <a href="${
    escapeAttr(pdfUrl)
  }" style="display:inline-block;color:${COLOR_TEAL};text-decoration:none;font-weight:700;font-size:13px;border:1px solid ${COLOR_LINE};border-radius:12px;padding:11px 18px;margin:0 4px">⬇ ${
    escapeHtml(L.downloadPdf)
  }</a>${
    signedUrl
      ? `<a href="${
        escapeAttr(signedUrl)
      }" style="display:inline-block;color:${COLOR_TEAL};text-decoration:none;font-weight:700;font-size:13px;border:1px solid ${COLOR_LINE};border-radius:12px;padding:11px 18px;margin:0 4px">📄 ${
        escapeHtml(L.viewSigned)
      }</a>`
      : ""
  }
        </td></tr>

        <!-- divider -->
        <tr><td style="padding:32px 36px 0"><div style="height:1px;background:${COLOR_LINE}"></div></td></tr>

        <!-- contact card -->
        <tr><td style="padding:22px 36px 32px">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td valign="middle" style="width:48px">
                <div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,${COLOR_GREEN} 0%,#71a85f 100%);color:#fff;font-weight:800;font-size:14px;line-height:44px;text-align:center;letter-spacing:.04em">${
    escapeHtml(senderInitials)
  }</div>
              </td>
              <td valign="middle" style="padding-left:14px">
                <div style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${COLOR_MUTED}">${
    escapeHtml(L.questions)
  }</div>
                <div style="margin-top:3px;font-weight:800;color:${COLOR_TEAL};font-size:15px">${senderRoleLine}</div>
                ${
    sender?.phoneNumber
      ? `<div style="margin-top:1px;color:${COLOR_INK};font-size:13px"><a href="tel:${
        escapeAttr(sender.phoneNumber)
      }" style="color:${COLOR_INK};text-decoration:none">${
        escapeHtml(sender.phoneNumber)
      }</a></div>`
      : ""
  }
                ${
    sender?.email
      ? `<div style="margin-top:1px;color:${COLOR_INK};font-size:13px"><a href="mailto:${
        escapeAttr(sender.email)
      }" style="color:${COLOR_INK};text-decoration:none">${
        escapeHtml(sender.email)
      }</a></div>`
      : ""
  }
              </td>
            </tr>
          </table>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** Lightweight amount-only invoice email (the original) — used for standalone
 *  invoices with no linked quote/contract to itemize. */
function renderInvoiceBasicHtml(
  i: Invoice,
  customer: Customer | undefined,
  sender: User | undefined,
  lang: Lang,
): string {
  const docNumber = `#${i.id.slice(0, 8)}`;
  const drafted = fmtDate(i.issuedDate ?? new Date().toISOString());
  const amount = i.amount;
  // Standalone invoices carry their own job title + note (no quote behind
  // them). Surface them so a quote-less invoice email isn't just a bare figure.
  const jobName = (i as { jobName?: string }).jobName?.trim();
  const description = (i as { description?: string }).description?.trim();
  const jobBlock = (jobName || description)
    ? `${
      jobName
        ? `<div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:22px;letter-spacing:-0.02em;color:${COLOR_TEAL};margin-bottom:${
          description ? "6" : "16"
        }px">${escapeHtml(jobName)}</div>`
        : ""
    }${
      description
        ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:${COLOR_INK};white-space:pre-wrap">${
          escapeHtml(description)
        }</p>`
        : ""
    }`
    : "";

  const body = `${jobBlock}
    <div style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${COLOR_MUTED};">${
    escapeHtml(t(lang, "paperworkEmail.invoice.detailsLabel"))
  }</div>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top:8px;border-collapse:collapse;">
      <tr><td style="padding:6px 0;color:${COLOR_MUTED};font-size:13px;">${
    escapeHtml(t(lang, "paperworkEmail.invoice.issuedLabel"))
  }</td><td style="padding:6px 0;text-align:right;color:${COLOR_INK};font-weight:700;font-size:14px;">${
    escapeHtml(fmtDate(i.issuedDate))
  }</td></tr>
      <tr><td style="padding:6px 0;color:${COLOR_MUTED};font-size:13px;">${
    escapeHtml(t(lang, "paperworkEmail.invoice.dueLabel"))
  }</td><td style="padding:6px 0;text-align:right;color:${COLOR_INK};font-weight:700;font-size:14px;">${
    escapeHtml(fmtDate(i.dueDate))
  }</td></tr>
      <tr><td style="padding:6px 0;color:${COLOR_MUTED};font-size:13px;">${
    escapeHtml(t(lang, "paperworkEmail.invoice.statusLabel"))
  }</td><td style="padding:6px 0;text-align:right;color:${COLOR_INK};font-weight:700;font-size:14px;text-transform:capitalize;">${
    escapeHtml(i.status ?? t(lang, "paperworkEmail.invoice.statusFallback"))
  }</td></tr>
    </table>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top:18px;background:linear-gradient(135deg,rgba(81,152,67,0.10),rgba(72,158,95,0.04));border:1px solid rgba(72,158,95,0.20);border-radius:14px;">
      <tr>
        <td style="padding:18px 20px;">
          <div style="font-size:11px;font-weight:800;letter-spacing:.10em;text-transform:uppercase;color:${COLOR_GREEN};">${
    escapeHtml(t(lang, "paperworkEmail.invoice.amountDueLabel"))
  }</div>
        </td>
        <td style="padding:18px 20px;text-align:right;">
          <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:28px;letter-spacing:-0.02em;color:${COLOR_TEAL};">${
    fmtUSD(amount)
  }</div>
        </td>
      </tr>
    </table>`;

  return shell({
    preheader: t(lang, "paperworkEmail.invoice.preheader", {
      docNumber,
      amount: fmtUSD(amount),
      dueDate: fmtDate(i.dueDate),
    }),
    kindLabel: t(lang, "paperworkEmail.invoice.kindLabel"),
    docNumber,
    drafted,
    greeting: customerGreeting(customer, lang),
    intro: t(lang, "paperworkEmail.invoice.intro"),
    body,
    ctaLabel: t(lang, "paperworkEmail.invoice.cta"),
    ctaUrl: `${APP_URL}/i/${i.id}`,
    sender,
    lang,
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function escapeAttr(s: string): string {
  // Same as escapeHtml; kept separate so future tightening (e.g. URL allowlists)
  // can target attribute contexts without touching the body escape.
  return escapeHtml(s);
}
