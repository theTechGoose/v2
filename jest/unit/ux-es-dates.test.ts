/**
 * RED (TDD) — UX-38 "English-formatted dates throughout the Spanish /c page"
 * (+ the /invoices ES hero's en-US short date).
 *
 * Live findings (ux-problems.md third pass): the ES /c page renders
 * "vigente August 18, 2026", "Fecha: August 18, 2026", the signed badge
 * "FIRMADO AUGUST 18, 2026" and the en-US signature timestamp; the ES
 * /invoices forecast hero renders "Aug 25: María Nguyen $1,850". P-28 fixed
 * the EMAIL renderer's dates — the WEB views still format en-US.
 *
 * Target: shared/quote-flow/format-helpers.ts  (EXISTS — read 2026-08-19.
 * `formatLongDate` already produces the correct ES long form; the web bug is
 * that the /c call sites never pass the lang. The missing pure-logic piece is
 * the SHORT date the /invoices hero needs — this suite EXTENDS the module.)
 *
 * ── New export contract ────────────────────────────────────────────────────
 *   export function formatShortDate(iso: string, lang: "en" | "es"): string
 *     — the ONE short month-day format for in-app compact dates:
 *         en: "Aug 25"   (month-first, TitleCase 3-letter)
 *         es: "25 ago"   (day-first, lowercase 3-letter)
 *       ES month table MUST agree with the dict family the invoice cards
 *       already use (lang/es.json "invoicesPage.month.*", consumed by
 *       front-end/islands/InvoicesPage.tsx:115-127):
 *         ene feb mar abr may jun jul ago sep oct nov dic
 *       Deterministic like formatLongDate (no Intl): a bare "YYYY-MM-DD" is
 *       read as calendar-local noon UTC so it can never slip a day; an
 *       unparseable value passes through untouched.
 *
 * Wiring sites (for the green agent — read on 2026-08-19):
 *   - /invoices hero composer: front-end/islands/InvoicesPage.tsx:101-113 —
 *     `shortDay()` calls toLocaleDateString("en-US") unconditionally (both
 *     the weekday branch at :106 and the month-day branch at :108-112), and
 *     the hero breakdown at :699-707 (data-cy="forecast-breakdown") renders
 *     it for every forecast entry. Route the month-day branch through
 *     formatShortDate(iso, lang) (the weekday branch must equally stop being
 *     en-US in ES — e.g. via the existing "date.weekday.*" dict family).
 *   - /c web view: front-end/components/contract-doc.tsx calls the
 *     lang-aware doc-parts fmtDate (front-end/components/doc-parts.tsx:267,
 *     which already delegates to formatLongDate) WITHOUT the lang argument at
 *     :268 (contractor "Fecha:" line), :333 (signed badge), :372 (the
 *     "vigente" line) and :570 (signature timestamp) — so every one of them
 *     defaults to "en". Pass the document `lang` that is already in scope.
 *     The /c route resolves that lang at front-end/routes/c/[id].tsx:17.
 *   (The rendered-page reds live in cypress/e2e/ux-c-page-i18n.cy.ts.)
 *
 * Phones: none (pure logic — no network).
 */
import {
  formatLongDate,
  formatShortDate,
} from "../../shared/quote-flow/format-helpers";

describe("UX-38 formatShortDate — the ES short date the /invoices hero must use", () => {
  it("UX-38 es renders day-first lowercase: '2026-08-25' → '25 ago' (never 'Aug 25')", () => {
    // RED today: formatShortDate is not exported by format-helpers
    // (TypeError: formatShortDate is not a function) — the intended red.
    expect(formatShortDate("2026-08-25", "es")).toBe("25 ago");
  });

  it("UX-38 en keeps the current compact form: '2026-08-25' → 'Aug 25'", () => {
    expect(formatShortDate("2026-08-25", "en")).toBe("Aug 25");
  });

  it("UX-38 every ES short month matches the dicts' invoicesPage.month.* table", () => {
    // lang/es.json invoicesPage.month.jan..dec — the table the invoice CARDS
    // already render (InvoicesPage.tsx:115-127); the hero must agree with it.
    const esMonths = [
      "ene",
      "feb",
      "mar",
      "abr",
      "may",
      "jun",
      "jul",
      "ago",
      "sep",
      "oct",
      "nov",
      "dic",
    ];
    for (let m = 1; m <= 12; m++) {
      const iso = `2026-${String(m).padStart(2, "0")}-14`;
      const out = formatShortDate(iso, "es");
      expect(out).toBe(`14 ${esMonths[m - 1]}`);
      // And never the en-US abbreviation:
      expect(out).not.toMatch(
        /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/,
      );
    }
  });

  it("UX-38 a date-only value keeps its calendar day (no timezone slip)", () => {
    expect(formatShortDate("2026-12-31", "es")).toBe("31 dic");
    expect(formatShortDate("2026-01-01", "en")).toBe("Jan 1");
  });

  it("UX-38 an unparseable value passes through untouched (formatLongDate parity)", () => {
    expect(formatShortDate("mañana", "es")).toBe("mañana");
  });
});

describe("UX-38 formatLongDate — [contract-pin, GREEN by design] the one long form the /c page must route through", () => {
  // Honesty note: these assertions PASS today. formatLongDate already emits
  // the correct forms — the UX-38 /c defect is purely that contract-doc.tsx
  // :268/:333/:372/:570 drop the lang argument, which no pure-logic test can
  // turn red. Pinned here so the green agent's rewiring has an exact target;
  // the red for the rendered page lives in cypress/e2e/ux-c-page-i18n.cy.ts.
  it("UX-38 es long form: '2026-08-18' → '18 de agosto de 2026'", () => {
    expect(formatLongDate("2026-08-18", "es")).toBe("18 de agosto de 2026");
  });

  it("UX-38 en long form: '2026-08-18' → 'August 18, 2026'", () => {
    expect(formatLongDate("2026-08-18", "en")).toBe("August 18, 2026");
  });
});
