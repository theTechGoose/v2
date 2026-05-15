import { Injectable } from "#danet/core";
import { PDFDocument, rgb, StandardFonts } from "#pdf-lib";
import type { Invoice, PaymentMethod } from "@paperwork/dto/invoice.ts";
import type { Customer } from "@crm/dto/customer.ts";
import type { User } from "@users/dto/user.ts";

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
    const pdf = await PDFDocument.create();
    pdf.setTitle(`Receipt #${invoice.id.slice(0, 8).toUpperCase()}`);
    pdf.setAuthor(contractor?.name ?? businessName ?? "Contractor");
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
    const businessLabel = (businessName ?? contractor?.name ?? "Paperwork Monsters").toUpperCase();
    page.drawText(businessLabel, {
      x: M, y: H - 50, size: 9, font: bold, color: rgb(0.85, 0.31, 0.31),
    });

    // RECEIPT eyebrow + invoice number
    page.drawText("RECEIPT", {
      x: M, y: H - 90, size: 11, font: bold, color: rgb(0.32, 0.60, 0.26),
    });
    page.drawText(`#${invoice.id.slice(0, 8).toUpperCase()}`, {
      x: M, y: H - 120, size: 24, font: bold, color: rgb(0.08, 0.28, 0.32),
    });
    page.drawText(`Confirmed ${formatDate(confirmedAt)}`, {
      x: W - M - 200, y: H - 90, size: 10, font: reg, color: rgb(0.42, 0.48, 0.49), maxWidth: 200,
    });

    // Divider
    page.drawRectangle({ x: M, y: H - 140, width: W - 2 * M, height: 1, color: rgb(0.89, 0.91, 0.90) });

    // Amount card
    page.drawRectangle({
      x: M, y: H - 240, width: W - 2 * M, height: 86,
      color: rgb(0.91, 0.95, 0.89), borderColor: rgb(0.65, 0.83, 0.58), borderWidth: 1,
    });
    page.drawText("AMOUNT RECEIVED", {
      x: M + 18, y: H - 175, size: 9, font: bold, color: rgb(0.32, 0.60, 0.26),
    });
    page.drawText(fmtMoney(invoice.amount ?? 0), {
      x: M + 18, y: H - 218, size: 32, font: bold, color: rgb(0.08, 0.28, 0.32),
    });
    page.drawText(methodLabel(method), {
      x: W - M - 18 - methodWidth(methodLabel(method), bold, 12), y: H - 195, size: 12, font: bold, color: rgb(0.08, 0.28, 0.32),
    });
    if (reference) {
      const refLine = `Ref: ${reference}`;
      page.drawText(refLine, {
        x: W - M - 18 - methodWidth(refLine, reg, 10), y: H - 215, size: 10, font: reg, color: rgb(0.42, 0.48, 0.49),
      });
    }

    // Invoice / customer block
    let y = H - 280;
    page.drawText("INVOICE", { x: M, y, size: 9, font: bold, color: rgb(0.42, 0.48, 0.49) });
    page.drawText("CUSTOMER", { x: W / 2, y, size: 9, font: bold, color: rgb(0.42, 0.48, 0.49) });
    y -= 16;
    page.drawText(`#${invoice.id.slice(0, 8).toUpperCase()}`, { x: M, y, size: 12, font: bold, color: rgb(0.11, 0.17, 0.19) });
    page.drawText(customer?.name ?? "—", { x: W / 2, y, size: 12, font: bold, color: rgb(0.11, 0.17, 0.19) });
    y -= 14;
    if (invoice.installmentIndex && invoice.installmentTotal) {
      page.drawText(`Installment ${invoice.installmentIndex} of ${invoice.installmentTotal}`, {
        x: M, y, size: 10, font: reg, color: rgb(0.42, 0.48, 0.49),
      });
    }
    if (customer?.email) {
      page.drawText(customer.email, { x: W / 2, y, size: 10, font: reg, color: rgb(0.42, 0.48, 0.49) });
    }

    // Footer
    const footerY = 90;
    page.drawRectangle({ x: M, y: footerY + 30, width: W - 2 * M, height: 1, color: rgb(0.89, 0.91, 0.90) });
    page.drawText(`Questions about this receipt?`, {
      x: M, y: footerY + 10, size: 10, font: reg, color: rgb(0.42, 0.48, 0.49),
    });
    const contactLine = [contractor?.phoneNumber, contractor?.email].filter(Boolean).join(" · ");
    if (contactLine) {
      page.drawText(contactLine, {
        x: M, y: footerY - 6, size: 11, font: bold, color: rgb(0.08, 0.28, 0.32),
      });
    }
    page.drawText("Powered by Paperwork Monsters", {
      x: M, y: footerY - 30, size: 8, font: reg, color: rgb(0.66, 0.70, 0.70),
    });

    return await pdf.save();
  }
}

function methodLabel(m: PaymentMethod): string {
  switch (m) {
    case "check": return "CHECK";
    case "venmo": return "VENMO";
    case "zelle": return "ZELLE";
    case "cashapp": return "CASH APP";
    case "cash": return "CASH";
    case "ach": return "ACH";
    case "other": return "OTHER";
  }
}

function fmtMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

// pdf-lib's widthOfTextAtSize is on the font instance; we have it but
// keep this helper to make the right-align math read clean above.
function methodWidth(text: string, font: { widthOfTextAtSize(t: string, s: number): number }, size: number): number {
  return font.widthOfTextAtSize(text, size);
}
