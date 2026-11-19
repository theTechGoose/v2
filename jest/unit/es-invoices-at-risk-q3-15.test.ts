/**
 * REQ-1083 — LOOP-007 cycle 3, issue q3-15 [minor/BUG_POLISH]: the Spanish
 * /invoices hero's at-risk line read "⚠ $225 en riesgo en 1 vencidas factura."
 * The line was pieced together in English word order
 * (`{money} {atRisk.across} {n} {atRisk.overdue} {unitInvoice.one|other}`)
 * with a fixed plural adjective "vencidas". Spanish needs noun-then-adjective
 * with agreement: "en riesgo en 1 factura vencida" / "en riesgo en 2 facturas
 * vencidas". The fix is one whole-sentence one/other key,
 * `invoicesPage.atRisk.line`, rendered with tnFor (the REQ-986 pattern).
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
const DICTS = { en, es } as const;
type L = keyof typeof DICTS;
const PAGE = read("front-end/islands/InvoicesPage.tsx");

const fill = (s: string, vars: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
/** Mirrors front-end/lib/i18n.ts tnFor. */
const tn = (lang: L, key: string, n: number) => {
  const k = `${key}.${n === 1 ? "one" : "other"}`;
  const v = DICTS[lang][k];
  if (!v) throw new Error(`missing ${lang} key ${k}`);
  return fill(v, { n });
};

/** The at-risk <p data-cy="forecast-at-risk"> block of the island source. */
const atRiskBlock = () => {
  const i = PAGE.indexOf('data-cy="forecast-at-risk"');
  expect(i).toBeGreaterThan(0);
  const end = PAGE.indexOf("</p>", i);
  return PAGE.slice(i, end);
};

describe("REQ-1083 (q3-15) the at-risk hero line is one whole sentence that agrees with its count", () => {
  test("REQ-1083 es n=1 reads 'en riesgo en 1 factura vencida'", () => {
    expect(tn("es", "invoicesPage.atRisk.line", 1)).toBe(
      "en riesgo en 1 factura vencida",
    );
  });
  test("REQ-1083 es n=2 reads 'en riesgo en 2 facturas vencidas'", () => {
    expect(tn("es", "invoicesPage.atRisk.line", 2)).toBe(
      "en riesgo en 2 facturas vencidas",
    );
  });
  test("REQ-1083 en keeps 'at risk across N overdue invoice(s)'", () => {
    expect(tn("en", "invoicesPage.atRisk.line", 1)).toBe(
      "at risk across 1 overdue invoice",
    );
    expect(tn("en", "invoicesPage.atRisk.line", 2)).toBe(
      "at risk across 2 overdue invoices",
    );
  });
  test("REQ-1083 the island renders the at-risk line through tnFor(lang, 'invoicesPage.atRisk.line', …)", () => {
    const block = atRiskBlock();
    expect(block).toMatch(/tnFor\(\s*lang,\s*"invoicesPage\.atRisk\.line"/);
  });
  test("REQ-1083 the island no longer glues atRisk.overdue before unitInvoice (English word order)", () => {
    const block = atRiskBlock();
    expect(block).not.toMatch(/invoicesPage\.atRisk\.overdue/);
    expect(block).not.toMatch(/invoicesPage\.unitInvoice/);
  });
});
