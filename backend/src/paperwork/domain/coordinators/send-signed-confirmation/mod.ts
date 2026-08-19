import { Injectable } from "#danet/core";
import { ContractStore } from "@paperwork/domain/data/contract-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { EmailService } from "@communication/domain/data/email-service/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { RenderContractPdf } from "@paperwork/domain/coordinators/render-contract-pdf/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { buildSignedConfirmSms, smsJobName } from "#quote-flow/sms-i18n.ts";
import { reconcileMilestones } from "#quote-flow/milestone-reconcile.ts";
import type { Contract, ContractTerm } from "@paperwork/dto/contract.ts";
import { computePaymentSplit } from "#payment-split";
import { type Lang, t } from "@core/i18n/mod.ts";
import type { User } from "@users/dto/user.ts";
import type { Customer } from "@crm/dto/customer.ts";

const COLOR_TEAL = "#144852";
const COLOR_GREEN = "#519843";
const COLOR_INK = "#1c2c30";
const COLOR_MUTED = "#6b7a7e";
const COLOR_LINE = "#e3e8e6";
const COLOR_BG = "#f7f6f1";
const COLOR_PINK = "#FF6B6B";
const COLOR_PINK_DARK = "#d94e4e";

const APP_URL = (() => {
  const explicit = Deno.env.get("APP_URL")?.trim() || undefined;
  const force = Deno.env.get("APP_URL_FORCE") === "1";
  const isProd = Deno.env.get("APP_ENV")?.toLowerCase() === "prod" ||
    !!Deno.env.get("DENO_DEPLOYMENT_ID");
  if (isProd) return explicit ?? "https://paperworkmonster.com";
  // Honor explicit APP_URL in dev when it targets localhost (set by
  // serve.ts to point at the running frontend port). FORCE remains the
  // opt-in for tunnel URLs.
  if (explicit && /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(explicit)) {
    return explicit;
  }
  if (force && explicit) return explicit;
  return "http://localhost:5280";
})();

/**
 * SendSignedConfirmation — fires after a contract is signed.
 *
 *   1. Renders a PDF copy of the signed contract (for the customer's
 *      records and for legal/disputes — pure JS via pdf-lib so it works
 *      on Deno Deploy).
 *   2. Auto-creates the **first invoice** from the contract's payment
 *      schedule (the deposit, if 30/30/40 or 50/50; otherwise the full
 *      net-15 invoice, etc.).
 *   3. Dispatches a confirmation email to the customer with the PDF
 *      attached and a payment-link button to the new invoice.
 *   4. Sends a completion SMS to the customer (roadmap p.2) — best-effort,
 *      independent of the email.
 *
 * Idempotent: a `signedNotifiedAt` stamp on the contract guards against
 * double-sends if signContract is replayed (Postmark webhooks, retries).
 *
 * Errors here NEVER fail the upstream sign request — they're logged and
 * swallowed. The customer's signature is captured regardless.
 */
@Injectable()
export class SendSignedConfirmation {
  constructor(
    private contracts: ContractStore,
    private quotes: QuoteStore,
    private invoices: InvoiceStore,
    private customers: CustomerStore,
    private users: UserStore,
    private identity: BusinessIdentityStore,
    private renderPdf: RenderContractPdf,
    private email: EmailService,
    private sms: SmsService,
    private commsLog: LogPaperworkMessage,
  ) {}

  async run(
    contractId: string,
  ): Promise<
    { ok: boolean; reason?: string; messageId?: string; invoiceId?: string }
  > {
    let contract: Contract;
    try {
      contract = await this.contracts.get(contractId);
    } catch (err) {
      return {
        ok: false,
        reason: `contract not found: ${(err as Error).message}`,
      };
    }

    // Idempotency guard.
    const signedNotifiedAt =
      (contract as { signedNotifiedAt?: string }).signedNotifiedAt;
    if (signedNotifiedAt) {
      return { ok: true, reason: "already_notified" };
    }

    const userId = contract.userId;
    const [contractor, ident, contractCustomer, quote] = await Promise.all([
      this.users.get(userId).catch(() => undefined as User | undefined),
      this.identity.get(userId).catch(() => null),
      contract.customerId
        ? this.customers.getOwned(contract.customerId, userId).catch(() =>
          undefined as Customer | undefined
        )
        : Promise.resolve(undefined as Customer | undefined),
      contract.quoteId
        ? this.quotes.getOwned(contract.quoteId, userId).catch(() => undefined)
        : Promise.resolve(undefined),
    ]);

    // Fall back to the quote's customer if the contract was created
    // without one bound (e.g., older API-created demo contracts).
    let customer = contractCustomer;
    if (!customer && quote?.customerId) {
      customer = await this.customers.getOwned(quote.customerId, userId).catch(
        () => undefined,
      );
    }

    const recipient = customer?.email?.trim();

    const businessName = ident?.businessName?.trim() ||
      ident?.legalName?.trim() || contractor?.name?.trim();

    // Roadmap p.13: customer-facing comms resolve to the contractor's
    // outgoing-comms language (default en), not their UI language.
    const lang: Lang = ident?.commsLanguage === "es" ? "es" : "en";

    // ---- 1. Create the full milestone set (first invoice sent now,
    // remaining ones scheduled for equal-spaced dates over the contract's
    // completion window).
    const total = contract.totalAmount ?? 0;
    const plannedMilestones = computeMilestoneAmounts(total, contract.terms);
    // UX-36: bill only the unbilled remainder. A late /c sign on a deal that
    // was already invoiced (or fully paid) must never re-bill the customer —
    // every non-void invoice on the deal counts as committed.
    let milestoneAmounts: number[] = plannedMilestones;
    try {
      const allInvoices = await this.invoices.listByUser(userId);
      const existing = allInvoices.filter((i) =>
        i.contractId === contract.id ||
        (contract.quoteId && i.quoteId === contract.quoteId)
      );
      milestoneAmounts = reconcileMilestones(plannedMilestones, total, existing);
    } catch (err) {
      console.error(
        "[send-signed-confirmation] milestone reconcile failed; billing the full plan:",
        err,
      );
    }
    let invoiceId: string | undefined;
    if (milestoneAmounts.length > 0) {
      const today = new Date();
      const todayIso = today.toISOString().slice(0, 10);
      const scheduledDates = computeScheduledDates(
        milestoneAmounts.length,
        contract.startDate,
        contract.estimatedCompletionDate,
        today,
      );
      const installmentTotal = milestoneAmounts.length;
      // "Due Now" payment terms (roadmap p.6): the single invoice is due the
      // day of signing, not the usual net-7 grace window.
      const dueNow = /\bdue now\b/i.test(
        contract.terms?.find((t) => t.stepId === "payment_terms")?.value ?? "",
      );
      for (let i = 0; i < milestoneAmounts.length; i++) {
        const amount = milestoneAmounts[i];
        const isFirst = i === 0;
        try {
          // First milestone fires immediately (matches prior behavior);
          // the rest are scheduled placeholders the contractor nudge cron
          // will surface on their scheduledFor date.
          const dueDate = isFirst
            ? (dueNow ? todayIso : addDaysIso(today, 7))
            : addDaysIso(parseIsoDate(scheduledDates[i]), 7);
          const invoice = await this.invoices.create(userId, {
            contractId: contract.id,
            ...(contract.customerId ? { customerId: contract.customerId } : {}),
            amount,
            dueDate,
            installmentIndex: i + 1,
            installmentTotal,
            ...(isFirst
              ? { issuedDate: todayIso, status: "sent" }
              : { status: "scheduled", scheduledFor: scheduledDates[i] }),
          });
          if (isFirst) invoiceId = invoice.id;
        } catch (err) {
          console.error(
            `[send-signed-confirmation] milestone ${
              i + 1
            }/${installmentTotal} create failed:`,
            err,
          );
        }
      }
    }

    // Stamp signedNotifiedAt immediately after creating the invoices — BEFORE
    // the slower PDF/email/SMS steps — so the top-of-run idempotency guard
    // closes the duplicate-invoice window as tightly as possible. signContract
    // flips status and fires run() non-atomically, so a double-tap / retry can
    // launch two run()s; stamping here means the second sees the stamp and
    // returns before creating a second milestone set. Best-effort: a failed
    // stamp only risks a (rare) duplicate on replay, never a missed invoice.
    try {
      await this.contracts.update(contract.id, userId, {
        ...({ signedNotifiedAt: new Date().toISOString() } as Partial<
          Contract
        >),
      } as Partial<Contract>);
    } catch (err) {
      console.error(
        "[send-signed-confirmation] failed to stamp signedNotifiedAt:",
        err,
      );
    }

    // ---- 2. Email the customer (PDF attached) — only when there's an email
    // on file. No email is NOT an error: the invoices above still exist and
    // the completion SMS below still fires. The PDF is only needed for the
    // attachment, so render it here (and tolerate a render failure rather than
    // dropping the whole confirmation).
    let sent: { ok: boolean; reason?: string; messageId?: string } = {
      ok: false,
      reason: "no_customer_email",
    };
    if (recipient) {
      console.log(
        `[send-signed-confirmation] dispatching to ${recipient} for contract ${contract.id}`,
      );
      let pdfBytes: Uint8Array | undefined;
      try {
        pdfBytes = await this.renderPdf.run({
          contract,
          quote,
          customer,
          contractor,
          ...(businessName ? { businessName } : {}),
          ...(ident?.commsLanguage
            ? { commsLanguage: ident.commsLanguage }
            : {}),
        });
      } catch (err) {
        console.error("[send-signed-confirmation] PDF render failed:", err);
      }
      const subject = t(lang, "signedConfirm.email.subject", {
        summary: quote?.summary ?? t(lang, "signedConfirm.fallback.contract"),
      });
      const html = renderSignedConfirmationHtml({
        contract,
        quote,
        customer,
        contractor,
        businessName,
        invoiceId,
        invoiceAmount: milestoneAmounts[0] ?? 0,
        lang,
      });
      const fileName = `Contract-${contract.id.slice(0, 8).toUpperCase()}.pdf`;
      sent = await this.email.send({
        to: recipient,
        subject,
        htmlBody: html,
        ...(pdfBytes
          ? {
            attachments: [{
              name: fileName,
              content: pdfBytes,
              contentType: "application/pdf",
            }],
          }
          : {}),
      });
      console.log(
        sent.ok
          ? `[send-signed-confirmation] sent to ${recipient} messageId=${
            sent.messageId ?? "(dev-mode)"
          } invoiceId=${invoiceId ?? "(none)"}`
          : `[send-signed-confirmation] dispatch FAILED to ${recipient} reason=${sent.reason}`,
      );
    } else {
      console.warn(
        `[send-signed-confirmation] contract ${contract.id} has no customer email; created ${milestoneAmounts.length} invoice(s), skipping email`,
      );
    }

    // ---- 4. Completion SMS (roadmap p.2: signed quotes get a text too).
    //      Best-effort and independent of the email; the run-level
    //      `signedNotifiedAt` guard already prevents double-sends on replay.
    try {
      const toSms = normalizeE164(customer?.phoneNumber ?? "");
      if (toSms) {
        // P-30: the shared builder handles the unnamed-customer greeting
        // natively ("Hola, …" / "Hi there, …") — never prefill a fallback
        // name here, or ES renders the doubled "Hola hola, …".
        const first = (customer?.name ?? "").trim().split(/\s+/)[0] ||
          undefined;
        const body = buildSignedConfirmSms({
          customerFirstName: first,
          jobName: smsJobName(quote ?? {}, lang),
          url: `${APP_URL}/c/${contract.id}`,
          businessName,
          lang,
        });
        const res = await this.sms.send({ to: toSms, body });
        // Comms trail (roadmap p.8): record the dispatch like every other
        // outbound text so it's queryable per document.
        if (res.ok) {
          await this.commsLog.run({
            userId,
            customerId: customer?.id,
            channel: "text",
            content: body,
            toAddress: toSms,
            paperworkId: contract.id,
            paperworkType: "contract",
          });
        }
      }
    } catch (err) {
      console.error("[send-signed-confirmation] completion SMS failed:", err);
    }

    return {
      ok: sent.ok || !!invoiceId,
      ...(sent.reason ? { reason: sent.reason } : {}),
      ...(sent.messageId ? { messageId: sent.messageId } : {}),
      ...(invoiceId ? { invoiceId } : {}),
    };
  }

  /**
   * Quote-accept flavor of the completion text (deck p.2/p.8: "Post
   * Quotes/Signed Quotes we need to send a completion Text" — the CUSTOMER
   * gets a confirmation their acceptance registered, and the receipts strip
   * gets an honest customer-facing "texted" line instead of the contractor
   * self-alert it used to count, P-32). Email is not duplicated here — the
   * customer already holds the quote email, and the accepted state renders
   * on /q/:id itself.
   *
   * At-most-once: the accept endpoint 409s on a second accept, so this
   * fires once per quote lifetime. Best-effort like the contract flavor.
   */
  async runForQuote(quoteId: string): Promise<{ ok: boolean }> {
    try {
      const quote = await this.quotes.get(quoteId);
      const userId = quote.userId;
      const [ident, customer] = await Promise.all([
        this.identity.get(userId).catch(() => null),
        quote.customerId
          ? this.customers.getOwned(quote.customerId, userId).catch(() =>
            undefined as Customer | undefined
          )
          : Promise.resolve(undefined as Customer | undefined),
      ]);
      const toSms = normalizeE164(customer?.phoneNumber ?? "");
      if (!toSms) return { ok: false };
      const contractor = await this.users.get(userId).catch(() =>
        undefined as User | undefined
      );
      const businessName = ident?.businessName?.trim() ||
        ident?.legalName?.trim() || contractor?.name?.trim();
      const lang: Lang = ident?.commsLanguage === "es" ? "es" : "en";
      const first = (customer?.name ?? "").trim().split(/\s+/)[0] || undefined;
      const body = buildSignedConfirmSms({
        customerFirstName: first,
        jobName: smsJobName(quote ?? {}, lang),
        url: `${APP_URL}/q/${quote.id}`,
        businessName,
        lang,
      });
      const res = await this.sms.send({ to: toSms, body });
      if (res.ok) {
        await this.commsLog.run({
          userId,
          customerId: customer?.id,
          channel: "text",
          content: body,
          toAddress: toSms,
          paperworkId: quote.id,
          paperworkType: "quote",
        });
      }
      return { ok: res.ok };
    } catch (err) {
      console.error("[send-signed-confirmation] quote completion SMS failed:", err);
      return { ok: false };
    }
  }
}

/* ---------------- helpers ---------------- */

/** Normalize a raw phone to E.164 (US-default). Mirrors the helper in
 *  send-paperwork-sms; returns undefined when it can't be made valid. */
function normalizeE164(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (/^\+[1-9]\d{6,14}$/.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return undefined;
}

/** Resolve the contractor's chosen payment terms into one amount per
 *  milestone, in INTEGER CENTS, via the shared #payment-split source of truth
 *  so the invoices match the preview, the signed contract, and the PDF. Sum is
 *  always exactly `total` — the last milestone absorbs rounding. */
export function computeMilestoneAmounts(
  total: number,
  terms: ContractTerm[] | undefined,
): number[] {
  const v = terms?.find((t) => t.stepId === "payment_terms")?.value;
  return computePaymentSplit(v, total).map((p) => p.amountCents);
}

/** Equal-spaced scheduledFor dates for milestones 2..N. The first
 *  milestone fires immediately (issued today) so it doesn't need a
 *  scheduledFor — we return its slot as today's date anyway for the
 *  array shape, but callers should ignore it.
 *
 *  Window math:
 *    - If contract has both startDate and estimatedCompletionDate, span
 *      that interval.
 *    - Otherwise fall back to a 14-day default window from today.
 *    - Each subsequent milestone gets (i / N) of the window.
 */
export function computeScheduledDates(
  count: number,
  startDate: string | undefined,
  estimatedCompletionDate: string | undefined,
  today: Date,
): string[] {
  if (count <= 0) return [];
  const start = startDate ? parseIsoDate(startDate) : today;
  const end = estimatedCompletionDate
    ? parseIsoDate(estimatedCompletionDate)
    : addDays(today, 14);
  const windowMs = Math.max(end.getTime() - start.getTime(), 24 * 3600 * 1000);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    if (i === 0) {
      out.push(today.toISOString().slice(0, 10));
      continue;
    }
    const offsetMs = Math.round((windowMs * i) / (count - 1 || 1));
    const d = new Date(start.getTime() + offsetMs);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function parseIsoDate(iso: string): Date {
  // Treat dates as UTC midnight to avoid TZ drift on day arithmetic.
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(d.getTime()) ? d : new Date();
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addDaysIso(d: Date, days: number): string {
  return addDays(d, days).toISOString().slice(0, 10);
}

function fmtUSD(cents: number | undefined): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "—";
  const dollars = cents / 100;
  return `$${
    dollars.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }`;
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
  return escapeHtml(s).replace(/`/g, "&#96;");
}

interface SignedHtmlOpts {
  contract: Contract;
  // deno-lint-ignore no-explicit-any
  quote: any;
  customer: Customer | undefined;
  contractor: User | undefined;
  businessName: string | undefined;
  invoiceId: string | undefined;
  invoiceAmount: number;
  lang: Lang;
}

function renderSignedConfirmationHtml(opts: SignedHtmlOpts): string {
  const {
    contract,
    quote,
    customer,
    contractor,
    businessName,
    invoiceId,
    invoiceAmount,
    lang,
  } = opts;
  const customerFirst = customer?.name?.trim().split(/\s+/)[0];
  const contractorFirst = contractor?.name?.trim()?.split(/\s+/)[0];
  const biz = businessName ?? contractor?.name ??
    t(lang, "signedConfirm.email.bizFallback");
  const summary = (quote?.summary ?? t(lang, "signedConfirm.fallback.project"))
    .replace(
      /^\s*quote\s*:\s*/i,
      "",
    );
  const docNumber = `#${contract.id.slice(0, 8).toUpperCase()}`;
  const invoiceUrl = invoiceId ? `${APP_URL}/i/${invoiceId}` : undefined;
  const contractUrl = `${APP_URL}/c/${contract.id}`;
  const greeting = customerFirst
    ? t(lang, "signedConfirm.email.greeting", {
      name: escapeHtml(customerFirst),
    })
    : t(lang, "signedConfirm.email.greetingFallback");
  const preheader = t(lang, "signedConfirm.email.preheader", {
    state: invoiceUrl
      ? t(lang, "signedConfirm.email.preheaderReady")
      : t(lang, "signedConfirm.email.preheaderSoon"),
  });
  const subhead = t(lang, "signedConfirm.email.subhead", {
    biz: escapeHtml(biz),
    who: customerFirst
      ? escapeHtml(customerFirst)
      : t(lang, "signedConfirm.email.subheadYou"),
    summary: escapeHtml(summary),
  });
  const bodyParagraph = t(lang, "signedConfirm.email.bodyBase", {
    invoiceClause: invoiceUrl
      ? t(lang, "signedConfirm.email.bodyInvoiceClause", {
        amount: fmtUSD(invoiceAmount),
      })
      : "",
    who: contractorFirst
      ? escapeHtml(contractorFirst)
      : t(lang, "signedConfirm.email.bodyContractorFallback"),
  });

  return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light only">
  <title>${
    t(lang, "signedConfirm.email.title", { docNumber: escapeHtml(docNumber) })
  }</title>
</head>
<body style="margin:0;padding:0;background:${COLOR_BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${COLOR_INK};line-height:1.5;">
  <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all">${
    escapeHtml(preheader)
  }</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${COLOR_BG};">
    <tr><td align="center" style="padding:40px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="640" style="max-width:640px;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 12px 40px rgba(20,72,82,0.10);">
        <tr><td style="height:6px;background:linear-gradient(90deg,${COLOR_GREEN} 0%,#71a85f 100%);font-size:0;line-height:0">&nbsp;</td></tr>

        <tr><td style="padding:32px 36px 0">
          <span style="display:inline-block;background:rgba(81,152,67,0.12);color:${COLOR_GREEN};font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;padding:6px 12px;border-radius:999px">✓ ${
    t(lang, "signedConfirm.email.pill", { docNumber: escapeHtml(docNumber) })
  }</span>
        </td></tr>

        <tr><td style="padding:18px 36px 0">
          <h1 style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:32px;letter-spacing:-0.025em;color:${COLOR_TEAL};line-height:1.05">${
    t(lang, "signedConfirm.email.hero")
  }</h1>
          <div style="margin-top:8px;color:${COLOR_MUTED};font-size:14px">${subhead}</div>
        </td></tr>

        <tr><td style="padding:24px 36px 0">
          <p style="margin:0 0 8px;font-size:15px;color:${COLOR_INK}">${greeting}</p>
          <p style="margin:0;font-size:15px;color:${COLOR_INK};line-height:1.55">
            ${bodyParagraph}
          </p>
        </td></tr>

        ${
    invoiceUrl
      ? `<tr><td style="padding:24px 36px 0">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:linear-gradient(135deg,#fff5f0 0%,#ffe9df 100%);border:1px solid rgba(255,107,107,0.30);border-radius:18px">
                <tr>
                  <td style="padding:22px 24px;vertical-align:middle">
                    <div style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${COLOR_PINK_DARK}">${
        t(lang, "signedConfirm.email.invoiceEyebrow")
      }</div>
                    <div style="margin-top:4px;color:${COLOR_MUTED};font-size:12px">${
        t(lang, "signedConfirm.email.invoiceDue")
      }</div>
                  </td>
                  <td style="padding:22px 24px;text-align:right;vertical-align:middle">
                    <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:30px;letter-spacing:-0.02em;color:${COLOR_TEAL};line-height:1">${
        fmtUSD(invoiceAmount)
      }</div>
                  </td>
                </tr>
                <tr>
                  <td colspan="2" style="padding:0 24px 22px">
                    <a href="${
        escapeAttr(invoiceUrl)
      }" style="display:inline-block;background:${COLOR_PINK};color:#ffffff;text-decoration:none;font-weight:800;font-size:14px;padding:12px 22px;border-radius:12px;box-shadow:0 8px 18px -6px rgba(255,107,107,0.55)">${
        t(lang, "signedConfirm.email.invoiceCta")
      }  →</a>
                  </td>
                </tr>
              </table>
            </td></tr>`
      : ""
  }

        <tr><td style="padding:24px 36px 0">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${COLOR_BG};border-radius:14px;border:1px solid ${COLOR_LINE}">
            <tr>
              <td style="padding:16px 20px;vertical-align:middle;width:60px">
                <div style="width:42px;height:42px;border-radius:10px;background:${COLOR_TEAL};color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;letter-spacing:.06em">${
    t(lang, "signedConfirm.email.pdfLabel")
  }</div>
              </td>
              <td style="padding:16px 20px 16px 0;vertical-align:middle">
                <div style="color:${COLOR_INK};font-weight:800;font-size:14px">Contract-${
    escapeHtml(contract.id.slice(0, 8).toUpperCase())
  }.pdf</div>
                <div style="margin-top:2px;color:${COLOR_MUTED};font-size:12px">${
    t(lang, "signedConfirm.email.attachmentSub")
  }</div>
              </td>
            </tr>
          </table>
        </td></tr>

        <tr><td style="padding:28px 36px 0;text-align:center">
          <a href="${
    escapeAttr(contractUrl)
  }" style="display:inline-block;background:transparent;color:${COLOR_TEAL};text-decoration:none;font-weight:700;font-size:13px;padding:8px 0;border-bottom:1px solid ${COLOR_LINE}">${
    t(lang, "signedConfirm.email.viewOnline")
  } →</a>
        </td></tr>

        <tr><td style="padding:32px 36px 0"><div style="height:1px;background:${COLOR_LINE}"></div></td></tr>

        <tr><td style="padding:22px 36px 32px">
          <div style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${COLOR_MUTED}">${
    t(lang, "signedConfirm.email.fromLabel")
  }</div>
          <div style="margin-top:6px;font-weight:800;color:${COLOR_TEAL};font-size:15px">${
    escapeHtml(contractor?.name ?? biz)
  }</div>
          ${
    contractor?.phoneNumber
      ? `<div style="margin-top:2px;color:${COLOR_INK};font-size:13px">${
        escapeHtml(contractor.phoneNumber)
      }</div>`
      : ""
  }
          ${
    contractor?.email
      ? `<div style="margin-top:2px;color:${COLOR_INK};font-size:13px">${
        escapeHtml(contractor.email)
      }</div>`
      : ""
  }
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
