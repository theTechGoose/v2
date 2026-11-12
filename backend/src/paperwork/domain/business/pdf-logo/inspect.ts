/**
 * Test helper (REQ-628/629): what a PDF actually carries — page count, the
 * images placed on its pages, and the text it draws (content streams
 * inflated, WinAnsi hex strings decoded). Used by the PDF tests only.
 */
import {
  decodePDFRawStream,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
} from "#pdf-lib";

export interface PdfFacts {
  pages: number;
  /** image XObjects in the file */
  images: number;
  /** per page: how many images that page paints */
  imagesPerPage: number[];
  /** every string the content streams show, joined by newlines */
  text: string;
  title?: string;
  author?: string;
  producer?: string;
  creator?: string;
}

function decodeShown(stream: string): string {
  const out: string[] = [];
  for (const m of stream.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
    const hex = m[1];
    let s = "";
    for (let i = 0; i + 1 < hex.length; i += 2) {
      s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    }
    out.push(s);
  }
  for (const m of stream.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)) {
    out.push(m[1]);
  }
  return out.join("\n");
}

export async function pdfFacts(bytes: Uint8Array): Promise<PdfFacts> {
  const doc = await PDFDocument.load(bytes);
  let images = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (
      obj instanceof PDFRawStream &&
      obj.dict.get(PDFName.of("Subtype")) === PDFName.of("Image")
    ) images++;
  }
  const texts: string[] = [];
  const imagesPerPage: number[] = [];
  for (const page of doc.getPages()) {
    const contents = page.node.Contents();
    const streams: PDFRawStream[] = [];
    const push = (o: unknown) => {
      const r = o instanceof PDFRawStream ? o : doc.context.lookup(o as never);
      if (r instanceof PDFRawStream) streams.push(r);
    };
    if (contents && "asArray" in contents) {
      for (
        const o of (contents as unknown as { asArray(): unknown[] }).asArray()
      ) push(o);
    } else if (contents) push(contents);
    let pageText = "";
    for (const s of streams) {
      try {
        pageText += new TextDecoder("latin1").decode(
          decodePDFRawStream(s).decode(),
        ) + "\n";
      } catch { /* not a flate stream */ }
    }
    texts.push(decodeShown(pageText));
    imagesPerPage.push((pageText.match(/\/[^\s/]+ Do\b/g) ?? []).length);
    void PDFDict;
  }
  return {
    pages: doc.getPageCount(),
    images,
    imagesPerPage,
    text: texts.join("\n"),
    title: doc.getTitle(),
    author: doc.getAuthor(),
    producer: doc.getProducer(),
    creator: doc.getCreator(),
  };
}
