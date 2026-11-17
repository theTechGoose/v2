/**
 * REQ-783 (demo-loop cycle dv1, issue d4) — Raphael: "fix every issue the
 * demo found, loop until there are none." and, on default terms: "Yes,
 * default terms." (keep defaults such as the 7-day cancellation notice).
 *
 * Every agreement carried "Cancellation: 7 days' notice" (REQ-035,
 * quote-doc.tsx / render-quote-pdf) but the owner's quote review never
 * listed it and nothing could change it — a term reached the customer that
 * the owner never saw (cycle 5 m25). The default stays; the review lists it
 * as a Terms row the owner can change (7 / 14 / 30 days, custom) or remove
 * ("No notice period"), and every reader states what the review shows.
 */
import * as fs from "fs";
import * as path from "path";
import {
  CANCELLATION_STEP_ID,
  cancellationNotice,
  cancellationValueText,
  withCancellationRow,
} from "../../shared/quote-flow/cancellation-term";
import { previewTermRows } from "../../shared/quote-flow/wizard-terms";
import { invoiceTerms } from "../../shared/quote-flow/invoice-terms";
import { agreementClauses } from "../../shared/documents/warranty-clause";
import { quoteSignRefusal } from "../../shared/documents/versions";
import { localizeTermValue } from "../../front-end/lib/term-i18n";
import { tFor } from "../../front-end/lib/i18n";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const DICTS = {
  en: JSON.parse(read("lang/en.json")) as Record<string, string>,
  es: JSON.parse(read("lang/es.json")) as Record<string, string>,
};

const WIZARD_TERMS = [
  { stepId: "start_date", label: "Start date", value: "Right away" },
  { stepId: "wraps", label: "Time to complete", value: "1 week" },
  { stepId: "payment_terms", label: "Payment terms", value: "50/50" },
  { stepId: "warranty", label: "Warranty", value: "1 year" },
];
const cancel = (value: string) => ({
  stepId: CANCELLATION_STEP_ID,
  label: "Cancellation",
  value,
});

/** The review card's rows exactly as AsstChat builds them. */
const reviewRows = (
  quoteTerms: { stepId: string; label: string; value: string }[],
  lang: "en" | "es",
) =>
  withCancellationRow(
    previewTermRows({
      quoteTerms,
      messages: [],
      previewLang: lang,
      t: tFor,
      localize: localizeTermValue,
    }),
    { quoteTerms, lang, t: tFor, localize: localizeTermValue },
  );

const termination = (
  terms: { stepId: string; value: string }[] | undefined,
  lang: "en" | "es",
  prefix: string,
) => {
  const clauses = agreementClauses({
    terms,
    lang,
    prefix,
    t: (key, vars) => tFor(lang, key, vars),
    localize: localizeTermValue,
  });
  expect(clauses).toHaveLength(14);
  return clauses[9][1]; // clause 10 — Termination
};

describe("REQ-783 (dv1 d4) the default cancellation notice is a term the owner sees and can change", () => {
  it("REQ-783 a quote with no cancellation term keeps the 7-day default; an edit or a removal is read back", () => {
    expect(cancellationNotice(WIZARD_TERMS)).toEqual({ kind: "days", days: 7 });
    expect(cancellationNotice(undefined)).toEqual({ kind: "days", days: 7 });
    expect(cancellationNotice([...WIZARD_TERMS, cancel("14 days' notice")]))
      .toEqual({ kind: "days", days: 14 });
    // the review stores the option it shows, in the preview language
    expect(cancellationNotice([cancel("Aviso de 30 días")]))
      .toEqual({ kind: "days", days: 30 });
    expect(cancellationNotice([cancel("No notice period")]))
      .toEqual({ kind: "none" });
    expect(cancellationNotice([cancel("Sin plazo de aviso")]))
      .toEqual({ kind: "none" });
    expect(cancellationNotice([cancel("2 weeks")]))
      .toEqual({ kind: "text", text: "2 weeks" });
  });

  it("REQ-783 the quote review lists 'Cancellation: 7 days' notice' after the wizard terms (en + es)", () => {
    const en = reviewRows(WIZARD_TERMS, "en");
    expect(en[en.length - 1]).toEqual({
      stepId: CANCELLATION_STEP_ID,
      label: "Cancellation",
      value: "7 days' notice",
    });
    expect(en.map((r) => r.stepId)).toEqual([
      "start_date",
      "wraps",
      "payment_terms",
      "warranty",
      CANCELLATION_STEP_ID,
    ]);
    const es = reviewRows(WIZARD_TERMS, "es");
    expect(es[es.length - 1].value).toBe("Aviso de 7 días");
  });

  it("REQ-783 an edited or removed notice shows in the review once, as edited", () => {
    const edited = reviewRows(
      [...WIZARD_TERMS, cancel("Aviso de 14 días")],
      "en",
    );
    expect(edited.filter((r) => r.stepId === CANCELLATION_STEP_ID))
      .toEqual([{
        stepId: CANCELLATION_STEP_ID,
        label: "Cancellation",
        value: "14 days' notice",
      }]);
    const removed = reviewRows(
      [...WIZARD_TERMS, cancel("No notice period")],
      "es",
    );
    expect(removed[removed.length - 1].value).toBe("Sin plazo de aviso");
  });

  it("REQ-783 the agreement row (web + PDF keys) reads what the review read", () => {
    for (const prefix of ["quoteDoc", "renderQuotePdf"]) {
      const text = (
        terms: { stepId: string; value: string }[],
        l: "en" | "es",
      ) =>
        cancellationValueText(terms, {
          prefix,
          t: (k, v) => tFor(l, k, v),
          localize: (s) => localizeTermValue(s, l),
        });
      expect(text(WIZARD_TERMS, "en")).toBe("7 days' notice");
      expect(text(WIZARD_TERMS, "es")).toBe("Aviso de 7 días");
      expect(text([cancel("30 days' notice")], "en")).toBe("30 days' notice");
      expect(text([cancel("No notice period")], "es"))
        .toBe("Sin plazo de aviso");
    }
  });

  it("REQ-783 clause 10 (Termination) states the notice on the agreement — unchanged for the default", () => {
    for (const prefix of ["quoteDoc.clause", "renderQuotePdf.clause"]) {
      const legacy = prefix.startsWith("quoteDoc")
        ? DICTS.en["quoteDoc.clause.termination.body"]
        : DICTS.en["renderQuotePdf.clause.termination.body"];
      expect(termination(WIZARD_TERMS, "en", prefix)).toBe(legacy);
      expect(
        termination([...WIZARD_TERMS, cancel("14 days' notice")], "en", prefix),
      )
        .toMatch(/providing 14 days' written notice/);
      expect(termination([cancel("Aviso de 14 días")], "es", prefix))
        .toMatch(/aviso por escrito de 14 días/);
      const none = termination([cancel("No notice period")], "en", prefix);
      expect(none).not.toMatch(/7 days/);
      expect(none).toMatch(/at any time/);
    }
  });

  it("REQ-783 the review's picker offers the notice options; each option reads as the row value (en + es)", () => {
    for (const lang of ["en", "es"] as const) {
      const t = (k: string) => DICTS[lang][k];
      for (
        const [key, days] of [
          ["asstChat.terms.cancellation.sevenDays", 7],
          ["asstChat.terms.cancellation.fourteenDays", 14],
          ["asstChat.terms.cancellation.thirtyDays", 30],
        ] as const
      ) {
        expect(t(key)).toBe(
          tFor(lang, "quoteDoc.termValue.cancellationDays", { n: days }),
        );
        expect(cancellationNotice([cancel(t(key))]))
          .toEqual({ kind: "days", days });
      }
      expect(t("asstChat.terms.cancellation.none"))
        .toBe(tFor(lang, "quoteDoc.termValue.cancellationNone"));
      expect(t("asstChat.preview.termLabel.cancellation")).toBeTruthy();
    }
  });

  it("REQ-783 AsstChat wires it: the review rows carry the cancellation row, its label and its options", () => {
    const island = read("front-end/islands/AsstChat.tsx");
    expect(island).toMatch(/withCancellationRow\(/);
    expect(island).toMatch(
      /cancellation: "asstChat\.preview\.termLabel\.cancellation"/,
    );
    expect(island).toMatch(
      /cancellation: \[[\s\S]*?asstChat\.terms\.cancellation\.sevenDays[\s\S]*?asstChat\.terms\.cancellation\.none/,
    );
  });

  it("REQ-783 an invoice carries no cancellation row; a cancellation-only edit is not 'terms incomplete'", () => {
    expect(
      invoiceTerms([...WIZARD_TERMS, cancel("14 days' notice")], {})
        .map((t) => t.stepId),
    ).not.toContain(CANCELLATION_STEP_ID);
    expect(
      quoteSignRefusal({
        status: "sent",
        sentAt: "2026-11-13T10:00:00Z",
        terms: [cancel("14 days' notice")],
      }),
    ).toBeUndefined();
  });
});
