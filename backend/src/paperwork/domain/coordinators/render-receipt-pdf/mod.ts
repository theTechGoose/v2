import { Injectable } from "#danet/core";
import { PDFDocument, rgb, StandardFonts } from "#pdf-lib";
import type { Invoice, PaymentMethod } from "@paperwork/dto/invoice.ts";
import type { Customer } from "@crm/dto/customer.ts";
import type { User } from "@users/dto/user.ts";
import { t, type Lang } from "@core/i18n/mod.ts";

export interface RenderReceiptPdfInput {
  invoice: Invoice;
  customer?: Customer;
  contractor: User | undefined;
  businessName?: string;
  /** What method the contractor recorded as having received. */
  method: PaymentMethod;
  /** Free-text reference (check #, transaction ID, etc.). */
  reference?: string;
  /** When the contractor confirmed receipt (ISO string). */
  confirmedAt: string;
}

/**
 * RenderReceiptPdf — pure-JS PDF receipt fired after a contractor
 * confirms a customer's payment. Mirrors the look of the contract PDF
 * (pink ribbon, green-on-cream amount card) so customers recognize the
 * brand across artifacts.
 *
 * Single page, no signatures, no fine print — just:
 *   • Brand strip + "RECEIPT" eyebrow
 *   • Hero amount + method + reference
 *   • Invoice / customer block
 *   • Footer with contractor's contact info
 *
 * Returns the PDF as Uint8Array — caller decides what to do with it.
 */
@Injectable()
export class RenderReceiptPdf {
  async run(input: RenderReceiptPdfInput): Promise<Uint8Array> {
    const { invoice, customer, contractor, businessName, method, reference, confirmedAt } = input;
    const lang: Lang = contractor?.language ?? "en";
    const pdf = await PDFDocument.create();
    pdf.setTitle(`Receipt #${invoice.id.slice(0, 8).toUpperCase()}`);
    pdf.setAuthor(contractor?.name ?? businessName ?? t(lang, "receiptPdf.contractorFallback"));
    pdf.setSubject(`Receipt for invoice #${invoice.id.slice(0, 8).toUpperCase()}`);
    pdf.setCreationDate(new Date());

    const reg  = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const W = 612, H = 792, M = 54;
    const page = pdf.addPage([W, H]);

    // Pink ribbon
    page.drawRectangle({
      x: 0, y: H - 8, width: W, height: 8,
      color: rgb(1, 0.42, 0.42),
    });

    // Brand eyebrow
    const businessLabel = (businessName ?? contractor?.name ?? t(lang, "brand.name")).toUpperCase();
    page.drawText(businessLabel, {
      x: M, y: H - 50, size: 9, font: bold, color: rgb(0.85, 0.31, 0.31),
    });

    // RECEIPT eyebrow + invoice number
    page.drawText(t(lang, "receiptPdf.eyebrow"), {
      x: M, y: H - 90, size: 11, font: bold, color: rgb(0.32, 0.60, 0.26),
    });
    page.drawText(`#${invoice.id.slice(0, 8).toUpperCase()}`, {
      x: M, y: H - 120, size: 24, font: bold, color: rgb(0.08, 0.28, 0.32),
    });
    page.drawText(t(lang, "receiptPdf.confirmed", { date: formatDate(confirmedAt, lang) }), {
      x: W - M - 200, y: H - 90, size: 10, font: reg, color: rgb(0.42, 0.48, 0.49), maxWidth: 200,
    });

    // Divider
    page.drawRectangle({ x: M, y: H - 140, width: W - 2 * M, height: 1, color: rgb(0.89, 0.91, 0.90) });

    // Amount card
    page.drawRectangle({
      x: M, y: H - 240, width: W - 2 * M, height: 86,
      color: rgb(0.91, 0.95, 0.89), borderColor: rgb(0.65, 0.83, 0.58), borderWidth: 1,
    });
    page.drawText(t(lang, "receiptPdf.amountReceived"), {
      x: M + 18, y: H - 175, size: 9, font: bold, color: rgb(0.32, 0.60, 0.26),
    });
    page.drawText(fmtMoney(invoice.amount ?? 0), {
      x: M + 18, y: H - 218, size: 32, font: bold, color: rgb(0.08, 0.28, 0.32),
    });
    page.drawText(methodLabel(method, lang), {
      x: W - M - 18 - methodWidth(methodLabel(method, lang), bold, 12), y: H - 195, size: 12, font: bold, color: rgb(0.08, 0.28, 0.32),
    });
    if (reference) {
      const refLine = t(lang, "receiptPdf.ref", { reference });
      page.drawText(refLine, {
        x: W - M - 18 - methodWidth(refLine, reg, 10), y: H - 215, size: 10, font: reg, color: rgb(0.42, 0.48, 0.49),
      });
    }

    // Invoice / customer block
    let y = H - 280;
    page.drawText(t(lang, "receiptPdf.invoiceHeader"), { x: M, y, size: 9, font: bold, color: rgb(0.42, 0.48, 0.49) });
    page.drawText(t(lang, "receiptPdf.customerHeader"), { x: W / 2, y, size: 9, font: bold, color: rgb(0.42, 0.48, 0.49) });
    y -= 16;
    page.drawText(`#${invoice.id.slice(0, 8).toUpperCase()}`, { x: M, y, size: 12, font: bold, color: rgb(0.11, 0.17, 0.19) });
    page.drawText(customer?.name ?? "—", { x: W / 2, y, size: 12, font: bold, color: rgb(0.11, 0.17, 0.19) });
    y -= 14;
    if (invoice.installmentIndex && invoice.installmentTotal) {
      page.drawText(t(lang, "receiptPdf.installment", { index: invoice.installmentIndex, total: invoice.installmentTotal }), {
        x: M, y, size: 10, font: reg, color: rgb(0.42, 0.48, 0.49),
      });
    }
    if (customer?.email) {
      page.drawText(customer.email, { x: W / 2, y, size: 10, font: reg, color: rgb(0.42, 0.48, 0.49) });
    }

    // Footer
    const footerY = 90;
    page.drawRectangle({ x: M, y: footerY + 30, width: W - 2 * M, height: 1, color: rgb(0.89, 0.91, 0.90) });
    page.drawText(t(lang, "receiptPdf.footerPrompt"), {
      x: M, y: footerY + 10, size: 10, font: reg, color: rgb(0.42, 0.48, 0.49),
    });
    const contactLine = [contractor?.phoneNumber, contractor?.email].filter(Boolean).join(" · ");
    if (contactLine) {
      page.drawText(contactLine, {
        x: M, y: footerY - 6, size: 11, font: bold, color: rgb(0.08, 0.28, 0.32),
      });
    }
    page.drawText(t(lang, "receiptPdf.poweredBy", { brand: t(lang, "brand.name") }), {
      x: M, y: footerY - 30, size: 8, font: reg, color: rgb(0.66, 0.70, 0.70),
    });

    return await pdf.save();
  }
}

function methodLabel(m: PaymentMethod, lang: Lang): string {
  switch (m) {
    case "check": return t(lang, "receiptPdf.method.check");
    case "venmo": return t(lang, "receiptPdf.method.venmo");
    case "zelle": return t(lang, "receiptPdf.method.zelle");
    case "cashapp": return t(lang, "receiptPdf.method.cashApp");
    case "paypal": return t(lang, "receiptPdf.method.paypal");
    case "cash": return t(lang, "receiptPdf.method.cash");
    case "ach": return t(lang, "receiptPdf.method.ach");
    case "other": return t(lang, "receiptPdf.method.other");
  }
}

function fmtMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(iso: string, lang: Lang): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString(lang === "es" ? "es" : "en-US", { month: "long", day: "numeric", year: "numeric" });
}

// pdf-lib's widthOfTextAtSize is on the font instance; we have it but
// keep this helper to make the right-align math read clean above.
function methodWidth(text: string, font: { widthOfTextAtSize(t: string, s: number): number }, size: number): number {
  return font.widthOfTextAtSize(text, size);
}
