import { Injectable } from "#danet/core";
import { PDFDocument, rgb, StandardFonts } from "#pdf-lib";
import { t } from "@core/i18n/mod.ts";
import type { Contract, ContractTerm } from "@paperwork/dto/contract.ts";
import { computePaymentSplit, type MilestoneRole } from "#payment-split";
import type { Quote } from "@paperwork/dto/quote.ts";
import type { Customer } from "@crm/dto/customer.ts";
import type { User } from "@users/dto/user.ts";

export interface RenderContractPdfInput {
  contract: Contract & {
    customerSignature?: string;
    customerSignedName?: string;
  };
  quote?: Quote;
  customer?: Customer;
  contractor: User | undefined;
  /** Optional override for the contractor's display business name (e.g.
   *  "Riley Roofing Co." pulled from BusinessIdentity). */
  businessName?: string;
  /** Outgoing-comms language (roadmap p.13) — the PDF is the customer's
   *  copy, so it renders in their language. Defaults to "en". */
  commsLanguage?: string;
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
 *   • Job details table (line items)
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
    // Roadmap p.13: the PDF is the customer's copy → outgoing-comms language.
    const es = input.commsLanguage === "es";
    const lang: "en" | "es" = es ? "es" : "en";

    const pdf = await PDFDocument.create();
    pdf.setTitle(`Quote & Agreement #${contract.id.slice(0, 8).toUpperCase()}`);
    pdf.setAuthor(contractor?.name ?? businessName ?? "Contractor");
    pdf.setSubject(quote?.summary ?? "Service Agreement");
    pdf.setProducer(businessName ?? contractor?.name ?? "Contractor");
    pdf.setCreationDate(new Date(contract.createdAt));
    pdf.setModificationDate(new Date());

    const reg = await pdf.embedFont(StandardFonts.Helvetica);
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
    const biz =
      (businessName ?? contractor?.name ?? t(lang, "renderContractPdf.businessFallback"))
        .toUpperCase();
    y -= 32;
    drawCenteredText(page, biz, W, y, bold, 9, PINK_DARK, 0.18);

    // doc tag pill (left) + status (right)
    y -= 32;
    const docNum = `${t(lang, "renderContractPdf.docTag")} · #${
      contract.id.slice(0, 8).toUpperCase()
    }`;
    page.drawText(docNum, { x: M, y, size: 8.5, font: bold, color: PINK_DARK });
    const statusText = contract.status === "signed"
      ? t(lang, "renderContractPdf.status.signed", {
        date: fmtDateUpper(contract.signedAt),
      })
      : (contract.status ?? "DRAFT").toUpperCase();
    const statusW = bold.widthOfTextAtSize(statusText, 8.5);
    page.drawText(statusText, {
      x: W - M - statusW,
      y,
      size: 8.5,
      font: bold,
      color: GREEN,
    });

    // Hero title
    y -= 36;
    const heroTitle =
      (quote?.summaryByLang?.[lang] ?? quote?.summary ??
        t(lang, "renderContractPdf.heroFallback"))
        .replace(/^\s*quote\s*:\s*/i, "")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    page.drawText(heroTitle, { x: M, y, size: 24, font: bold, color: TEAL });
    y -= 22;

    // Recital
    const cust = customer?.name?.trim() ?? contract.customerSignedName?.trim();
    const recital = t(lang, "renderContractPdf.recital.main", {
      biz: biz.replace(/\.$/, ""),
      cust: cust ?? t(lang, "renderContractPdf.recital.clientFallback"),
    }) +
      (contract.effectiveDate
        ? t(lang, "renderContractPdf.recital.effective", {
          date: fmtDate(contract.effectiveDate),
        })
        : "");
    drawWrappedText(page, recital, M, y, W - 2 * M, reg, 10, MUTED, 13);
    y -= 26;

    // TO / FROM contact block (roadmap p.5/p.6). Mirrors the public /c page.
    {
      const colGap = 24;
      const colW2 = (W - 2 * M - colGap) / 2;
      const fromX = M + colW2 + colGap;
      page.drawText(t(lang, "renderContractPdf.contact.to"), {
        x: M,
        y,
        size: 8,
        font: bold,
        color: MUTED,
      });
      page.drawText(t(lang, "renderContractPdf.contact.from"), {
        x: fromX,
        y,
        size: 8,
        font: bold,
        color: MUTED,
      });
      y -= 14;
      const toLines = [cust, customer?.phoneNumber, customer?.email]
        .filter((v): v is string => !!v && v.trim().length > 0);
      const fromLines = [
        contractor?.name,
        businessName,
        contractor?.phoneNumber,
        contractor?.email,
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

    // Section: Job details
    y = drawSectionHeader(
      page,
      y,
      M,
      "01",
      t(lang, "renderContractPdf.section.jobDetails"),
      bold,
      PINK,
      TEAL,
    );
    y -= 8;
    if (quote?.lineItems?.length) {
      // Table headers
      page.drawText(t(lang, "renderContractPdf.table.description"), {
        x: M,
        y,
        size: 8,
        font: bold,
        color: MUTED,
      });
      const amountHdr = t(lang, "renderContractPdf.table.amount");
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
    }
    // Total card
    addPageIfNeeded(70);
    y -= 4;
    page.drawRectangle({
      x: M,
      y: y - 56,
      width: W - 2 * M,
      height: 56,
      color: GREEN_BG,
      borderWidth: 0,
    });
    page.drawText(t(lang, "renderContractPdf.total.label"), {
      x: M + 16,
      y: y - 22,
      size: 9,
      font: bold,
      color: GREEN,
    });
    page.drawText(
      t(lang, "renderContractPdf.total.subtext"),
      {
        x: M + 16,
        y: y - 36,
        size: 9,
        font: reg,
        color: MUTED,
      },
    );
    const total = contract.totalAmount ?? quote?.estimatedTotal ?? 0;
    const totalStr = fmtUSD(total);
    const totalW = bold.widthOfTextAtSize(totalStr, 26);
    page.drawText(totalStr, {
      x: W - M - 16 - totalW,
      y: y - 38,
      size: 26,
      font: bold,
      color: TEAL,
    });
    y -= 78;

    // Section: Payment schedule (derived from terms.payment_terms)
    const milestones = computeMilestones(total, contract.terms, lang);
    if (milestones.length > 0) {
      addPageIfNeeded(110);
      y = drawSectionHeader(
        page,
        y,
        M,
        "02",
        t(lang, "renderContractPdf.section.paymentSchedule"),
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

    // Section: Schedule
    if (contract.startDate || contract.estimatedCompletionDate) {
      addPageIfNeeded(60);
      y = drawSectionHeader(
        page,
        y,
        M,
        "03",
        t(lang, "renderContractPdf.section.schedule"),
        bold,
        PINK,
        TEAL,
      );
      y -= 12;
      if (contract.startDate) {
        page.drawText(t(lang, "renderContractPdf.schedule.start"), {
          x: M,
          y,
          size: 9,
          font: bold,
          color: MUTED,
        });
        page.drawText(fmtDate(contract.startDate), {
          x: W - M - bold.widthOfTextAtSize(fmtDate(contract.startDate), 11),
          y,
          size: 11,
          font: bold,
          color: INK,
        });
        y -= 16;
      }
      if (contract.estimatedCompletionDate) {
        page.drawText(t(lang, "renderContractPdf.schedule.estimatedCompletion"), {
          x: M,
          y,
          size: 9,
          font: bold,
          color: MUTED,
        });
        page.drawText(fmtDate(contract.estimatedCompletionDate), {
          x: W - M -
            bold.widthOfTextAtSize(
              fmtDate(contract.estimatedCompletionDate),
              11,
            ),
          y,
          size: 11,
          font: bold,
          color: INK,
        });
        y -= 16;
      }
      y -= 8;
    }

    // Section: Terms (wizard-captured, two columns)
    if (contract.terms && contract.terms.length > 0) {
      addPageIfNeeded(120);
      y = drawSectionHeader(
        page,
        y,
        M,
        "04",
        t(lang, "renderContractPdf.section.terms"),
        bold,
        PINK,
        TEAL,
      );
      y -= 12;
      const visible = contract.terms.filter((term) =>
        term.stepId !== "customer"
      );
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
            start_date: "renderContractPdf.termLabel.startDate",
            wraps: "renderContractPdf.termLabel.duration",
            payment_terms: "renderContractPdf.termLabel.paymentTerms",
            warranty: "renderContractPdf.termLabel.warranty",
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
          const displayValue = term.stepId === "wraps"
            ? t(lang, "renderContractPdf.term.estimatedPrefix", {
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

    // Section: Fine print
    addPageIfNeeded(180);
    y = drawSectionHeader(
      page,
      y,
      M,
      "05",
      t(lang, "renderContractPdf.section.finePrint"),
      bold,
      PINK,
      TEAL,
    );
    y -= 12;
    const clauseKeys = [
      "governingLaw",
      "jobDetails",
      "paymentTerms",
      "changeOrders",
      "customerResponsibilities",
      "delays",
      "warranty",
      "limitationOfLiability",
      "rightToStopWork",
      "termination",
      "disputeResolution",
      "permits",
      "indemnification",
      "entireAgreement",
    ];
    const clauses = clauseKeys.map((k) => [
      t(lang, `renderContractPdf.clause.${k}.title`),
      t(lang, `renderContractPdf.clause.${k}.body`),
    ]);
    for (let i = 0; i < clauses.length; i++) {
      addPageIfNeeded(34);
      const [head, tail] = clauses[i];
      page.drawText(`${i + 1}.`, {
        x: M,
        y,
        size: 10,
        font: bold,
        color: TEAL,
      });
      page.drawText(head, { x: M + 14, y, size: 10, font: bold, color: INK });
      const headW = bold.widthOfTextAtSize(head, 10);
      const wrapped = wrap(tail, reg, 10, W - 2 * M - 14 - headW - 4);
      // First wrapped line sits next to the bold head
      if (wrapped[0]) {
        page.drawText(" " + wrapped[0], {
          x: M + 14 + headW,
          y,
          size: 10,
          font: reg,
          color: INK,
        });
      }
      y -= 14;
      // Continuation lines indent under the head
      for (let j = 1; j < wrapped.length; j++) {
        addPageIfNeeded(14);
        page.drawText(wrapped[j], {
          x: M + 14,
          y,
          size: 10,
          font: reg,
          color: INK,
        });
        y -= 14;
      }
      y -= 4;
    }

    // Section: Signatures
    addPageIfNeeded(180);
    y -= 8;
    y = drawSectionHeader(
      page,
      y,
      M,
      "06",
      t(lang, "renderContractPdf.section.signatures"),
      bold,
      PINK,
      TEAL,
    );
    y -= 16;
    const halfW = (W - 2 * M - 16) / 2;
    const sigBoxH = 90;

    // Contractor box
    page.drawRectangle({
      x: M,
      y: y - sigBoxH,
      width: halfW,
      height: sigBoxH,
      borderColor: LINE,
      borderWidth: 0.6,
    });
    // Roadmap p.8: CONTRACTOR / {business} / cursive signature / By: {name} / Date.
    page.drawText(t(lang, "renderContractPdf.sig.contractor"), {
      x: M + 12,
      y: y - 14,
      size: 8,
      font: bold,
      color: MUTED,
    });
    page.drawText(biz, {
      x: M + 12,
      y: y - 28,
      size: 11,
      font: bold,
      color: INK,
    });
    page.drawText(contractor?.name ?? biz, {
      x: M + 12,
      y: y - 52,
      size: 16,
      font: ital,
      color: TEAL,
    });
    if (contractor?.name) {
      page.drawText(t(lang, "renderContractPdf.sig.by", { name: contractor.name }), {
        x: M + 12,
        y: y - 70,
        size: 8,
        font: reg,
        color: MUTED,
      });
    }
    page.drawText(
      t(lang, "renderContractPdf.sig.date", {
        date: fmtDate(contract.effectiveDate ?? contract.createdAt),
      }),
      {
        x: M + 12,
        y: y - 82,
        size: 8,
        font: reg,
        color: MUTED,
      },
    );

    // Customer box
    const cx = M + halfW + 16;
    page.drawRectangle({
      x: cx,
      y: y - sigBoxH,
      width: halfW,
      height: sigBoxH,
      borderColor: LINE,
      borderWidth: 0.6,
    });
    page.drawText(t(lang, "renderContractPdf.sig.clientSigned"), {
      x: cx + 12,
      y: y - 16,
      size: 8,
      font: bold,
      color: MUTED,
    });
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
            width: png.width * scale,
            height: png.height * scale,
          });
        }
      } catch (e) {
        console.error("[render-contract-pdf] failed to embed signature:", e);
      }
    }
    if (contract.customerSignedName) {
      page.drawText(contract.customerSignedName, {
        x: cx + 12,
        y: y - 70,
        size: 9,
        font: bold,
        color: INK,
      });
    }
    if (contract.signedAt) {
      const dateStr = fmtDate(contract.signedAt);
      page.drawText(dateStr, {
        x: cx + halfW - 12 - reg.widthOfTextAtSize(dateStr, 9),
        y: y - 70,
        size: 9,
        font: reg,
        color: MUTED,
      });
    }
    y -= sigBoxH + 14;

    // Footer
    addPageIfNeeded(40);
    page.drawLine({
      start: { x: M, y },
      end: { x: W - M, y },
      thickness: 0.4,
      color: LINE,
    });
    y -= 14;
    drawCenteredText(
      page,
      t(lang, "renderContractPdf.footer", {
        id: contract.id.slice(0, 8).toUpperCase(),
        date: fmtDate(new Date().toISOString()),
      }),
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

/* ---------------- helpers ---------------- */

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
  // pink disc with number
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
  // pdf-lib Helvetica doesn't support per-character spacing natively; we
  // approximate by widening the character ratio. For our 0.18em eyebrow,
  // letterSpacing-as-padding is close enough.
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

function termValue(
  terms: ContractTerm[] | undefined,
  stepId: string,
): string | undefined {
  return terms?.find((t) => t.stepId === stepId)?.value;
}

/** Localize a wizard-captured term value for the customer copy. Maps the
 *  known preset option labels to Spanish and converts numeric durations
 *  ("12 months" → "12 meses"); custom free-text and universal ratios
 *  ("50/50") pass through unchanged. */
function localizeTermValue(value: string, lang: "en" | "es"): string {
  if (lang === "en") return value;
  const trimmed = (value ?? "").trim();
  // Map known wizard preset labels to localized i18n keys.
  const exactKey: Record<string, string> = {
    "Payment upon completion": "renderContractPdf.termValue.paymentUponCompletion",
    "Deposit + balance": "renderContractPdf.termValue.depositPlusBalance",
    "No warranty": "renderContractPdf.termValue.noWarranty",
    "Right away": "renderContractPdf.termValue.rightAway",
    "Next week": "renderContractPdf.termValue.nextWeek",
    "Next Month": "renderContractPdf.termValue.nextMonth",
    "Next month": "renderContractPdf.termValue.nextMonth",
    "Job Completed": "renderContractPdf.termValue.jobCompleted",
    "Due Now": "renderContractPdf.termValue.dueNow",
  };
  if (exactKey[trimmed]) return t(lang, exactKey[trimmed]);
  return trimmed
    .replace(/\bmonths\b/gi, "meses").replace(/\bmonth\b/gi, "mes")
    .replace(/\bweeks\b/gi, "semanas").replace(/\bweek\b/gi, "semana")
    .replace(/\bdays\b/gi, "días").replace(/\bday\b/gi, "día");
}

function computeMilestones(
  total: number,
  terms: ContractTerm[] | undefined,
  lang: "en" | "es" = "en",
): { label: string; amount: number; when: string }[] {
  if (!total || total <= 0) return [];
  // Localized milestone label/timing strings (PDF is the customer's copy →
  // outgoing-comms language, roadmap p.13).
  const L = {
    deposit: t(lang, "renderContractPdf.milestone.deposit"),
    balance: t(lang, "renderContractPdf.milestone.balance"),
    midpoint: t(lang, "renderContractPdf.milestone.midpoint"),
    final: t(lang, "renderContractPdf.milestone.final"),
    beforeStart: t(lang, "renderContractPdf.milestone.beforeStart"),
    onCompletion: t(lang, "renderContractPdf.milestone.onCompletion"),
    atMidpoint: t(lang, "renderContractPdf.milestone.atMidpoint"),
    onSigning: t(lang, "renderContractPdf.milestone.onSigning"),
  };
  const roleLabel: Record<MilestoneRole, { label: string; when: string }> = {
    deposit: { label: L.deposit, when: L.beforeStart },
    midpoint: { label: L.midpoint, when: L.atMidpoint },
    milestone: { label: L.midpoint, when: L.atMidpoint },
    completion: { label: L.balance, when: L.onCompletion },
    full: { label: L.final, when: L.onCompletion },
  };
  const term = termValue(terms, "payment_terms");
  // "Due Now" terms collapse to a single full payment — but it's owed at
  // signing, not "on completion".
  const dueNow = /\bdue now\b/i.test(term ?? "");
  return computePaymentSplit(term, total).map((
    p,
  ) => ({
    ...roleLabel[p.role],
    ...(dueNow && p.role === "full" ? { when: L.onSigning } : {}),
    amount: p.amountCents,
  }));
}
