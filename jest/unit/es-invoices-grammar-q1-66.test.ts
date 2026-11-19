/**
 * REQ-986 — LOOP-007 cycle 1, issue q1-66: the Spanish /invoices page has a
 * plural mismatch ("1 está vencidas"), a gender mismatch (the paid card's
 * badge "PAGADO" beside "Pagada 19 nov") and a usted form ("para sus
 * registros") where the app speaks tú.
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
  const v = DICTS[lang][`${key}.${n === 1 ? "one" : "other"}`];
  expect(v).toBeTruthy();
  return fill(v, { n });
};

describe("REQ-986 (q1-66) the past-due hero line agrees with its count", () => {
  test("es n=1 reads 'está vencida', never 'vencidas'", () => {
    const one = tn("es", "invoicesPage.sub.pastDue", 1);
    expect(one).toMatch(/\bvencida\b/);
    expect(one).not.toMatch(/vencidas/);
  });
  test("es n=2 reads 'vencidas'", () => {
    expect(tn("es", "invoicesPage.sub.pastDue", 2)).toMatch(/vencidas/);
  });
  test("en has both forms too", () => {
    expect(tn("en", "invoicesPage.sub.pastDue", 1)).toMatch(/^is past due/);
    expect(tn("en", "invoicesPage.sub.pastDue", 2)).toMatch(/^are past due/);
  });
  test("the page renders the hero line through the one/other pair", () => {
    expect(PAGE).toMatch(
      /tnFor\(\s*lang,\s*"invoicesPage\.sub\.pastDue"/,
    );
    expect(PAGE).not.toMatch(/"invoicesPage\.sub\.pastDue"\s*\)/);
  });
});

describe("REQ-986 (q1-66) the paid card's badge is feminine like the rest", () => {
  test("STAGE_MOOD.paid.labelKey resolves in es to a feminine word", () => {
    const m = PAGE.match(/\n\s*paid:\s*\{[^}]*?labelKey:\s*"([^"]+)"/);
    expect(m).toBeTruthy();
    const label = es[m![1]];
    expect(label).toBeTruthy();
    expect(label).toMatch(/a$/);
    expect(label).toBe("Pagada");
  });
});

describe("REQ-986 (q1-66) the cancelled-tab hint speaks tú", () => {
  test("es invoicesPage.empty.cancelled has no usted form", () => {
    const s = es["invoicesPage.empty.cancelled"];
    expect(s).not.toMatch(/\bsus?\b|usted/i);
    expect(s).toMatch(/tus registros/);
  });
});
