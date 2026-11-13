/**
 * REQ-628 — the business's own logo on every PDF its customer sees. PNG and
 * JPG (sniffed from the bytes, not trusted from the upload's mime type),
 * scaled to fit a fixed box keeping the aspect ratio. No logo → the business
 * name as a text wordmark; never the house brand.
 */
import type { PDFDocument, PDFFont, PDFImage, PDFPage, RGB } from "#pdf-lib";

export interface LogoBytes {
  bytes: Uint8Array;
  mimeType?: string;
}

export function logoKind(bytes: Uint8Array): "png" | "jpg" | undefined {
  if (
    bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 &&
    bytes[2] === 0x4e && bytes[3] === 0x47
  ) return "png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  return undefined;
}

/** Scale (w × h) to fit inside (boxW × boxH), aspect ratio kept. */
export function fitInBox(
  w: number,
  h: number,
  boxW: number,
  boxH: number,
): { width: number; height: number } {
  if (!(w > 0 && h > 0)) return { width: 0, height: 0 };
  const s = Math.min(boxW / w, boxH / h);
  return {
    width: Math.round(w * s * 100) / 100,
    height: Math.round(h * s * 100) / 100,
  };
}

/** Embed the logo, or undefined when there is none or it is not a usable PNG/JPG. */
export async function embedLogo(
  pdf: PDFDocument,
  logo: LogoBytes | undefined,
): Promise<PDFImage | undefined> {
  if (!logo?.bytes?.length) return undefined;
  const kind = logoKind(logo.bytes);
  try {
    if (kind === "png") return await pdf.embedPng(logo.bytes);
    if (kind === "jpg") return await pdf.embedJpg(logo.bytes);
  } catch (e) {
    console.warn("[pdf-logo] logo not embeddable:", (e as Error).message);
  }
  return undefined;
}

/**
 * Draw the brand mark in a box whose top edge is `top`: the logo (fit) or,
 * without one, the name as a bold wordmark shrunk to the box width. `align`
 * places it left / centre / right inside the box. Returns the height used.
 */
export function drawBrandMark(page: PDFPage, o: {
  image?: PDFImage;
  name: string;
  x: number;
  top: number;
  boxW: number;
  boxH: number;
  font: PDFFont;
  color: RGB;
  align?: "left" | "center";
  maxTextSize?: number;
}): number {
  const align = o.align ?? "left";
  if (o.image) {
    const { width, height } = fitInBox(
      o.image.width,
      o.image.height,
      o.boxW,
      o.boxH,
    );
    const x = align === "center" ? o.x + (o.boxW - width) / 2 : o.x;
    page.drawImage(o.image, { x, y: o.top - height, width, height });
    return height;
  }
  let size = o.maxTextSize ?? 20;
  while (size > 8 && o.font.widthOfTextAtSize(o.name, size) > o.boxW) {
    size -= 0.5;
  }
  const w = o.font.widthOfTextAtSize(o.name, size);
  const x = align === "center" ? o.x + (o.boxW - w) / 2 : o.x;
  page.drawText(o.name, {
    x,
    y: o.top - size,
    size,
    font: o.font,
    color: o.color,
  });
  return size + 4;
}
