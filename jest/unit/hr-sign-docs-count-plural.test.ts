/**
 * REQ-1155 (LOOP-007 q3, q3-87) — the /sign/:token intro line counts the packet's documents
 * with the right noun: a one-document packet reads "1 documento" / "1 document", never
 * "1 documentos" / "1 documents". House convention (REQ-744, asstChat.payment.hintDays): the
 * call site picks `<key>.one` or `<key>.other` by the count; t() only fills {placeholders}.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const dicts = {
  en: JSON.parse(read("lang/en.json")) as Record<string, string>,
  es: JSON.parse(read("lang/es.json")) as Record<string, string>,
};
const island = read("front-end/islands/HrSignPacket.tsx");

/** The key expression HrSignPacket passes to t() for the docs count, evaluated for `total`. */
function keyFor(total: number): string {
  const m = island.match(/t\(\s*([^,]*hr\.sign\.docsCount[^,]*),\s*\{\s*n:\s*total\s*,?\s*\}\s*,?\s*\)/);
  if (!m) throw new Error("HrSignPacket.tsx: no t(<hr.sign.docsCount…>, { n: total }) call");
  // the first argument is a string literal or a template literal over `total`
  return new Function("total", `return ${m[1]};`)(total) as string;
}

/** What the island renders for `total` documents, filled like lib/i18n's t(). */
function line(lang: "en" | "es", total: number): string {
  const s = dicts[lang][keyFor(total)];
  expect(s).toBeTruthy();
  return s.replace(/\{(\w+)\}/g, (_, k) => (k === "n" ? String(total) : `{${k}}`));
}

describe("REQ-1155 (LOOP-007 q3, q3-87) /sign docs count agrees with the number of documents", () => {
  test("REQ-1155 es: one document is singular — '1 documento', not '1 documentos'", () => {
    expect(line("es", 1)).toBe("1 documento");
  });
  test("REQ-1155 en: one document is singular — '1 document', not '1 documents'", () => {
    expect(line("en", 1)).toBe("1 document");
  });
  test("REQ-1155 several documents keep the plural", () => {
    expect(line("es", 2)).toBe("2 documentos");
    expect(line("en", 2)).toBe("2 documents");
    expect(line("es", 5)).toBe("5 documentos");
  });
  test("REQ-1155 en and es both carry hr.sign.docsCount.one and .other", () => {
    for (const lang of ["en", "es"] as const) {
      expect(dicts[lang]["hr.sign.docsCount.one"]).toBeTruthy();
      expect(dicts[lang]["hr.sign.docsCount.other"]).toBeTruthy();
    }
  });
});
