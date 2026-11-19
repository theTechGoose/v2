import { Injectable } from "#danet/core";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { EmailService } from "@communication/domain/data/email-service/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { customerLabel } from "@communication/domain/business/outbox-entry/mod.ts";
import { businessFrom } from "@communication/domain/business/sender/mod.ts";
import {
  customerSmsTarget,
  dispatchCustomerSms,
} from "@paperwork/domain/business/customer-sms/mod.ts";
import {
  emailLogo,
  emailLogoHtml,
} from "@paperwork/domain/business/email-logo/mod.ts";
import {
  changeOrderRef,
  customerOnDocument,
  docRef,
  docRefWithVersion,
  isIssued,
} from "@paperwork/domain/business/doc-render/mod.ts";
import {
  type AlertCopy,
  buildChangeOrderDecisionAlert,
  buildChangeOrderReceipt,
  buildQuoteDeclinedAlert,
  channelsOnFile,
} from "@paperwork/domain/business/decision-alert/mod.ts";
import { type Lang, t } from "@core/i18n/mod.ts";
import { SITE_ORIGIN } from "#quote-flow/site-meta.ts";
import { resolveCommsLanguage } from "#quote-flow/comms-language.ts";
import { changeOrderJobTotals } from "#quote-flow/change-order-view.ts";
import type { User } from "@users/dto/user.ts";
import type { ChangeOrder } from "@paperwork/dto/change-order.ts";

const APP_URL = (() => {
  const explicit = Deno.env.get("APP_URL")?.trim() || undefined;
  const isProd = Deno.env.get("APP_ENV")?.toLowerCase() === "prod" ||
    !!Deno.env.get("DENO_DEPLOYMENT_ID");
  if (isProd) return explicit ?? SITE_ORIGIN;
  if (explicit && /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(explicit)) {
    return explicit;
  }
  return "http://localhost:5280";
})();

export interface DecisionAlertResult {
  ok: boolean;
  reason?: string;
  /** the channels that went: "contractor-email", "customer-text", … */
  sent: string[];
}

/**
 * SendDecisionAlert — REQ-948 (LOOP-007 q1-21, q1-22). The customer's answer
 * on a public page reaches the contractor by email AND text, the way accept
 * (SendAcceptedAlert) and a question (SendInquiryAlert, REQ-031) already do:
 *
 *   • `quoteDeclined` — POST /quotes/:id/decline: the contractor learns who
 *     declined which quote, the reason in words and the note.
 *   • `changeOrderDecided` — POST /change-orders/:id/approve|decline: the
 *     contractor learns the decision, the change, the delta and the invoice
 *     total after it; on approve the customer also gets a receipt (email, and
 *     a text when a textable phone is on file) naming what changed, who
 *     approved it and when, and her new total, with the invoice's /i link.
 *
 * Contractor copy is in their UI language; the customer's receipt in her
 * comms language (REQ-715). Each send lands in the comms trail behind
 * /messages; the customer's receipt also lands in the outbox (REQ-784).
 *
 * Best-effort: every send is try/caught and nothing here throws past the
 * caller's .catch. Replay-guarded: `declineNotifiedAt` on the quote and
 * `decisionNotifiedAt` on the change order are claimed compare-and-set
 * before anything is sent, so a retry or a double click sends nothing new.
 */
@Injectable()
export class SendDecisionAlert {
  constructor(
    private quotes: QuoteStore,
    private changeOrders: ChangeOrderStore,
    private invoices: InvoiceStore,
    private customers: CustomerStore,
    private users: UserStore,
    private identity: BusinessIdentityStore,
    private email: EmailService,
    private sms: SmsService,
    private commsLog: LogPaperworkMessage,
  ) {}

  async quoteDeclined(quoteId: string): Promise<DecisionAlertResult> {
    const claimed = await this.quotes.updateIf(
      quoteId,
      (q) =>
        q.status === "lost" &&
        !(q.declineNotifiedAt && q.lostAt &&
          q.declineNotifiedAt >= q.lostAt),
      { declineNotifiedAt: new Date().toISOString() },
    );
    if (!claimed) return { ok: true, reason: "already_notified", sent: [] };
    const quote = claimed;
    const [contractor, liveCustomer] = await Promise.all([
      this.users.get(quote.userId).catch(() => undefined),
      quote.customerId
        ? this.customers.getOwned(quote.customerId, quote.userId).catch(() =>
          undefined
        )
        : Promise.resolve(undefined),
    ]);
    if (!contractor) return { ok: false, reason: "no_contractor", sent: [] };
    const lang: Lang = contractor.language === "es" ? "es" : "en";
    const shown = customerOnDocument(quote, liveCustomer);
    const customerName = quote.declinedName?.trim() ||
      customerLabel(shown) || t(lang, "notify.fallbackClient");
    const jobName = (quote.jobNameByLang?.[lang] ?? quote.jobName)?.trim() ||
      quote.summary?.trim() || undefined;
    const copy = buildQuoteDeclinedAlert({
      lang,
      customerName,
      docLabel: docRefWithVersion(quote, lang),
      ...(jobName ? { jobName } : {}),
      ...(quote.declineReason ? { reason: quote.declineReason } : {}),
      ...(quote.declineNote ? { note: quote.declineNote } : {}),
      url: `${APP_URL}/quotes?open=${encodeURIComponent(quote.id)}`,
    });
    const sent = await this.alertContractor(contractor, {
      userId: quote.userId,
      customerId: quote.customerId,
      copy,
      trail: `quote ${quote.id} declined by ${customerName}`,
    });
    return result(sent);
  }

  /** REQ-1055 (LOOP-007 q2-39): the job's agreed total after change order
   *  `co` — the same `changeOrderJobTotals` figure GET
   *  /change-orders/:id/public returns as `jobNewAmount` and /co heads with.
   *  Undefined when the order has no linked quote of the same owner. */
  private async jobTotalAfter(
    co: ChangeOrder,
    invoiceQuoteId: string | undefined,
  ): Promise<number | undefined> {
    const quoteId = co.quoteId ?? invoiceQuoteId;
    if (!quoteId) return undefined;
    const q = await this.quotes.get(quoteId).catch(() => undefined);
    if (!q || q.userId !== co.userId) return undefined;
    const cos = await this.changeOrders.listByQuote(co.userId, q.id)
      .catch(() => [] as ChangeOrder[]);
    return changeOrderJobTotals(
      q,
      cos.some((c) => c.id === co.id) ? cos : [...cos, co],
      co.id,
    ).afterCents;
  }

  async changeOrderDecided(coId: string): Promise<DecisionAlertResult> {
    const co = await this.changeOrders.claimDecisionNotice(coId);
    if (!co) return { ok: true, reason: "already_notified", sent: [] };
    const decision = co.status === "approved" ? "approved" : "declined";
    const [contractor, liveCustomer, ident, invoice] = await Promise.all([
      this.users.get(co.userId).catch(() => undefined),
      co.customerId
        ? this.customers.getOwned(co.customerId, co.userId).catch(() =>
          undefined
        )
        : Promise.resolve(undefined),
      this.identity.get(co.userId).catch(() => null),
      this.invoices.get(co.invoiceId).catch(() => undefined),
    ]);
    if (!contractor) return { ok: false, reason: "no_contractor", sent: [] };
    const cxLang: Lang = contractor.language === "es" ? "es" : "en";
    const customer = customerOnDocument(co, liveCustomer);
    const customerName =
      (decision === "approved" ? co.approvedName?.trim() : undefined) ||
      customerLabel(customer) ||
      t(cxLang, "notify.fallbackClient");
    const total = typeof invoice?.amount === "number"
      ? invoice.amount
      : undefined;

    const sent = await this.alertContractor(contractor, {
      userId: co.userId,
      customerId: co.customerId,
      copy: buildChangeOrderDecisionAlert({
        lang: cxLang,
        decision,
        customerName,
        ref: changeOrderRef(co, invoice, cxLang),
        description: co.description,
        deltaCents: co.deltaAmountCents,
        ...(typeof total === "number" ? { invoiceTotalCents: total } : {}),
        url: `${APP_URL}/invoices?open=${encodeURIComponent(co.invoiceId)}`,
      }),
      trail: `change order ${docRef(co)} ${decision} by ${customerName}`,
    });

    if (decision === "approved" && typeof total === "number") {
      // ── the customer's receipt, in her language ─────────────────────
      const coLang: Lang = resolveCommsLanguage({
        customerLanguage: liveCustomer?.language,
        identityCommsLanguage: ident?.commsLanguage,
        sendLanguages: ident?.commsLanguages,
      });
      const businessName = ident?.businessName?.trim() ||
        ident?.legalName?.trim() || contractor.name?.trim() ||
        t(coLang, "changeOrderPublic.contractorFallback");
      const ref = changeOrderRef(co, invoice, coLang);
      const jobTotalCents = await this.jobTotalAfter(co, invoice?.quoteId);
      const copy = buildChangeOrderReceipt({
        lang: coLang,
        businessName,
        ref,
        description: co.description,
        deltaCents: co.deltaAmountCents,
        newTotalCents: total,
        ...(typeof jobTotalCents === "number" ? { jobTotalCents } : {}),
        ...(invoice && isIssued(invoice)
          ? { invoiceLabel: docRef(invoice) }
          : {}),
        ...(co.approvedName ? { approvedName: co.approvedName } : {}),
        ...(co.decidedAt ? { approvedAt: co.decidedAt } : {}),
        url: `${APP_URL}/i/${encodeURIComponent(co.invoiceId)}?lang=${coLang}`,
        logoHtml: emailLogoHtml(emailLogo({
          appUrl: APP_URL,
          kind: "invoice",
          id: co.invoiceId,
          biz: ident,
          fallbackName: businessName,
        })),
      });
      const to = channelsOnFile({
        email: liveCustomer?.email || customer?.email,
        phoneNumber: liveCustomer?.phoneNumber || customer?.phoneNumber,
      });
      const outboxFacts = {
        userId: co.userId,
        kind: "changeOrder" as const,
        language: coLang,
        customerId: co.customerId ?? liveCustomer?.id,
        customerName: customerLabel(customer),
        docId: co.id,
        docRef: docRef(co),
      };
      if (to.email) {
        try {
          const res = await this.email.send({
            to: to.email,
            subject: copy.subject,
            htmlBody: copy.html,
            from: businessFrom({
              alias: ident?.emailAlias,
              name: businessName,
            }),
          });
          console.log(
            `[send-decision-alert] co ${co.id} receipt email → ${to.email}: ok=${res.ok}${
              res.reason ? ` (${res.reason})` : ""
            }`,
          );
          await this.commsLog.outbox({
            ...outboxFacts,
            channel: "email",
            ok: res.ok,
            ...(res.ok ? {} : { reason: res.reason }),
            to: to.email,
            subject: copy.subject,
            body: copy.html,
          });
          if (res.ok) {
            sent.push("customer-email");
            await this.commsLog.run({
              userId: co.userId,
              customerId: co.customerId,
              channel: "email",
              content: `change order ${docRef(co)} approval receipt`,
              subject: copy.subject,
              htmlBody: copy.html,
              toAddress: to.email,
              paperworkId: co.id,
              paperworkType: "changeOrder",
            });
          }
        } catch (err) {
          console.error("[send-decision-alert] receipt email failed:", err);
        }
      }
      const target = customerSmsTarget(to.phone);
      if (target.ok) {
        try {
          const res = await dispatchCustomerSms(this.sms, {
            to: target.e164,
            body: copy.sms,
            uiLang: cxLang,
          });
          await this.commsLog.outbox({
            ...outboxFacts,
            channel: "text",
            ok: res.ok,
            ...(res.ok
              ? {}
              : { reasonCode: res.failureCode, reason: res.reason }),
            to: res.to,
            body: copy.sms,
          });
          if (res.ok) {
            sent.push("customer-text");
            await this.commsLog.run({
              userId: co.userId,
              customerId: co.customerId,
              channel: "text",
              content: copy.sms,
              toAddress: res.to,
              paperworkId: co.id,
              paperworkType: "changeOrder",
            });
          }
        } catch (err) {
          console.error("[send-decision-alert] receipt text failed:", err);
        }
      }
    }
    return result(sent);
  }

  /** The contractor's email + text, each logged to the comms trail as a
   *  self-alert (no paperworkId — P-32: not a customer delivery). */
  private async alertContractor(
    contractor: User,
    o: {
      userId: string;
      customerId?: string;
      copy: AlertCopy;
      trail: string;
    },
  ): Promise<string[]> {
    const sent: string[] = [];
    const to = channelsOnFile(contractor);
    if (to.email) {
      try {
        const res = await this.email.send({
          to: to.email,
          subject: o.copy.subject,
          htmlBody: o.copy.html,
        });
        console.log(
          `[send-decision-alert] ${o.trail} — email → ${to.email}: ok=${res.ok}${
            res.reason ? ` (${res.reason})` : ""
          }`,
        );
        if (res.ok) {
          sent.push("contractor-email");
          await this.commsLog.run({
            userId: o.userId,
            customerId: o.customerId,
            channel: "email",
            content: `${o.trail} — alert email to ${to.email}`,
            subject: o.copy.subject,
            toAddress: to.email,
          });
        }
      } catch (err) {
        console.error("[send-decision-alert] contractor email failed:", err);
      }
    }
    if (to.phone) {
      try {
        const res = await this.sms.send({ to: to.phone, body: o.copy.sms });
        console.log(
          `[send-decision-alert] ${o.trail} — sms → ${to.phone}: ok=${res.ok}${
            res.reason ? ` (${res.reason})` : ""
          }`,
        );
        if (res.ok) {
          sent.push("contractor-text");
          await this.commsLog.run({
            userId: o.userId,
            customerId: o.customerId,
            channel: "text",
            content: `${o.trail} — alert text: ${o.copy.sms}`,
            toAddress: to.phone,
          });
        }
      } catch (err) {
        console.error("[send-decision-alert] contractor sms failed:", err);
      }
    }
    return sent;
  }
}

function result(sent: string[]): DecisionAlertResult {
  return sent.length
    ? { ok: true, sent }
    : { ok: false, reason: "no_contact", sent };
}
