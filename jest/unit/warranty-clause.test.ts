/**
 * REQ-463 — demo-loop cycle 3, issue m31: "Warranty clause says 'por el
 * período indicado' with no period set". The agreement's legal clause list
 * (web /q and the PDF) always printed clause 7 "El contratista garantiza su
 * mano de obra por el período indicado en este acuerdo" — even for a lawn-care
 * job quoted through the service wizard (REQ-343, no warranty step) or a
 * quote where "No warranty" was picked, so it pointed at a period that the
 * agreement never states.
 *
 * One pure helper, `agreementClauses` in shared/documents/warranty-clause.ts,
 * now owns the clause list and picks the warranty body from the terms. It is
 * fed the real dictionaries here.
 */
import * as fs from "fs";
import * as path from "path";
import {
  agreementClauses,
  warrantyClauseKind,
} from "../../shared/documents/warranty-clause";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const DICTS = {
  en: JSON.parse(read("lang/en.json")) as Record<string, string>,
  es: JSON.parse(read("lang/es.json")) as Record<string, string>,
};
const tr =
  (lang: "en" | "es") =>
  (key: string, vars: Record<string, string | number> = {}) => {
    const s = DICTS[lang][key];
    if (s === undefined) throw new Error(`missing ${lang} key ${key}`);
    return s.replace(
      /\{(\w+)\}/g,
      (_, k) => (k in vars ? String(vars[k]) : `{${k}}`),
    );
  };
/** The stored English value localized the way both renderers do it. */
const localize = (v: string, lang: "en" | "es") =>
  lang === "en" ? v : v.replace(/\bmonths\b/g, "meses").replace(
    /\byear\b/g,
    "año",
  );

const PREFIXES = ["quoteDoc.clause", "renderQuotePdf.clause"] as const;
const warrantyBody = (
  lang: "en" | "es",
  prefix: string,
  terms?: { stepId: string; value: string }[],
) => {
  const clauses = agreementClauses({
    terms,
    lang,
    prefix,
    t: tr(lang),
    localize,
  });
  const i = clauses.findIndex(([title]) =>
    title.replace(/\.$/, "") === (lang === "es" ? "Garantía" : "Warranty")
  );
  expect(i).toBe(6); // clause 7 keeps its place — numbering never shifts
  expect(clauses).toHaveLength(14);
  return clauses[i][1];
};

const SERVICE_TERMS = [
  { stepId: "customer", value: "Ana" },
  { stepId: "start_date", value: "Right away" },
  { stepId: "wraps", value: "2 hours" },
  { stepId: "payment_terms", value: "Payment upon completion" },
];

describe("REQ-463 (demo m31, cycle 3) the warranty clause never points at a period the agreement doesn't state", () => {
  for (const prefix of PREFIXES) {
    test(`REQ-463 ${prefix}: service-wizard terms (no warranty row) → no 'período indicado', a no-warranty body`, () => {
      const es = warrantyBody("es", prefix, SERVICE_TERMS);
      expect(es).not.toMatch(/período indicado/);
      expect(es).toMatch(/no incluye una garantía de mano de obra/);
      const en = warrantyBody("en", prefix, SERVICE_TERMS);
      expect(en).not.toMatch(/period stated/);
      expect(en).toMatch(/does not include a workmanship warranty/);
    });

    test(`REQ-463 ${prefix}: no terms at all → the no-warranty body`, () => {
      expect(warrantyBody("es", prefix, undefined)).not.toMatch(
        /período indicado/,
      );
    });

    test(`REQ-463 ${prefix}: 'No warranty' picked → the no-warranty body`, () => {
      const es = warrantyBody("es", prefix, [
        ...SERVICE_TERMS,
        { stepId: "warranty", value: "No warranty" },
      ]);
      expect(es).not.toMatch(/período indicado/);
      expect(es).toMatch(/no incluye una garantía de mano de obra/);
    });

    test(`REQ-463 ${prefix}: a 6-month warranty → the clause fills in 'por 6 meses' / 'for 6 months'`, () => {
      const terms = [
        ...SERVICE_TERMS,
        { stepId: "warranty", value: "6 months" },
      ];
      const es = warrantyBody("es", prefix, terms);
      expect(es).toMatch(/garantiza su mano de obra por 6 meses/);
      expect(es).not.toMatch(/período indicado/);
      expect(warrantyBody("en", prefix, terms)).toMatch(
        /warrants their workmanship for 6 months/,
      );
    });

    test(`REQ-463 ${prefix}: 'Lifetime' → a lifetime body, never 'por Lifetime'`, () => {
      const es = warrantyBody("es", prefix, [
        { stepId: "warranty", value: "Lifetime" },
      ]);
      expect(es).not.toMatch(/por Lifetime|por De por vida/);
      expect(es).toMatch(/de por vida/i);
    });
  }

  test("REQ-463 warrantyClauseKind reads the stored values", () => {
    expect(warrantyClauseKind(undefined)).toEqual({ kind: "none" });
    expect(warrantyClauseKind([{ stepId: "warranty", value: "  " }]))
      .toEqual({ kind: "none" });
    expect(warrantyClauseKind([{ stepId: "warranty", value: "Sin garantía" }]))
      .toEqual({ kind: "none" });
    expect(warrantyClauseKind([{ stepId: "warranty", value: "De por vida" }]))
      .toEqual({ kind: "lifetime" });
    expect(warrantyClauseKind([{ stepId: "warranty", value: "1 year" }]))
      .toEqual({ kind: "period", period: "1 year" });
    // a bare custom number is the custom_months option
    expect(warrantyClauseKind([{ stepId: "warranty", value: "18" }]))
      .toEqual({ kind: "period", period: "18 months" });
  });

  test("REQ-463 en/es carry the new warranty bodies under both prefixes, {period} in sync", () => {
    for (const prefix of PREFIXES) {
      for (const v of ["bodyPeriod", "bodyLifetime", "bodyNone"]) {
        const key = `${prefix}.warranty.${v}`;
        expect(DICTS.en[key]).toBeTruthy();
        expect(DICTS.es[key]).toBeTruthy();
        expect(DICTS.en[key].includes("{period}")).toBe(v === "bodyPeriod");
        expect(DICTS.es[key].includes("{period}")).toBe(v === "bodyPeriod");
      }
    }
  });

  test("REQ-463 the web agreement and the PDF both render the clauses through agreementClauses (no fixed list)", () => {
    const doc = read("front-end/components/quote-doc.tsx");
    const pdf = read(
      "backend/src/paperwork/domain/coordinators/render-quote-pdf/mod.ts",
    );
    for (const src of [doc, pdf]) {
      expect(src).toMatch(/agreementClauses\(/);
      expect(src).not.toMatch(/const clauseKeys = \[/);
    }
  });
});
