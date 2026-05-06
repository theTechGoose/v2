import { Injectable } from "#danet/core";
import { PDFDocument, rgb, StandardFonts } from "#pdf-lib";
import type { Contract, ContractTerm } from "@paperwork/dto/contract.ts";
import type { Quote } from "@paperwork/dto/quote.ts";
import type { Customer } from "@crm/dto/customer.ts";
import type { User } from "@users/dto/user.ts";

export interface RenderContractPdfInput {
  contract:   Contract & { customerSignature?: string; customerSignedName?: string };
  quote?:     Quote;
  customer?:  Customer;
  contractor: User | undefined;
  /** Optional override for the contractor's display business name (e.g.
   *  "Riley Roofing Co." pulled from BusinessIdentity). */
  businessName?: string;
}

/**
 * RenderContractPdf — pure-JS server-side PDF rendering of a signed
 * contract, suitable for Deno Deploy (no native deps, no headless
 * Chromium). Uses pdf-lib via the npm: import map.
 *
 * Layout (matches the public /c/[id] page in spirit, simplified for PDF):
 *   • Letter page, 0.75" margins
 *   • Pink ribbon at top, business name eyebrow
 *   • Hero title (quote summary), contract number + dates
 *   • Recital block (Between Contractor / Client)
 *   • Scope of work table (line items)
 *   • Contract value box
 *   • Wizard-captured terms (two-column grid)
 *   • Plain-English fine print (8 numbered clauses)
 *   • Signature block: contractor on the left (cursive name), customer
 *     signature on the right (the captured PNG, embedded inline)
 *
 * Returns the PDF as Uint8Array bytes — caller is responsible for
 * choosing what to do with them (attach to email, store, etc.).
 */
@Injectable()
export class RenderContractPdf {
  async run(input: RenderContractPdfInput): Promise<Uint8Array> {
    const { contract, quote, customer, contractor, businessName } = input;

    const pdf = await PDFDocument.create();
    pdf.setTitle(`Contract #${contract.id.slice(0, 8).toUpperCase()}`);
    pdf.setAuthor(contractor?.name ?? businessName ?? "Contractor");
    pdf.setSubject(quote?.summary ?? "Service Agreement");
    pdf.setProducer(businessName ?? contractor?.name ?? "Contractor");
    pdf.setCreationDate(new Date(contract.createdAt));
    pdf.setModificationDate(new Date());

    const reg  = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const ital = await pdf.embedFont(StandardFonts.HelveticaOblique);

    // Page 1 — letter, .75" margins
    const W = 612, H = 792;
    const M = 54; // ~0.75 inch
    let page = pdf.addPage([W, H]);
    let y = H;

    // colors
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

    // pink ribbon
    page.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: PINK });
    y = H - 8;

    // business eyebrow
    const biz = (businessName ?? contractor?.name ?? "Your Contractor").toUpperCase();
    y -= 32;
    drawCenteredText(page, biz, W, y, bold, 9, PINK_DARK, 0.18);

    // doc tag pill (left) + status (right)
    y -= 32;
    const docNum = `CONTRACT · #${contract.id.slice(0, 8).toUpperCase()}`;
    page.drawText(docNum, { x: M, y, size: 8.5, font: bold, color: PINK_DARK });
    const statusText = contract.status === "signed"
      ? `SIGNED ${fmtDateUpper(contract.signedAt)}`
      : (contract.status ?? "DRAFT").toUpperCase();
    const statusW = bold.widthOfTextAtSize(statusText, 8.5);
    page.drawText(statusText, { x: W - M - statusW, y, size: 8.5, font: bold, color: GREEN });

    // Hero title
    y -= 36;
    const heroTitle = (quote?.summary ?? "Service Agreement")
      .replace(/^\s*quote\s*:\s*/i, "")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    page.drawText(heroTitle, { x: M, y, size: 24, font: bold, color: TEAL });
    y -= 22;

    // Recital
    const cust = customer?.name?.trim() ?? contract.customerSignedName?.trim();
    const recital = `Between ${biz.replace(/\.$/, "")} ("Contractor") and ${cust ?? "Client"} ("Client")` +
      (contract.effectiveDate ? ` · effective ${fmtDate(contract.effectiveDate)}` : "");
    drawWrappedText(page, recital, M, y, W - 2 * M, reg, 10, MUTED, 13);
    y -= 30;

    // Section: Scope of work
    y = drawSectionHeader(page, y, M, "01", "Scope of work", bold, PINK, TEAL);
    y -= 8;
    if (quote?.lineItems?.length) {
      // Table headers
      page.drawText("DESCRIPTION", { x: M, y, size: 8, font: bold, color: MUTED });
      page.drawText("AMOUNT", { x: W - M - bold.widthOfTextAtSize("AMOUNT", 8), y, size: 8, font: bold, color: MUTED });
      y -= 6;
      page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: LINE });
      y -= 14;
      for (const li of quote.lineItems) {
        addPageIfNeeded(28);
        const lineTotal = (li.price ?? 0) * (li.quantity ?? 1);
        page.drawText(li.description, { x: M, y, size: 11, font: reg, color: INK });
        const amt = fmtUSD(lineTotal);
        page.drawText(amt, { x: W - M - bold.widthOfTextAtSize(amt, 11), y, size: 11, font: bold, color: INK });
        y -= 10;
        page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.4, color: LINE });
        y -= 12;
      }
    }
    // Total card
    addPageIfNeeded(70);
    y -= 4;
    page.drawRectangle({ x: M, y: y - 56, width: W - 2 * M, height: 56, color: GREEN_BG, borderWidth: 0 });
    page.drawText("CONTRACT VALUE", { x: M + 16, y: y - 22, size: 9, font: bold, color: GREEN });
    page.drawText("all in, no surprises", { x: M + 16, y: y - 36, size: 9, font: reg, color: MUTED });
    const total = contract.totalAmount ?? quote?.estimatedTotal ?? 0;
    const totalStr = fmtUSD(total);
    const totalW = bold.widthOfTextAtSize(totalStr, 26);
    page.drawText(totalStr, { x: W - M - 16 - totalW, y: y - 38, size: 26, font: bold, color: TEAL });
    y -= 78;

    // Section: Payment schedule (derived from terms.payment_terms)
    const milestones = computeMilestones(total, contract.terms);
    if (milestones.length > 0) {
      addPageIfNeeded(110);
      y = drawSectionHeader(page, y, M, "02", "Payment schedule", bold, PINK, TEAL);
      y -= 12;
      const colW = (W - 2 * M - (milestones.length - 1) * 8) / milestones.length;
      for (let i = 0; i < milestones.length; i++) {
        const m = milestones[i];
        const cx = M + i * (colW + 8);
        page.drawRectangle({ x: cx, y: y - 56, width: colW, height: 56, borderColor: LINE, borderWidth: 0.6 });
        page.drawText(m.label.toUpperCase(), { x: cx + 12, y: y - 18, size: 8, font: bold, color: PINK_DARK });
        page.drawText(fmtUSD(m.amount), { x: cx + 12, y: y - 34, size: 14, font: bold, color: TEAL });
        page.drawText(m.when, { x: cx + 12, y: y - 48, size: 8, font: reg, color: MUTED });
      }
      y -= 72;
    }

    // Section: Schedule
    if (contract.startDate || contract.estimatedCompletionDate) {
      addPageIfNeeded(60);
      y = drawSectionHeader(page, y, M, "03", "Schedule", bold, PINK, TEAL);
      y -= 12;
      if (contract.startDate) {
        page.drawText("Start", { x: M, y, size: 9, font: bold, color: MUTED });
        page.drawText(fmtDate(contract.startDate), {
          x: W - M - bold.widthOfTextAtSize(fmtDate(contract.startDate), 11), y, size: 11, font: bold, color: INK,
        });
        y -= 16;
      }
      if (contract.estimatedCompletionDate) {
        page.drawText("Estimated completion", { x: M, y, size: 9, font: bold, color: MUTED });
        page.drawText(fmtDate(contract.estimatedCompletionDate), {
          x: W - M - bold.widthOfTextAtSize(fmtDate(contract.estimatedCompletionDate), 11), y, size: 11, font: bold, color: INK,
        });
        y -= 16;
      }
      y -= 8;
    }

    // Section: Terms (wizard-captured, two columns)
    if (contract.terms && contract.terms.length > 0) {
      addPageIfNeeded(120);
      y = drawSectionHeader(page, y, M, "04", "Terms", bold, PINK, TEAL);
      y -= 12;
      const visible = contract.terms.filter((t) => t.stepId !== "customer");
      const colCount = 2;
      const gap = 10;
      const cellW = (W - 2 * M - (colCount - 1) * gap) / colCount;
      const rowH = 38;
      for (let i = 0; i < visible.length; i += colCount) {
        addPageIfNeeded(rowH + 6);
        for (let c = 0; c < colCount; c++) {
          const t = visible[i + c];
          if (!t) break;
          const cx = M + c * (cellW + gap);
          page.drawRectangle({ x: cx, y: y - rowH, width: cellW, height: rowH, borderColor: LINE, borderWidth: 0.5 });
          page.drawText(t.label.toUpperCase(), { x: cx + 10, y: y - 14, size: 7.5, font: bold, color: MUTED });
          page.drawText(t.value, { x: cx + 10, y: y - 28, size: 10.5, font: bold, color: INK });
        }
        y -= rowH + 6;
      }
    }

    // Section: Fine print
    addPageIfNeeded(180);
    y = drawSectionHeader(page, y, M, "05", "Fine print, in plain English", bold, PINK, TEAL);
    y -= 12;
    const clauses = [
      ["Governing Law.", "This agreement is governed by the laws of the state where the work is performed."],
      ["Scope of Work.", "Contractor will perform only the work described in this agreement. Any additional work must be approved by both parties and may result in additional charges."],
      ["Payment Terms.", "Payment is due as outlined in this agreement. Late payments may be subject to additional fees as allowed by law."],
      ["Change Orders.", "Any changes to the work must be agreed to in writing and may affect the total price and project timeline."],
      ["Customer Responsibilities.", "Customer agrees to provide access to the job site and ensure the work area is ready for the Contractor to perform the agreed services."],
      ["Delays and Unforeseen Conditions.", "Contractor is not responsible for delays caused by weather, material availability, site conditions, or other circumstances outside of their control."],
      ["Warranty.", "Contractor warrants their workmanship for the period stated in this agreement. This warranty applies to labor only and does not cover materials, normal wear and tear, misuse, or damage caused by others."],
      ["Limitation of Liability.", "Contractor's liability under this agreement is limited to the total amount paid by the Customer for the work performed."],
      ["Right to Stop Work.", "Contractor reserves the right to stop work if payments are not made as agreed."],
      ["Termination.", "Either party may cancel this agreement by providing 7 days' written notice."],
      ["Dispute Resolution.", "The parties agree to attempt to resolve any disputes in good faith. Any legal action will take place in small claims or local court in the state where the work is performed."],
      ["Permits and Compliance.", "Contractor is not responsible for obtaining permits unless specifically stated. Customer is responsible for ensuring all necessary approvals are in place unless otherwise agreed."],
      ["Indemnification.", "Customer agrees to hold Contractor harmless for damages or issues arising from conditions beyond the Contractor's control."],
      ["Entire Agreement.", "This agreement represents the full understanding between both parties and replaces any prior discussions or agreements."],
    ];
    for (let i = 0; i < clauses.length; i++) {
      addPageIfNeeded(34);
      const [head, tail] = clauses[i];
      page.drawText(`${i + 1}.`, { x: M, y, size: 10, font: bold, color: TEAL });
      page.drawText(head, { x: M + 14, y, size: 10, font: bold, color: INK });
      const headW = bold.widthOfTextAtSize(head, 10);
      const wrapped = wrap(tail, reg, 10, W - 2 * M - 14 - headW - 4);
      // First wrapped line sits next to the bold head
      if (wrapped[0]) {
        page.drawText(" " + wrapped[0], { x: M + 14 + headW, y, size: 10, font: reg, color: INK });
      }
      y -= 14;
      // Continuation lines indent under the head
      for (let j = 1; j < wrapped.length; j++) {
        addPageIfNeeded(14);
        page.drawText(wrapped[j], { x: M + 14, y, size: 10, font: reg, color: INK });
        y -= 14;
      }
      y -= 4;
    }

    // Section: Signatures
    addPageIfNeeded(180);
    y -= 8;
    y = drawSectionHeader(page, y, M, "06", "Signatures", bold, PINK, TEAL);
    y -= 16;
    const halfW = (W - 2 * M - 16) / 2;
    const sigBoxH = 90;

    // Contractor box
    page.drawRectangle({ x: M, y: y - sigBoxH, width: halfW, height: sigBoxH, borderColor: LINE, borderWidth: 0.6 });
    page.drawText("CONTRACTOR SIGNED", { x: M + 12, y: y - 16, size: 8, font: bold, color: MUTED });
    page.drawText(contractor?.name ?? biz, { x: M + 12, y: y - 44, size: 18, font: ital, color: TEAL });
    page.drawText(fmtDate(contract.effectiveDate ?? contract.createdAt), {
      x: M + 12, y: y - 70, size: 9, font: reg, color: MUTED,
    });

    // Customer box
    const cx = M + halfW + 16;
    page.drawRectangle({ x: cx, y: y - sigBoxH, width: halfW, height: sigBoxH, borderColor: LINE, borderWidth: 0.6 });
    page.drawText("CLIENT SIGNED", { x: cx + 12, y: y - 16, size: 8, font: bold, color: MUTED });
    // Embed the customer's drawn signature PNG if present
    if (contract.customerSignature) {
      try {
        const sigBytes = dataUrlToBytes(contract.customerSignature);
        if (sigBytes) {
          const png = await pdf.embedPng(sigBytes);
          // Fit into the sig box: cap at 160 wide, scale-aware
          const maxW = halfW - 24;
          const maxH = 38;
          const scale = Math.min(maxW / png.width, maxH / png.height, 1);
          page.drawImage(png, {
            x: cx + 12,
            y: y - 24 - png.height * scale,
            width:  png.width * scale,
            height: png.height * scale,
          });
        }
      } catch (e) {
        console.error("[render-contract-pdf] failed to embed signature:", e);
      }
    }
    if (contract.customerSignedName) {
      page.drawText(contract.customerSignedName, { x: cx + 12, y: y - 70, size: 9, font: bold, color: INK });
    }
    if (contract.signedAt) {
      const dateStr = fmtDate(contract.signedAt);
      page.drawText(dateStr, {
        x: cx + halfW - 12 - reg.widthOfTextAtSize(dateStr, 9),
        y: y - 70, size: 9, font: reg, color: MUTED,
      });
    }
    y -= sigBoxH + 14;

    // Footer
    addPageIfNeeded(40);
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.4, color: LINE });
    y -= 14;
    drawCenteredText(
      page,
      `Contract #${contract.id.slice(0, 8).toUpperCase()} · Generated ${fmtDate(new Date().toISOString())}`,
      W, y, reg, 8, MUTED, 0,
    );

    return await pdf.save();
  }
}

/* ---------------- helpers ---------------- */

// deno-lint-ignore no-explicit-any
type PDFPage = any;
// deno-lint-ignore no-explicit-any
type PDFFont = any;
// deno-lint-ignore no-explicit-any
type RGB = any;

function drawSectionHeader(page: PDFPage, y: number, m: number, n: string, title: string, bold: PDFFont, pink: RGB, teal: RGB): number {
  // pink disc with number
  page.drawCircle({ x: m + 11, y: y - 11, size: 11, color: pink });
  page.drawText(n, { x: m + 7, y: y - 14, size: 9, font: bold, color: rgb(1, 1, 1) });
  page.drawText(title, { x: m + 30, y: y - 14, size: 14, font: bold, color: teal });
  return y - 26;
}

function drawWrappedText(page: PDFPage, text: string, x: number, y: number, w: number, font: PDFFont, size: number, color: RGB, line: number): number {
  const lines = wrap(text, font, size, w);
  let yy = y;
  for (const ln of lines) {
    page.drawText(ln, { x, y: yy, size, font, color });
    yy -= line;
  }
  return yy;
}

function drawCenteredText(page: PDFPage, text: string, w: number, y: number, font: PDFFont, size: number, color: RGB, letterSpacing: number): void {
  const tw = font.widthOfTextAtSize(text, size) + letterSpacing * (text.length - 1) * size;
  // pdf-lib Helvetica doesn't support per-character spacing natively; we
  // approximate by widening the character ratio. For our 0.18em eyebrow,
  // letterSpacing-as-padding is close enough.
  page.drawText(text, { x: (w - tw) / 2, y, size, font, color });
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
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
  return `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string | undefined): string {
  if (!iso) return "—";
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = new Date(isDateOnly ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(+d)) return iso;
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function fmtDateUpper(iso: string | undefined): string {
  return fmtDate(iso).toUpperCase();
}

function dataUrlToBytes(dataUrl: string): Uint8Array | undefined {
  const m = dataUrl.match(/^data:image\/png;base64,(.+)$/);
  if (!m) return undefined;
  try {
    const bin = atob(m[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return undefined;
  }
}

function termValue(terms: ContractTerm[] | undefined, stepId: string): string | undefined {
  return terms?.find((t) => t.stepId === stepId)?.value;
}

function computeMilestones(total: number, terms: ContractTerm[] | undefined): { label: string; amount: number; when: string }[] {
  if (!total || total <= 0) return [];
  const v = termValue(terms, "payment_terms")?.toLowerCase() ?? "";
  if (v.includes("50") && v.includes("/")) {
    return [
      { label: "Deposit", amount: Math.round(total / 2), when: "Before work starts" },
      { label: "Balance", amount: total - Math.round(total / 2), when: "On completion" },
    ];
  }
  if (v.includes("30") && v.includes("40")) {
    const a = Math.round(total * 0.30);
    const b = Math.round(total * 0.30);
    return [
      { label: "Deposit", amount: a, when: "Before work starts" },
      { label: "Midpoint", amount: b, when: "At rough-in / midpoint" },
      { label: "Final", amount: total - a - b, when: "On completion" },
    ];
  }
  if (v.includes("completion") || v.includes("net 15")) {
    return [{ label: "Final", amount: total, when: "On completion" }];
  }
  if (v.includes("deposit") && v.includes("balance")) {
    const dep = Math.round(total * 0.20);
    return [
      { label: "Deposit", amount: dep, when: "Before work starts" },
      { label: "Balance", amount: total - dep, when: "On completion" },
    ];
  }
  return [];
}
