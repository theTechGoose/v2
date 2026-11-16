/**
 * REQ-886b / REQ-885e — PDF pages drawn into canvases, through pdf.js loaded from the CDN on
 * first use (the way the assignments map loads Leaflet). The builder stamps fields over the
 * pages; the phone shows them under the signature pad. Guarded: when the CDN is unreachable the
 * caller shows its "renderer isn't available" line instead of a blank page.
 */
const PDFJS_VERSION = "3.11.174";
const PDFJS_URL =
  `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build/pdf.min.js`;
const WORKER_URL =
  `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build/pdf.worker.min.js`;

interface PdfPageLike {
  getViewport(o: { scale: number }): { width: number; height: number };
  render(
    o: { canvasContext: CanvasRenderingContext2D; viewport: unknown },
  ): { promise: Promise<void> };
}
interface PdfDocLike {
  numPages: number;
  getPage(n: number): Promise<PdfPageLike>;
}
interface PdfJsLike {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(src: { data: Uint8Array } | { url: string }): {
    promise: Promise<PdfDocLike>;
  };
}

let loading: Promise<PdfJsLike | null> | null = null;

export function loadPdfJs(): Promise<PdfJsLike | null> {
  if (typeof document === "undefined") return Promise.resolve(null);
  const have = (globalThis as { pdfjsLib?: PdfJsLike }).pdfjsLib;
  if (have) return Promise.resolve(have);
  if (loading) return loading;
  loading = new Promise<PdfJsLike | null>((resolve) => {
    const s = document.createElement("script");
    s.src = PDFJS_URL;
    s.async = true;
    s.onload = () => {
      const lib = (globalThis as { pdfjsLib?: PdfJsLike }).pdfjsLib ?? null;
      if (lib) lib.GlobalWorkerOptions.workerSrc = WORKER_URL;
      resolve(lib);
    };
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return loading;
}

export interface RenderedPage {
  index: number;
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

/**
 * Draw up to `maxPages` pages of the PDF at `url` (fetched with the page's cookies) or from
 * `bytes`, each `targetWidth` px wide. null when the renderer could not load; throws when the
 * bytes are not a PDF.
 */
export async function renderPdfPages(
  src: { url: string } | { bytes: Uint8Array },
  targetWidth: number,
  maxPages = 8,
): Promise<RenderedPage[] | null> {
  const lib = await loadPdfJs();
  if (!lib) return null;
  let data: Uint8Array;
  if ("bytes" in src) data = src.bytes;
  else {
    const r = await fetch(src.url, { credentials: "include" });
    if (!r.ok) throw new Error(`pdf ${r.status}`);
    data = new Uint8Array(await r.arrayBuffer());
  }
  const pdf = await lib.getDocument({ data }).promise;
  const out: RenderedPage[] = [];
  const n = Math.min(pdf.numPages, maxPages);
  for (let i = 1; i <= n; i++) {
    const page = await pdf.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const scale = targetWidth / base.width;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const vp = page.getViewport({ scale: scale * dpr });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    canvas.style.width = `${Math.round(vp.width / dpr)}px`;
    canvas.style.height = `${Math.round(vp.height / dpr)}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    out.push({
      index: i - 1,
      canvas,
      width: Math.round(vp.width / dpr),
      height: Math.round(vp.height / dpr),
    });
  }
  return out;
}

/** a File → base64 (no data: prefix), the shape POST /hr/documents/:id/pdf takes */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result ?? "");
      resolve(s.slice(s.indexOf(",") + 1));
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
