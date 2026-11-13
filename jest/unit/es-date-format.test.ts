/**
 * REQ-495 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 3 (run re05e1cbb), issue m17 "US or raw dates in the
 * Spanish UI": the wizard's start date was stored and shown as "12/01/2026"
 * (MM/DD/YYYY), which a Spanish reader reads as 12 January.
 *
 * The start term is now stored as ISO and every reader formats it in its own
 * language with the shared `formatTermDate` (legacy MM/DD/YYYY still parses).
 */
const helpers = require("../../shared/quote-flow/format-helpers");
const facts = require("../../shared/quote-flow/quote-facts");

const TODAY = new Date(2026, 10, 12); // Thu Nov 12 2026

describe("REQ-495 m17 formatTermDate — a stored date term in the reader's language", () => {
  test("ISO reads '1 dic 2026' in Spanish and 'Dec 1, 2026' in English", () => {
    expect(helpers.formatTermDate("2026-12-01", "es")).toBe("1 dic 2026");
    expect(helpers.formatTermDate("2026-12-01", "en")).toBe("Dec 1, 2026");
  });
  test("a legacy MM/DD/YYYY value still parses", () => {
    expect(helpers.formatTermDate("12/01/2026", "es")).toBe("1 dic 2026");
    expect(helpers.formatTermDate("1/5/2027", "es")).toBe("5 ene 2027");
    expect(helpers.termDateIso("12/01/2026")).toBe("2026-12-01");
  });
  test("anything that is not a calendar day passes through untouched", () => {
    for (
      const v of [
        "Next week",
        "3 weeks",
        "50/50",
        "13/45/2026",
        "2026-02-30",
        "",
      ]
    ) {
      expect(helpers.formatTermDate(v, "es")).toBe(v);
      expect(helpers.termDateIso(v)).toBeNull();
    }
  });
});

describe("REQ-495 m17 the typed start date pre-fills the wizard as ISO", () => {
  test("'start Dec 1' → customValue '2026-12-01' (no MM/DD/YYYY)", () => {
    const f = facts.extractQuoteFacts(
      "Quote for Maria Lopez, start Dec 1",
      TODAY,
    );
    expect(facts.wizardPrefillFor("start_date", f)).toEqual({
      optionId: "custom",
      customValue: "2026-12-01",
    });
  });
});
