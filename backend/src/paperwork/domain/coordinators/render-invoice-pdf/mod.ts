import { Injectable } from "#danet/core";
import { PDFDocument, rgb, StandardFonts } from "#pdf-lib";
import { t } from "@core/i18n/mod.ts";
import { computePaymentSplit, type MilestoneRole } from "#payment-split";
import { localizeDepositTerm } from "#quote-flow/deposit-term.ts"; // REQ-678
import type { Quote, QuoteTerm } from "@paperwork/dto/quote.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { isAccepted } from "#quote-flow/quote-status.ts";
import { isTbdTermValue } from "#quote-flow/terms-i18n.ts";
import { formatTermDate, termDateIso } from "#quote-flow/format-helpers.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { SITE_ORIGIN } from "#quote-flow/site-meta.ts";
import { winAnsiSafeDeep } from "@paperwork/domain/business/pdf-text/mod.ts";
import {
  customerLines,
  customerOnDocument,
  docRef,
  docRefWithVersion,
  fmtTaxRate,
  paymentStateLines,
  renderWord,
  revisedNote,
} from "@paperwork/domain/business/doc-render/mod.ts";
import { fmtVisitDate, groupVisits } from "#quote-flow/visit-groups.ts";

const APP_URL = (() => {
  const explicit = Deno.env.get("APP_URL")?.trim() || undefined;
  const force = Deno.env.get("APP_URL_FORCE") === "1";
  const isProd = Deno.env.get("APP_ENV")?.toLowerCase() === "prod" ||
    !!Deno.env.get("DENO_DEPLOYMENT_ID");
  if (isProd) return explicit ?? SITE_ORIGIN;
  if (explicit && /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(explicit)) {
    return explicit;
  }
  if (force && explicit) return explicit;
  return "http://localhost:5280";
})();

/**
 * RenderInvoicePdf — pure-JS server-side PDF of an invoice, sibling of
 * RenderQuotePdf. It mirrors the signed-agreement document (business
 * header, Bill-to/From, itemized job details, agreement-value total, payment
 * schedule, the wizard-captured term grid) but DROPS the 14 numbered legal
 * clauses and the signature block, and adds the amount due for THIS invoice
 * plus a reference line to the signed agreement when one exists.
 *
 * Loads everything from an invoiceId: invoice → (quoteId) quote →
 * contractor (User + BusinessIdentity) + customer.
 * Standalone invoices (no quote) still render a minimal valid PDF
 * (header + amount due + jobName/description) rather than throwing.
 *
 * Returns the PDF as Uint8Array bytes.
 */
@Injectable()
export class RenderInvoicePdf {
  constructor(
    private invoices: InvoiceStore,
    private quotes: QuoteStore,
    private customers: CustomerStore,
    private users: UserStore,
    private identity: BusinessIdentityStore,
  ) {}

  async run(invoiceId: string): Promise<Uint8Array> {
    // REQ-161: the standard fonts encode WinAnsi only — every string drawn comes from here
    const invoice = winAnsiSafeDeep(await this.invoices.get(invoiceId));
    // customer / contractor / ident depend only on the invoice, so fan them
    // out concurrently with the quote fetch instead of awaiting serially
    // (this is an uncached, customer-facing "Download PDF" endpoint).
    const [quote, customer, contractor, ident] = winAnsiSafeDeep(
      await Promise.all([
        invoice.quoteId
          ? this.quotes.get(invoice.quoteId).catch(() =>
            undefined as Quote | undefined
          )
          : Promise.resolve(undefined as Quote | undefined),
        invoice.customerId
          ? this.customers.getOwned(invoice.customerId, invoice.userId).catch(
            () => undefined,
          )
          : Promise.resolve(undefined),
        this.users.get(invoice.userId).catch(() => undefined),
        this.identity.get(invoice.userId).catch(() => null),
      ]),
    );
    const businessName = ident?.businessName ?? ident?.legalName;
    const es = ident?.commsLanguage === "es";
    const lang: "en" | "es" = es ? "es" : "en";

    const pdf = await PDFDocument.create();
    // REQ-204: the document is named by its number, never an id slice
    pdf.setTitle(`${renderWord(lang, "invoice")} ${docRef(invoice)}`);
    pdf.setAuthor(contractor?.name ?? businessName ?? "Contractor");
    pdf.setSubject(quote?.summary ?? invoice.jobName ?? "Invoice");
    pdf.setProducer(businessName ?? contractor?.name ?? "Contractor");
    if (invoice.createdAt) pdf.setCreationDate(new Date(invoice.createdAt));
    pdf.setModificationDate(new Date());

    const reg = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const W = 612, H = 792;
    const M = 54;
    let page = pdf.addPage([W, H]);
    let y = H;

    const PINK = rgb(1.0, 0.42, 0.42);
    const PINK_DARK = rgb(0.85, 0.31, 0.31);
    const TEAL = rgb(0.078, 0.282, 0.322);
    const INK = rgb(0.11, 0.17, 0.19);
    const MUTED = rgb(0.42, 0.48, 0.49);
    const LINE = rgb(0.89, 0.91, 0.90);
    const GREEN = rgb(0.318, 0.596, 0.263);
    const GREEN_BG = rgb(0.91, 0.95, 0.88);

    const addPageIfNeeded = (need: number) => {
      if (y - need < M) {
        page = pdf.addPage([W, H]);
        y = H;
      }
    };

    let sec = 0;
    const sn = () => String(++sec).padStart(2, "0");

    // pink ribbon
    page.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: PINK });
    y = H - 8;

    // business eyebrow
    const biz = (businessName ?? contractor?.name ??
      t(lang, "renderQuotePdf.businessFallback")).toUpperCase();
    y -= 32;
    drawCenteredText(page, biz, W, y, bold, 9, PINK_DARK, 0.18);

    // doc tag pill (left) + status (right)
    y -= 32;
    const docTag = t(lang, "paperworkEmail.invoice.kindLabel").toUpperCase();
    // REQ-204 / REQ-201: "INVOICE · INV-5000 · Version 2"
    const docNum = `${docTag} · ${docRefWithVersion(invoice, lang)}`;
    page.drawText(docNum, { x: M, y, size: 8.5, font: bold, color: PINK_DARK });
    const paid = invoice.status === "paid" || !!invoice.paidAt;
    const payState = paymentStateLines(invoice, lang);
    const statusText = paid
      ? t(lang, "status.paid").toUpperCase()
      : (invoice.status ?? "due").toUpperCase();
    const statusW = bold.widthOfTextAtSize(statusText, 8.5);
    page.drawText(statusText, {
      x: W - M - statusW,
      y,
      size: 8.5,
      font: bold,
      color: paid ? GREEN : PINK_DARK,
    });
    // REQ-201: a revision says so — "Revised invoice — replaces previous version"
    const revised = revisedNote("invoice", invoice, lang);
    if (revised) {
      y -= 14;
      page.drawText(revised, {
        x: M,
        y,
        size: 8.5,
        font: reg,
        color: PINK_DARK,
      });
    }

    // Hero title
    y -= 36;
    const heroTitle = (quote?.summaryByLang?.[lang] ?? quote?.summary ??
      invoice.jobName ?? t(lang, "renderQuotePdf.heroFallback"))
      .replace(/^\s*quote\s*:\s*/i, "")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    page.drawText(heroTitle, { x: M, y, size: 24, font: bold, color: TEAL });
    y -= 24;

    // REQ-173: a batch invoice — the address is a heading, the visits sit under it
    const visits = groupVisits(invoice.lineItems);
    if (visits) {
      for (const g of visits) {
        addPageIfNeeded(40);
        page.drawText(g.address, {
          x: M,
          y,
          size: 10.5,
          font: bold,
          color: TEAL,
        });
        y -= 8;
        page.drawLine({
          start: { x: M, y },
          end: { x: W - M, y },
          thickness: 0.5,
          color: LINE,
        });
        y -= 13;
        for (const v of g.visits) {
          addPageIfNeeded(24);
          page.drawText(fmtVisitDate(v.date, lang), {
            x: M,
            y,
            size: 9.5,
            font: reg,
            color: MUTED,
          });
          page.drawText(v.service, {
            x: M + 56,
            y,
            size: 10,
            font: reg,
            color: INK,
          });
          const amt = fmtUSD(v.price);
          page.drawText(amt, {
            x: W - M - bold.widthOfTextAtSize(amt, 10),
            y,
            size: 10,
            font: bold,
            color: INK,
          });
          y -= 8;
          page.drawLine({
            start: { x: M, y },
            end: { x: W - M, y },
            thickness: 0.4,
            color: LINE,
          });
          y -= 13;
        }
        y -= 6;
      }
      y -= 6;
    }

    // Standalone description (no quote line items) — render as a paragraph.
    if (!visits && !quote?.lineItems?.length && invoice.description) {
      y = drawWrappedText(
        page,
        invoice.description,
        M,
        y,
        W - 2 * M,
        reg,
        10,
        MUTED,
        13,
      );
      y -= 12;
    }

    // TO / FROM block — Bill to (customer) / From (contractor).
    {
      const colGap = 24;
      const colW2 = (W - 2 * M - colGap) / 2;
      const fromX = M + colW2 + colGap;
      // REQ-204: an issued bill shows the customer as snapshotted (billTo
      // first); a draft may show the live record.
      const shown = customerOnDocument(invoice, customer);
      page.drawText(t(lang, "publicInvoice.billTo").toUpperCase(), {
        x: M,
        y,
        size: 8,
        font: bold,
        color: MUTED,
      });
      page.drawText(t(lang, "renderQuotePdf.contact.from"), {
        x: fromX,
        y,
        size: 8,
        font: bold,
        color: MUTED,
      });
      y -= 14;
      const toLines = customerLines(shown);
      const fromLines = [
        contractor?.name,
        businessName,
        contractor?.phoneNumber,
        contractor?.email,
        // REQ-168: the business website
        ident?.websiteUrl?.trim().replace(/^https?:\/\//i, "").replace(
          /\/$/,
          "",
        ),
      ].filter((v): v is string => !!v && v.trim().length > 0);
      const rows = Math.max(toLines.length, fromLines.length, 1);
      for (let i = 0; i < rows; i++) {
        if (toLines[i]) {
          page.drawText(toLines[i], {
            x: M,
            y,
            size: 9,
            font: i === 0 ? bold : reg,
            color: i === 0 ? INK : MUTED,
          });
        }
        if (fromLines[i]) {
          page.drawText(fromLines[i], {
            x: fromX,
            y,
            size: 9,
            font: i === 0 ? bold : reg,
            color: i === 0 ? INK : MUTED,
          });
        }
        y -= 12;
      }
      y -= 14;
    }

    // Amount due card (this invoice) — the money moment for a bill.
    addPageIfNeeded(70);
    page.drawRectangle({
      x: M,
      y: y - 56,
      width: W - 2 * M,
      height: 56,
      color: GREEN_BG,
    });
    // REQ-201/202: "PAID <date>", "Paid $X · Balance $Y" on a partial
    // payment, else "Amount due · Due <date>".
    const partial = !paid && (invoice.paidCents ?? 0) > 0;
    page.drawText(
      (paid ? renderWord(lang, "paid") : t(lang, "publicInvoice.amountDue"))
        .toUpperCase(),
      { x: M + 16, y: y - 22, size: 9, font: bold, color: GREEN },
    );
    const sub = paid
      ? fmtDate(invoice.paidAt)
      : partial
      ? payState.headline
      : invoice.dueDate
      ? t(lang, "publicInvoice.dueOn", { date: fmtDate(invoice.dueDate) })
      : undefined;
    if (sub) {
      page.drawText(sub, {
        x: M + 16,
        y: y - 36,
        size: 9,
        font: reg,
        color: MUTED,
      });
    }
    const dueStr = fmtUSD(
      partial
        ? Math.max(0, (invoice.amount ?? 0) - (invoice.paidCents ?? 0))
        : invoice.amount,
    );
    const dueW = bold.widthOfTextAtSize(dueStr, 26);
    page.drawText(dueStr, {
      x: W - M - 16 - dueW,
      y: y - 38,
      size: 26,
      font: bold,
      color: TEAL,
    });
    y -= 78;
    if (payState.overpaid) {
      // REQ-202: an overpayment is flagged, never hidden
      page.drawText(payState.overpaid, {
        x: M,
        y,
        size: 9,
        font: bold,
        color: PINK_DARK,
      });
      y -= 18;
    }

    // REQ-206: a standalone invoice is complete on its own — where the work
    // was done, when, the math behind the total, how to pay, and the quote it
    // bills against.
    {
      const rows: Array<[string, string]> = [];
      if (invoice.serviceAddress?.trim()) {
        rows.push([
          renderWord(lang, "serviceAddress"),
          invoice.serviceAddress.trim(),
        ]);
      }
      if (invoice.serviceDateFrom || invoice.serviceDateTo) {
        const from = invoice.serviceDateFrom
          ? fmtDate(invoice.serviceDateFrom)
          : "";
        const to = invoice.serviceDateTo ? fmtDate(invoice.serviceDateTo) : "";
        rows.push([
          renderWord(lang, "serviceDates"),
          from && to && from !== to ? `${from} – ${to}` : from || to,
        ]);
      }
      if (typeof invoice.subtotalCents === "number") {
        rows.push([
          renderWord(lang, "subtotal"),
          fmtUSD(invoice.subtotalCents),
        ]);
      }
      if (invoice.discountCents) {
        const reason = invoice.discountReason?.trim();
        rows.push([
          reason
            ? `${renderWord(lang, "discount")} · ${reason}`
            : renderWord(lang, "discount"),
          `-${fmtUSD(invoice.discountCents)}`,
        ]);
      }
      if (
        typeof invoice.taxCents === "number" ||
        typeof invoice.taxRateBp === "number"
      ) {
        const rate = fmtTaxRate(invoice.taxRateBp);
        rows.push([
          rate
            ? `${renderWord(lang, "tax")} (${rate})`
            : renderWord(lang, "tax"),
          fmtUSD(invoice.taxCents ?? 0),
        ]);
      }
      if (quote) {
        rows.push([renderWord(lang, "originalQuote"), docRef(quote)]);
      }
      for (const [label, value] of rows) {
        addPageIfNeeded(18);
        page.drawText(label, { x: M, y, size: 9, font: bold, color: MUTED });
        const valueW = reg.widthOfTextAtSize(value, 9.5);
        const labelW = bold.widthOfTextAtSize(label, 9);
        if (labelW + valueW + 16 <= W - 2 * M) {
          page.drawText(value, {
            x: W - M - valueW,
            y,
            size: 9.5,
            font: reg,
            color: INK,
          });
          y -= 16;
        } else {
          y -= 13;
          y = drawWrappedText(page, value, M, y, W - 2 * M, reg, 9.5, INK, 13);
          y -= 4;
        }
      }
      if (invoice.paymentInstructions?.trim()) {
        addPageIfNeeded(40);
        page.drawText(renderWord(lang, "paymentInstructions"), {
          x: M,
          y,
          size: 9,
          font: bold,
          color: MUTED,
        });
        y -= 13;
        y = drawWrappedText(
          page,
          invoice.paymentInstructions.trim(),
          M,
          y,
          W - 2 * M,
          reg,
          9.5,
          INK,
          13,
        );
        y -= 4;
      }
      if (rows.length || invoice.paymentInstructions?.trim()) y -= 10;
    }

    const agreementTotal = quote?.estimatedTotal ??
      (quote?.lineItems ?? []).reduce(
        (s, li) => s + (li.price ?? 0) * (li.quantity ?? 1),
        0,
      );

    // Section: Job details (line items) + agreement-value total card.
    if (quote?.lineItems?.length) {
      addPageIfNeeded(60);
      y = drawSectionHeader(
        page,
        y,
        M,
        sn(),
        t(lang, "renderQuotePdf.section.jobDetails"),
        bold,
        PINK,
        TEAL,
      );
      y -= 8;
      page.drawText(t(lang, "renderQuotePdf.table.description"), {
        x: M,
        y,
        size: 8,
        font: bold,
        color: MUTED,
      });
      const amountHdr = t(lang, "renderQuotePdf.table.amount");
      page.drawText(amountHdr, {
        x: W - M - bold.widthOfTextAtSize(amountHdr, 8),
        y,
        size: 8,
        font: bold,
        color: MUTED,
      });
      y -= 6;
      page.drawLine({
        start: { x: M, y },
        end: { x: W - M, y },
        thickness: 0.5,
        color: LINE,
      });
      y -= 14;
      for (const li of quote.lineItems) {
        addPageIfNeeded(28);
        const lineTotal = (li.price ?? 0) * (li.quantity ?? 1);
        page.drawText(li.description, {
          x: M,
          y,
          size: 11,
          font: reg,
          color: INK,
        });
        const amt = fmtUSD(lineTotal);
        page.drawText(amt, {
          x: W - M - bold.widthOfTextAtSize(amt, 11),
          y,
          size: 11,
          font: bold,
          color: INK,
        });
        y -= 10;
        page.drawLine({
          start: { x: M, y },
          end: { x: W - M, y },
          thickness: 0.4,
          color: LINE,
        });
        y -= 12;
      }
      // Agreement-value total card
      addPageIfNeeded(70);
      y -= 4;
      page.drawRectangle({
        x: M,
        y: y - 56,
        width: W - 2 * M,
        height: 56,
        color: GREEN_BG,
      });
      page.drawText(t(lang, "renderQuotePdf.total.label"), {
        x: M + 16,
        y: y - 22,
        size: 9,
        font: bold,
        color: GREEN,
      });
      page.drawText(t(lang, "renderQuotePdf.total.subtext"), {
        x: M + 16,
        y: y - 36,
        size: 9,
        font: reg,
        color: MUTED,
      });
      const totalStr = fmtUSD(agreementTotal);
      const totalW = bold.widthOfTextAtSize(totalStr, 26);
      page.drawText(totalStr, {
        x: W - M - 16 - totalW,
        y: y - 38,
        size: 26,
        font: bold,
        color: TEAL,
      });
      y -= 78;
    }

    // Section: Payment schedule (derived from the agreement's payment terms).
    const milestones = computeMilestones(agreementTotal, quote?.terms, lang);
    if (milestones.length > 0) {
      addPageIfNeeded(110);
      y = drawSectionHeader(
        page,
        y,
        M,
        sn(),
        t(lang, "renderQuotePdf.section.paymentSchedule"),
        bold,
        PINK,
        TEAL,
      );
      y -= 12;
      const colW = (W - 2 * M - (milestones.length - 1) * 8) /
        milestones.length;
      for (let i = 0; i < milestones.length; i++) {
        const m = milestones[i];
        const cx = M + i * (colW + 8);
        page.drawRectangle({
          x: cx,
          y: y - 56,
          width: colW,
          height: 56,
          borderColor: LINE,
          borderWidth: 0.6,
        });
        page.drawText(m.label.toUpperCase(), {
          x: cx + 12,
          y: y - 18,
          size: 8,
          font: bold,
          color: PINK_DARK,
        });
        page.drawText(fmtUSD(m.amount), {
          x: cx + 12,
          y: y - 34,
          size: 14,
          font: bold,
          color: TEAL,
        });
        page.drawText(m.when, {
          x: cx + 12,
          y: y - 48,
          size: 8,
          font: reg,
          color: MUTED,
        });
      }
      y -= 72;
    }

    // Section: Schedule (start / estimated completion dates).
    if (quote?.startDate || quote?.estimatedCompletionDate) {
      addPageIfNeeded(60);
      y = drawSectionHeader(
        page,
        y,
        M,
        sn(),
        t(lang, "renderQuotePdf.section.schedule"),
        bold,
        PINK,
        TEAL,
      );
      y -= 12;
      if (quote.startDate) {
        page.drawText(t(lang, "renderQuotePdf.schedule.start"), {
          x: M,
          y,
          size: 9,
          font: bold,
          color: MUTED,
        });
        const v = fmtDate(quote.startDate);
        page.drawText(v, {
          x: W - M - bold.widthOfTextAtSize(v, 11),
          y,
          size: 11,
          font: bold,
          color: INK,
        });
        y -= 16;
      }
      if (quote.estimatedCompletionDate) {
        page.drawText(t(lang, "renderQuotePdf.schedule.estimatedCompletion"), {
          x: M,
          y,
          size: 9,
          font: bold,
          color: MUTED,
        });
        const v = fmtDate(quote.estimatedCompletionDate);
        page.drawText(v, {
          x: W - M - bold.widthOfTextAtSize(v, 11),
          y,
          size: 11,
          font: bold,
          color: INK,
        });
        y -= 16;
      }
      y -= 8;
    }

    // Section: Terms (wizard-captured grid; NO legal clauses, NO signature).
    if (quote?.terms && quote.terms.length > 0) {
      const visible = quote.terms.filter((term) => term.stepId !== "customer");
      if (visible.length > 0) {
        addPageIfNeeded(120);
        y = drawSectionHeader(
          page,
          y,
          M,
          sn(),
          t(lang, "renderQuotePdf.section.terms"),
          bold,
          PINK,
          TEAL,
        );
        y -= 12;
        const colCount = 2;
        const gap = 10;
        const cellW = (W - 2 * M - (colCount - 1) * gap) / colCount;
        const rowH = 38;
        for (let i = 0; i < visible.length; i += colCount) {
          addPageIfNeeded(rowH + 6);
          for (let c = 0; c < colCount; c++) {
            const term = visible[i + c];
            if (!term) break;
            const cx = M + c * (cellW + gap);
            page.drawRectangle({
              x: cx,
              y: y - rowH,
              width: cellW,
              height: rowH,
              borderColor: LINE,
              borderWidth: 0.5,
            });
            const termLabelKey: Record<string, string> = {
              start_date: "renderQuotePdf.termLabel.startDate",
              wraps: "renderQuotePdf.termLabel.duration",
              payment_terms: "renderQuotePdf.termLabel.paymentTerms",
              warranty: "renderQuotePdf.termLabel.warranty",
            };
            const labelText = es && termLabelKey[term.stepId]
              ? t(lang, termLabelKey[term.stepId])
              : term.label.toUpperCase();
            page.drawText(labelText, {
              x: cx + 10,
              y: y - 14,
              size: 7.5,
              font: bold,
              color: MUTED,
            });
            const localized = localizeTermValue(term.value, lang);
            // REQ-047: a TBD duration is not an estimate — print it bare.
            const displayValue = term.stepId === "wraps" &&
                !isTbdTermValue(term.value)
              ? t(lang, "renderQuotePdf.term.estimatedPrefix", {
                value: localized,
              })
              : localized;
            page.drawText(displayValue, {
              x: cx + 10,
              y: y - 28,
              size: 10.5,
              font: bold,
              color: INK,
            });
          }
          y -= rowH + 6;
        }
      }
    }

    // Signed-agreement reference (only when the linked quote is accepted).
    if (quote && isAccepted(quote)) {
      addPageIfNeeded(40);
      y -= 4;
      const ref = `${
        t(lang, "publicInvoice.viewSignedAgreement")
      }: ${APP_URL}/q/${quote.id}`;
      page.drawText(ref, { x: M, y, size: 9, font: reg, color: TEAL });
      y -= 18;
    }

    // Footer
    addPageIfNeeded(40);
    page.drawLine({
      start: { x: M, y },
      end: { x: W - M, y },
      thickness: 0.4,
      color: LINE,
    });
    y -= 14;
    // REQ-204: "INV-5000 · Version 2 · Generated <date>"
    drawCenteredText(
      page,
      `${docRefWithVersion(invoice, lang)} · ${
        renderWord(lang, "generated", {
          date: fmtDate(new Date().toISOString()),
        })
      }`,
      W,
      y,
      reg,
      8,
      MUTED,
      0,
    );

    return await pdf.save();
  }
}

/* ---------------- helpers (duplicated from render-quote-pdf; those are
   module-private there, and that file is intentionally left untouched) ------ */

// deno-lint-ignore no-explicit-any
type PDFPage = any;
// deno-lint-ignore no-explicit-any
type PDFFont = any;
// deno-lint-ignore no-explicit-any
type RGB = any;

function drawSectionHeader(
  page: PDFPage,
  y: number,
  m: number,
  n: string,
  title: string,
  bold: PDFFont,
  pink: RGB,
  teal: RGB,
): number {
  page.drawCircle({ x: m + 11, y: y - 11, size: 11, color: pink });
  page.drawText(n, {
    x: m + 7,
    y: y - 14,
    size: 9,
    font: bold,
    color: rgb(1, 1, 1),
  });
  page.drawText(title, {
    x: m + 30,
    y: y - 14,
    size: 14,
    font: bold,
    color: teal,
  });
  return y - 26;
}

function drawWrappedText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  w: number,
  font: PDFFont,
  size: number,
  color: RGB,
  line: number,
): number {
  const lines = wrap(text, font, size, w);
  let yy = y;
  for (const ln of lines) {
    page.drawText(ln, { x, y: yy, size, font, color });
    yy -= line;
  }
  return yy;
}

function drawCenteredText(
  page: PDFPage,
  text: string,
  w: number,
  y: number,
  font: PDFFont,
  size: number,
  color: RGB,
  letterSpacing: number,
): void {
  const tw = font.widthOfTextAtSize(text, size) +
    letterSpacing * (text.length - 1) * size;
  page.drawText(text, { x: (w - tw) / 2, y, size, font, color });
}

function wrap(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let line = "";
  for (const word of words) {
    const probe = line ? line + " " + word : word;
    if (font.widthOfTextAtSize(probe, size) <= maxWidth) {
      line = probe;
    } else {
      if (line) out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out;
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

function fmtDate(iso: string | undefined): string {
  if (!iso) return "—";
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

function termValue(
  terms: QuoteTerm[] | undefined,
  stepId: string,
): string | undefined {
  return terms?.find((t) => t.stepId === stepId)?.value;
}

export function localizeTermValue(value: string, lang: "en" | "es"): string {
  // REQ-495 (m17): a picked start date (ISO, or a legacy MM/DD/YYYY) prints
  // in the reader's language — "1 dic 2026" / "Dec 1, 2026".
  if (termDateIso(value)) return formatTermDate(value, lang);
  if (lang === "en") return value;
  const trimmed = (value ?? "").trim();
  // REQ-678 (c3-m60): the picked deposit — "Depósito 30% + saldo".
  const deposit = localizeDepositTerm(trimmed, lang, t);
  if (deposit) return deposit;
  const exactKey: Record<string, string> = {
    "Payment upon completion": "renderQuotePdf.termValue.paymentUponCompletion",
    "Deposit + balance": "renderQuotePdf.termValue.depositPlusBalance",
    "No warranty": "renderQuotePdf.termValue.noWarranty",
    "Right away": "renderQuotePdf.termValue.rightAway",
    "Next week": "renderQuotePdf.termValue.nextWeek",
    "Next Month": "renderQuotePdf.termValue.nextMonth",
    "Next month": "renderQuotePdf.termValue.nextMonth",
    "Job Completed": "renderQuotePdf.termValue.jobCompleted",
    // NW-24 (REQ-009): new quotes persist the sentence-case value; the
    // line above keeps quotes saved before the casing change localizing.
    "Job completed": "renderQuotePdf.termValue.jobCompleted",
    "Due Now": "renderQuotePdf.termValue.dueNow",
    // REQ-046/047: the wizard's TBD pick on start date / duration.
    "TBD": "renderQuotePdf.termValue.tbd",
    // REQ-343: the service-trade wizard's "Half a day" duration.
    "Half a day": "renderQuotePdf.termValue.halfDay",
  };
  if (exactKey[trimmed]) return t(lang, exactKey[trimmed]);
  return trimmed
    // REQ-015: warranty presets persist "1 year" / "2 years".
    .replace(/\byears\b/gi, "años").replace(/\byear\b/gi, "año")
    .replace(/\bmonths\b/gi, "meses").replace(/\bmonth\b/gi, "mes")
    .replace(/\bweeks\b/gi, "semanas").replace(/\bweek\b/gi, "semana")
    // REQ-343: service-trade durations ("2 hours", "4 hours").
    .replace(/\bhours\b/gi, "horas").replace(/\bhour\b/gi, "hora")
    .replace(/\bdays\b/gi, "días").replace(/\bday\b/gi, "día");
}

function computeMilestones(
  total: number,
  terms: QuoteTerm[] | undefined,
  lang: "en" | "es" = "en",
): { label: string; amount: number; when: string }[] {
  if (!total || total <= 0) return [];
  const L = {
    deposit: t(lang, "renderQuotePdf.milestone.deposit"),
    balance: t(lang, "renderQuotePdf.milestone.balance"),
    midpoint: t(lang, "renderQuotePdf.milestone.midpoint"),
    final: t(lang, "renderQuotePdf.milestone.final"),
    beforeStart: t(lang, "renderQuotePdf.milestone.beforeStart"),
    onCompletion: t(lang, "renderQuotePdf.milestone.onCompletion"),
    atMidpoint: t(lang, "renderQuotePdf.milestone.atMidpoint"),
    onSigning: t(lang, "renderQuotePdf.milestone.onSigning"),
  };
  const roleLabel: Record<MilestoneRole, { label: string; when: string }> = {
    deposit: { label: L.deposit, when: L.beforeStart },
    midpoint: { label: L.midpoint, when: L.atMidpoint },
    milestone: { label: L.midpoint, when: L.atMidpoint },
    completion: { label: L.balance, when: L.onCompletion },
    full: { label: L.final, when: L.onCompletion },
  };
  const term = termValue(terms, "payment_terms");
  const dueNow = /\bdue now\b/i.test(term ?? "");
  return computePaymentSplit(term, total).map((p) => ({
    ...roleLabel[p.role],
    ...(dueNow && p.role === "full" ? { when: L.onSigning } : {}),
    amount: p.amountCents,
  }));
}
