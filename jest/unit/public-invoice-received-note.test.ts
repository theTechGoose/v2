/**
 * REQ-268 — demo issue M35: a paid public invoice (/i/:id) told the end
 * customer "¡Gracias! Rosa confirmó tu pago el 2026-11-11T20:57:57.358Z."
 * ReceivedNote put the raw invoice.paidAt (the Payment's receivedAt ISO
 * timestamp) into "publicInvoice.received.onDate". The note's sentence is now
 * one pure function, fed the real dictionaries here, that formats the date in
 * the page's language.
 */
import * as fs from "fs";
import * as path from "path";
import { receivedNoteBody } from "../../shared/documents/received-note";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const DICTS = {
  en: JSON.parse(read("lang/en.json")) as Record<string, string>,
  es: JSON.parse(read("lang/es.json")) as Record<string, string>,
};
const tr =
  (lang: "en" | "es") =>
  (key: string, vars: Record<string, string | number> = {}) =>
    DICTS[lang][key].replace(
      /\{(\w+)\}/g,
      (_, k) => (k in vars ? String(vars[k]) : `{${k}}`),
    );

const ISO = /\d{4}-\d{2}-\d{2}T/;
const PAID_AT = "2026-11-11T20:57:57.358Z";

describe("REQ-268 (M35) the paid public invoice's note never shows a raw ISO timestamp", () => {
  test("Spanish: the payment date is written out in Spanish", () => {
    const s = receivedNoteBody(tr("es"), "es", {
      paidAt: PAID_AT,
      who: "Rosa",
    });
    expect(s).not.toMatch(ISO);
    expect(s).toBe(
      "¡Gracias! Rosa confirmó tu pago el 11 de noviembre de 2026. Un recibo en PDF está en tu correo.",
    );
  });

  test("English: the payment date is written out in English", () => {
    const s = receivedNoteBody(tr("en"), "en", {
      paidAt: PAID_AT,
      who: "Rosa",
    });
    expect(s).not.toMatch(ISO);
    expect(s).toBe(
      "Thanks! Rosa confirmed your payment on November 11, 2026. A PDF receipt is in your inbox.",
    );
  });

  test("no paidAt: the sentence drops the date clause instead of printing an empty one", () => {
    expect(receivedNoteBody(tr("en"), "en", { who: "Rosa" })).toBe(
      "Thanks! Rosa confirmed your payment. A PDF receipt is in your inbox.",
    );
  });

  test("the /i page's ReceivedNote renders through receivedNoteBody, not the raw paidAt", () => {
    const src = read("front-end/routes/i/[id].tsx");
    const note = src.slice(src.indexOf("function ReceivedNote("));
    const body = note.slice(0, note.indexOf("\n}\n"));
    expect(body).toMatch(/receivedNoteBody\(/);
    expect(body).not.toMatch(/\{\s*date:\s*paidAt\s*\}/);
  });
});
