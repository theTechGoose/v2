/**
 * REQ-629 — "PDF invoice so they can print it out as a batch for customers
 * that want a physical invoice." One PDF for many invoices, each starting on
 * its own page, laid out for paper:
 *
 *   • US Letter, black/gray only (prints clean on any office printer)
 *   • the business's logo (REQ-628) or its name as a wordmark, top left, with
 *     its return address under it
 *   • the customer's mailing address where a standard #10 window envelope
 *     shows it (1" from the left, 2⅛" from the top) once tri-folded
 *   • the lines, the totals, the balance due
 *   • a "How to pay" box: the methods the business switched on in Settings
 *     with their handles, the pay link as text, and a QR code to it
 *   • "INV-001 · Page 1 of 2" on every page; never the house brand
 *
 * The logo is embedded once for the whole batch. Owner-scoped: an id that is
 * not the owner's throws (the controller answers 404).
 */
import { Injectable } from "#danet/core";
import {
  PDFDocument,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  rgb,
  StandardFonts,
} from "#pdf-lib";
import { qrcode } from "#qrcode";
import { type Lang, t } from "@core/i18n/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { BusinessAddressStore } from "@profile/domain/data/business-address-store/mod.ts";
import { LoadBusinessLogo } from "@paperwork/domain/coordinators/load-business-logo/mod.ts";
import { winAnsiSafeDeep } from "@paperwork/domain/business/pdf-text/mod.ts";
import {
  drawBrandMark,
  embedLogo,
} from "@paperwork/domain/business/pdf-logo/mod.ts";
import { payOptionLines } from "@paperwork/domain/business/pay-options/mod.ts";
import {
  customerOnDocument,
  docRef,
  fmtTaxRate,
} from "@paperwork/domain/business/doc-render/mod.ts";
import { appUrl } from "@users/domain/business/app-url/mod.ts";
import { fmtVisitDate, groupVisits } from "#quote-flow/visit-groups.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";

/** US Letter, in points. */
export const PAGE = { W: 612, H: 792 } as const;
/** Where a #10 window envelope shows the recipient (tri-folded letter). */
export const WINDOW = { x: 72, top: 792 - 153, width: 288, height: 81 };

const INK = rgb(0, 0, 0);
const SOFT = rgb(0.33, 0.33, 0.33);
const RULE = rgb(0.6, 0.6, 0.6);
const M = 54;

function fmtUSD(cents: number | undefined): string {
  const c = typeof cents === "number" && Number.isFinite(cents) ? cents : 0;
  const s = (Math.abs(c) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${c < 0 ? "-" : ""}$${s}`;
}

function fmtDate(iso: string | undefined, lang: Lang): string {
  if (!iso) return "";
  const d = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso,
  );
  if (Number.isNaN(+d)) return iso;
  return d.toLocaleDateString(lang === "es" ? "es-US" : "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function wrap(
  text: string,
  font: PDFFont,
  size: number,
  max: number,
): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const probe = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(probe, size) <= max) line = probe;
      else {
        if (line) out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out.filter((l, i, a) => l || (i > 0 && i < a.length - 1));
}

/** "+18435550100" → "(843) 555-0100"; anything else as given. */
function fmtPhone(p: string | undefined): string | undefined {
  const m = p?.replace(/[^\d]/g, "").match(/^1?(\d{3})(\d{3})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : p;
}

/** A mailing block from the one-line address: "725 Frederick Rd, Myrtle Beach, SC" → two lines. */
export function mailingLines(address: string | undefined): string[] {
  const a = address?.trim();
  if (!a) return [];
  const i = a.indexOf(",");
  return i < 0 ? [a] : [a.slice(0, i).trim(), a.slice(i + 1).trim()];
}

interface Biz {
  name: string;
  lines: string[];
  image?: PDFImage;
  lang: Lang;
  pay: { label: string; value: string }[];
}

@Injectable()
export class RenderInvoicePrintPdf {
  constructor(
    private invoices: InvoiceStore,
    private customers: CustomerStore,
    private users: UserStore,
    private identity: BusinessIdentityStore,
    private addresses: BusinessAddressStore,
    private logos: LoadBusinessLogo,
  ) {}

  async run(userId: string, ids: string[]): Promise<Uint8Array> {
    // owner-scoped: getOwned throws NotFound / Forbidden for anything else
    const invoices = winAnsiSafeDeep(
      await Promise.all(ids.map((id) => this.invoices.getOwned(id, userId))),
    );
    const [contractor, ident, addr, logo] = await Promise.all([
      this.users.get(userId).catch(() => undefined),
      this.identity.get(userId).catch(() => null),
      this.addresses.get(userId).catch(() => null),
      this.logos.run(userId),
    ]);
    const lang: Lang = ident?.commsLanguage === "es" ? "es" : "en";
    const name = ident?.businessName?.trim() || ident?.legalName?.trim() ||
      contractor?.name?.trim() || t(lang, "printPdf.contractorFallback");
    const street = [addr?.street].filter(Boolean).join(" ");
    const cityLine = [
      addr?.city,
      [addr?.state, addr?.postal].filter(Boolean).join(" "),
    ].filter((v) => v && String(v).trim()).join(", ");
    const pdf = await PDFDocument.create();
    pdf.setTitle(
      invoices.length === 1
        ? `${t(lang, "printPdf.invoice")} ${docRef(invoices[0])}`
        : `${t(lang, "printPdf.invoice")} × ${invoices.length}`,
    );
    pdf.setAuthor(winAnsiSafeDeep(name));
    pdf.setProducer(winAnsiSafeDeep(name));
    pdf.setCreator(winAnsiSafeDeep(name));
    const biz: Biz = winAnsiSafeDeep({
      name,
      lines: [
        street,
        cityLine,
        fmtPhone(contractor?.phoneNumber),
        contractor?.email,
      ].filter((v): v is string => !!v && v.trim().length > 0),
      lang,
      pay: payOptionLines(ident?.acceptedPaymentMethods, lang),
    });
    biz.image = await embedLogo(pdf, logo);
    const reg = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const customerById = new Map<
      string,
      Awaited<ReturnType<CustomerStore["getOwned"]>> | undefined
    >();
    for (const inv of invoices) {
      if (inv.customerId && !customerById.has(inv.customerId)) {
        customerById.set(
          inv.customerId,
          winAnsiSafeDeep(
            await this.customers.getOwned(inv.customerId, userId).catch(() =>
              undefined
            ),
          ),
        );
      }
      const live = inv.customerId
        ? customerById.get(inv.customerId)
        : undefined;
      drawInvoice(pdf, inv, customerOnDocument(inv, live), biz, reg, bold);
    }
    return await pdf.save();
  }
}

function drawInvoice(
  pdf: PDFDocument,
  inv: Invoice,
  customer:
    | { name?: string; businessName?: string; address?: string }
    | undefined,
  biz: Biz,
  reg: PDFFont,
  bold: PDFFont,
) {
  const { W, H } = PAGE;
  const lang = biz.lang;
  const ref = docRef(inv);
  const pages: PDFPage[] = [];
  let page = pdf.addPage([W, H]);
  pages.push(page);
  const text = (
    s: string,
    x: number,
    y: number,
    o: { size?: number; font?: PDFFont; color?: typeof INK; right?: boolean } =
      {},
  ) => {
    const size = o.size ?? 10;
    const font = o.font ?? reg;
    const xx = o.right ? x - font.widthOfTextAtSize(s, size) : x;
    page.drawText(s, { x: xx, y, size, font, color: o.color ?? INK });
  };

  // ---- header: brand + return address (left), INVOICE block (right)
  drawBrandMark(page, {
    image: biz.image,
    name: biz.name,
    x: M,
    top: H - 36,
    boxW: 220,
    boxH: 44,
    font: bold,
    color: INK,
    maxTextSize: 18,
  });
  let ry = H - 92;
  if (biz.image) {
    text(biz.name, M, ry, { size: 9, font: bold });
    ry -= 11;
  }
  for (const l of biz.lines.slice(0, 4)) {
    text(l, M, ry, { size: 9, color: SOFT });
    ry -= 11;
  }

  const R = W - M;
  text(t(lang, "printPdf.invoice"), R, H - 58, {
    size: 22,
    font: bold,
    right: true,
  });
  text(ref, R, H - 76, { size: 11, font: bold, right: true });
  const issued = inv.issuedDate ?? inv.sentAt ?? inv.createdAt;
  text(`${t(lang, "printPdf.issued")}: ${fmtDate(issued, lang)}`, R, H - 92, {
    size: 9,
    color: SOFT,
    right: true,
  });
  if (inv.dueDate) {
    text(
      `${t(lang, "printPdf.due")}: ${fmtDate(inv.dueDate, lang)}`,
      R,
      H - 104,
      {
        size: 9,
        color: SOFT,
        right: true,
      },
    );
  }
  const paidCents = inv.paidCents ?? 0;
  const balance = Math.max(0, (inv.amount ?? 0) - paidCents);
  const isPaid = inv.status === "paid";
  const isVoid = inv.status === "void";
  if (isVoid) {
    text(t(lang, "printPdf.cancelled"), R, H - 132, {
      size: 12,
      font: bold,
      right: true,
    });
  } else if (isPaid) {
    text(t(lang, "printPdf.paidInFull"), R, H - 132, {
      size: 12,
      font: bold,
      right: true,
    });
  } else {
    text(t(lang, "printPdf.balanceDue").toUpperCase(), R, H - 122, {
      size: 8,
      font: bold,
      color: SOFT,
      right: true,
    });
    text(fmtUSD(balance), R, H - 142, { size: 18, font: bold, right: true });
  }

  // ---- the window: the customer's mailing block
  {
    const lines = [
      customer?.name ?? customer?.businessName,
      customer?.name && customer?.businessName &&
        customer.name !== customer.businessName
        ? customer.businessName
        : undefined,
      ...mailingLines(customer?.address),
    ].filter((v): v is string => !!v && v.trim().length > 0).slice(0, 5);
    let wy = WINDOW.top - 11;
    for (const [i, l] of lines.entries()) {
      const size = 11;
      let s = l;
      const f = i === 0 ? bold : reg;
      while (s.length > 4 && f.widthOfTextAtSize(s, size) > WINDOW.width) {
        s = s.slice(0, -2);
      }
      text(s, WINDOW.x, wy, { size, font: f });
      wy -= 13;
    }
  }

  // ---- body
  let y = H - 262;
  const newPage = () => {
    page = pdf.addPage([W, H]);
    pages.push(page);
    y = H - 54;
    text(t(lang, "printPdf.continued", { number: ref }), M, y, {
      size: 9,
      font: bold,
      color: SOFT,
    });
    y -= 24;
  };
  const need = (h: number) => {
    if (y - h < 64) newPage();
  };
  const rule = (yy: number, w = 0.6) =>
    page.drawLine({
      start: { x: M, y: yy },
      end: { x: R, y: yy },
      thickness: w,
      color: RULE,
    });

  if (inv.jobName?.trim()) {
    for (const l of wrap(inv.jobName.trim(), bold, 13, R - M)) {
      text(l, M, y, { size: 13, font: bold });
      y -= 17;
    }
    y -= 4;
  }
  if (inv.serviceAddress?.trim()) {
    text(
      `${t(lang, "printPdf.serviceAddress")}: ${inv.serviceAddress.trim()}`,
      M,
      y,
      { size: 9, color: SOFT },
    );
    y -= 16;
  }

  const QTY_X = R - 110;
  const header = () => {
    text(t(lang, "printPdf.description").toUpperCase(), M, y, {
      size: 8,
      font: bold,
      color: SOFT,
    });
    text(t(lang, "printPdf.qty").toUpperCase(), QTY_X, y, {
      size: 8,
      font: bold,
      color: SOFT,
      right: true,
    });
    text(t(lang, "printPdf.amount").toUpperCase(), R, y, {
      size: 8,
      font: bold,
      color: SOFT,
      right: true,
    });
    y -= 6;
    rule(y);
    y -= 14;
  };
  const row = (
    desc: string,
    qty: string,
    amount: string,
    o: { bold?: boolean } = {},
  ) => {
    const lines = wrap(desc, o.bold ? bold : reg, 10, QTY_X - M - 40);
    need(lines.length * 13 + 4);
    for (const [i, l] of lines.entries()) {
      text(l, M, y, { size: 10, font: o.bold ? bold : reg });
      if (i === 0) {
        if (qty) text(qty, QTY_X, y, { size: 10, right: true });
        if (amount) text(amount, R, y, { size: 10, right: true });
      }
      y -= 13;
    }
    y -= 2;
  };

  const visits = groupVisits(inv.lineItems);
  if (visits) {
    header();
    for (const g of visits) {
      row(g.address, "", "", { bold: true });
      for (const v of g.visits) {
        row(
          `${fmtVisitDate(v.date, lang)} — ${v.service}`,
          "1",
          fmtUSD(v.price),
        );
      }
    }
  } else if (inv.lineItems?.length) {
    header();
    for (const li of inv.lineItems) {
      const q = li.quantity ?? 1;
      row(li.description || "—", String(q), fmtUSD((li.price ?? 0) * q));
    }
  } else if (inv.description?.trim()) {
    header();
    row(inv.description.trim(), "", fmtUSD(inv.amount));
  }

  // ---- totals
  {
    const rows: Array<[string, string, boolean]> = [];
    if (typeof inv.subtotalCents === "number") {
      rows.push([
        t(lang, "printPdf.subtotal"),
        fmtUSD(inv.subtotalCents),
        false,
      ]);
    }
    if (inv.discountCents) {
      rows.push([
        t(lang, "printPdf.discount"),
        `-${fmtUSD(inv.discountCents)}`,
        false,
      ]);
    }
    if (typeof inv.taxCents === "number" && inv.taxCents) {
      const rate = fmtTaxRate(inv.taxRateBp);
      rows.push([
        rate ? `${t(lang, "printPdf.tax")} (${rate})` : t(lang, "printPdf.tax"),
        fmtUSD(inv.taxCents),
        false,
      ]);
    }
    rows.push([t(lang, "printPdf.total"), fmtUSD(inv.amount), true]);
    if (paidCents > 0) {
      rows.push([t(lang, "printPdf.paid"), `-${fmtUSD(paidCents)}`, false]);
      rows.push([t(lang, "printPdf.balanceDue"), fmtUSD(balance), true]);
    }
    need(rows.length * 15 + 12);
    y -= 4;
    page.drawLine({
      start: { x: R - 220, y: y + 10 },
      end: { x: R, y: y + 10 },
      thickness: 0.6,
      color: RULE,
    });
    for (const [label, value, strong] of rows) {
      text(label, R - 220, y, { size: 10, font: strong ? bold : reg });
      text(value, R, y, { size: 10, font: strong ? bold : reg, right: true });
      y -= 15;
    }
    y -= 8;
  }

  // ---- the business's own payment instructions
  if (inv.paymentInstructions?.trim()) {
    const lines = wrap(inv.paymentInstructions.trim(), reg, 9.5, R - M);
    need(lines.length * 12 + 18);
    text(t(lang, "printPdf.notes"), M, y, { size: 9, font: bold });
    y -= 13;
    for (const l of lines) {
      text(l, M, y, { size: 9.5 });
      y -= 12;
    }
    y -= 8;
  }

  // ---- How to pay: methods + the link + a QR to it (not on a void / paid bill)
  if (!isVoid && !isPaid) {
    const url = `${appUrl()}/i/${inv.id}`;
    const QR = 84;
    const textW = R - M - QR - 36;
    const lines = biz.pay.flatMap((p) =>
      wrap(`${p.label}: ${p.value}`, reg, 9.5, textW)
    );
    const urlLines = wrap(
      t(lang, "printPdf.payOnline", { url }),
      reg,
      9,
      textW,
    );
    const boxH = Math.max(
      QR + 28,
      30 + lines.length * 12.5 + 6 + urlLines.length * 11.5,
    );
    need(boxH + 6);
    const top = y + 4;
    page.drawRectangle({
      x: M,
      y: top - boxH,
      width: R - M,
      height: boxH,
      borderColor: INK,
      borderWidth: 0.8,
    });
    let by = top - 18;
    text(t(lang, "printPdf.howToPay"), M + 12, by, { size: 11, font: bold });
    by -= 16;
    for (const l of lines) {
      text(l, M + 12, by, { size: 9.5 });
      by -= 12.5;
    }
    by -= 4;
    for (const l of urlLines) {
      text(l, M + 12, by, { size: 9, font: bold });
      by -= 11.5;
    }
    drawQr(page, url, R - 12 - QR, top - 10 - QR, QR);
    text(
      t(lang, "printPdf.scanToPay"),
      R - 12 - QR / 2 -
        reg.widthOfTextAtSize(t(lang, "printPdf.scanToPay"), 7.5) / 2,
      top - QR - 20,
      {
        size: 7.5,
        color: SOFT,
      },
    );
    y = top - boxH - 12;
  }

  // ---- footers: "INV-001 · Page 1 of 2"
  for (const [i, p] of pages.entries()) {
    const s = t(lang, "printPdf.page", {
      number: ref,
      page: i + 1,
      pages: pages.length,
    });
    const w = reg.widthOfTextAtSize(s, 8);
    p.drawText(s, { x: (W - w) / 2, y: 30, size: 8, font: reg, color: SOFT });
  }
}

/** A QR code to `url`, drawn as black runs (no image, prints sharp at any DPI). */
function drawQr(
  page: PDFPage,
  url: string,
  x: number,
  y: number,
  size: number,
) {
  const m = qrcode(url) as boolean[][];
  const n = m.length;
  const cell = size / n;
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!m[r][c]) {
        c++;
        continue;
      }
      let e = c;
      while (e < n && m[r][e]) e++;
      page.drawRectangle({
        x: x + c * cell,
        y: y + size - (r + 1) * cell,
        width: (e - c) * cell,
        height: cell,
        color: INK,
      });
      c = e;
    }
  }
}
