/**
 * REQ-275 — demo issue i18n-formatting-m13: the copy typos the 20-agent demo read
 * ("Once a agreement", "pagó por por Zelle", "1 confirmadas", "CANCELATION",
 * "Note ·", "customer.They'll"). RCA: demo-rca.md / i18n-m13.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
const DICTS = { en, es };

const fill = (s: string, vars: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));

const METHODS = [
  "ach",
  "card",
  "cash",
  "cashApp",
  "check",
  "other",
  "paypal",
  "venmo",
  "zelle",
];

describe("REQ-275 invoices copy reads as a sentence (demo i18n-formatting-m13)", () => {
  test("the empty-state sub says 'Once an agreement'", () => {
    expect(en["invoicesPage.sub.empty"]).toMatch(/^Once an agreement /);
  });

  for (const lang of ["en", "es"] as const) {
    test(`${lang}: '<name> says they paid <method>' never doubles the preposition`, () => {
      const d = DICTS[lang];
      for (const m of METHODS) {
        const label = d[`invoicesPage.method.${m}`];
        expect(label).toBeTruthy();
        const s = fill(d["invoicesPage.read.claimed"], {
          name: "Ana",
          method: label,
        });
        // "via via", "por por", "paid via by check", "pagó por con tarjeta"…
        expect(s).not.toMatch(
          /\b(via|by|in|por|con|en)\s+(via|by|in|por|con|en)\b/,
        );
        expect(s).toContain(label);
      }
    });
  }

  test("the method label is the only preposition: 'paid via Zelle' / 'pagó por Zelle'", () => {
    expect(
      fill(en["invoicesPage.read.claimed"], {
        name: "Ana",
        method: en["invoicesPage.method.zelle"],
      }),
    ).toMatch(/^Ana says they paid via Zelle\./);
    expect(
      fill(es["invoicesPage.read.claimed"], {
        name: "Ana",
        method: es["invoicesPage.method.zelle"],
      }),
    ).toMatch(/^Ana dice que pagó por Zelle\./);
  });

  test("the paid-KPI count has a singular and a plural in both languages", () => {
    for (const d of [en, es]) {
      expect(d["invoicesPage.kpi.paidSub.one"]).toBeTruthy();
      expect(d["invoicesPage.kpi.paidSub.other"]).toBeTruthy();
      expect(d["invoicesPage.kpi.paidSub"]).toBeUndefined();
    }
    expect(fill(es["invoicesPage.kpi.paidSub.one"], { n: 1 })).toBe(
      "1 confirmada",
    );
    expect(fill(es["invoicesPage.kpi.paidSub.other"], { n: 2 })).toBe(
      "2 confirmadas",
    );
  });

  test("InvoicesPage picks the paid-KPI form by count (tnFor), not the bare key", () => {
    const src = read("front-end/islands/InvoicesPage.tsx");
    expect(src).toMatch(
      /tnFor\(\s*lang,\s*"invoicesPage\.kpi\.paidSub",\s*paidCount/,
    );
    expect(src).not.toMatch(/"invoicesPage\.kpi\.paidSub",\s*\{/);
  });

  test("i18n exposes tnFor(lang, key, n, vars) picking .one/.other", () => {
    const src = read("front-end/lib/i18n.ts");
    expect(src).toMatch(
      /export function tnFor\(\s*lang: Lang,\s*key: string,\s*n: number/,
    );
  });
});

describe("REQ-275 'Cancellation' is spelled one way (demo i18n-formatting-m13)", () => {
  test("no English string spells it 'Cancelation'", () => {
    const hits = Object.entries(en).filter(([, v]) => /cancelation/i.test(v));
    expect(hits).toEqual([]);
    expect(en["quoteDoc.termLabel.cancellation"]).toBe("Cancellation");
    expect(en["renderQuotePdf.termLabel.cancellation"]).toBe("Cancellation");
  });
});

describe("REQ-275 the worker's note button shows a labelled marker, not a stray ' ·' (demo i18n-formatting-m13)", () => {
  const src = read("front-end/islands/WorkerScreen.tsx");
  test("no literal ' ·' suffix on the note button", () => {
    expect(src).not.toMatch(/note \? " ·" : ""/);
  });
  test("a has-note dot with an accessible label in both languages", () => {
    expect(src).toMatch(/data-cy="w-note-dot"/);
    expect(src).toMatch(/aria-label=\{t\("worker\.hasNote"\)\}/);
    expect(en["worker.hasNote"]).toBeTruthy();
    expect(es["worker.hasNote"]).toBeTruthy();
  });
});

describe("REQ-275 the clients empty hero keeps a space between its sentences (demo i18n-formatting-m13)", () => {
  test("a space sits before the <br /> so textContent reads 'customer. They'll'", () => {
    const src = read("front-end/components/ClientsSections.tsx");
    expect(src).toMatch(/<\/em>\. <br \/>/);
  });
});
