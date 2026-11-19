/**
 * REQ-1051 (LOOP-007 cycle 2, q2-35) — AMENDMENT of REQ-337: a job that
 * names two areas keeps both in its job name.
 *
 * QA 2's assistant card read "Pintura exterior y reparación de cerca —
 * Jorge Ramirez"; the SMS and /q title read "Pintura exterior" — the fence
 * dropped. The model's over-budget name was discarded whole and the
 * fallback cut the summary at 3 words ([Pintura, exterior, y] → "Pintura
 * exterior"). REQ-337 promises "a job name may cover every area named"
 * inside 5 words / 30 characters, and "Pintura exterior y cerca" fits.
 *
 * Target: shared/quote-flow/job-name.ts
 */
import {
  compactAreas,
  fitJobNameToBudget,
  isValidJobName,
  JOB_NAME_MAX_WORDS,
  summarizeJobName,
} from "../../shared/quote-flow/job-name";

const SUMMARY = "Pintura exterior y reparación de cerca — Jorge Ramirez";
const MODEL_NAME = "Pintura exterior y reparación de cerca"; // 38 chars

describe("REQ-1051 (LOOP-007 q2-35) a two-area job name keeps both areas", () => {
  it("REQ-1051: the 5-word-budget derivation of 'Pintura exterior y reparación de cerca — Jorge Ramirez' (es) is valid and still names the fence", () => {
    const name = summarizeJobName(SUMMARY, "es", {
      maxWords: JOB_NAME_MAX_WORDS,
    });
    expect(isValidJobName(name)).toBe(true);
    expect(name).toMatch(/^Pintura exterior/);
    expect(name.toLowerCase()).toContain("cerca");
  });

  it("REQ-1051: fitting the model's over-budget 'Pintura exterior y reparación de cerca' to the budget keeps the fence", () => {
    const name = fitJobNameToBudget(MODEL_NAME);
    expect(isValidJobName(name)).toBe(true);
    expect(name).toMatch(/^Pintura exterior/);
    expect(name.toLowerCase()).toContain("cerca");
  });
});

/**
 * REQ-1092 (LOOP-007 cycle 3, q3-1 + q3-2) — AMENDMENT of REQ-1051: the
 * ENGLISH derivation keeps the joiner and every area too, and an area with
 * no "de/of" object still shortens to the thing it names.
 *
 * QA 3's English summary "Exterior painting and fence staining — Maria
 * Lopez" was named "Exterior Painting Fence" (stopword "and" dropped, cut at
 * 3 significant words), which TranslateQuote rendered "Pintura exterior de
 * la cerca" for the Spanish customer. The Spanish summary "Pintura exterior
 * y tinte para cerca" lost the fence ("Pintura exterior"): compactAreas only
 * knew "de/del/of".
 */
describe("REQ-1092 (LOOP-007 q3-1, q3-2) an English two-area job name keeps 'and' and both areas", () => {
  const EN_SUMMARY = "Exterior painting and fence staining — Maria Lopez";

  it("REQ-1092 (q3-2): the default derivation of 'Exterior painting and fence staining — Maria Lopez' (en) is valid, keeps 'and' and the fence, and is never 'Exterior Painting Fence'", () => {
    const name = summarizeJobName(EN_SUMMARY, "en");
    expect(name).not.toBe("Exterior Painting Fence");
    expect(isValidJobName(name)).toBe(true);
    expect(name).toMatch(/^Exterior Painting and Fence\b/);
  });

  it("REQ-1092 (q3-2): the 5-word-budget derivation (en) keeps 'and' and the fence", () => {
    const name = summarizeJobName(EN_SUMMARY, "en", {
      maxWords: JOB_NAME_MAX_WORDS,
    });
    expect(isValidJobName(name)).toBe(true);
    expect(name).toMatch(/^Exterior Painting and Fence\b/);
  });

  it("REQ-1092 (q3-1): the Spanish 'Pintura exterior y tinte para cerca — Lupe Garza' keeps the fence (an area with 'para', not 'de')", () => {
    const name = summarizeJobName(
      "Pintura exterior y tinte para cerca — Lupe Garza",
      "es",
    );
    expect(isValidJobName(name)).toBe(true);
    expect(name).toMatch(/^Pintura exterior y /);
    expect(name.toLowerCase()).toContain("cerca");
  });

  it("REQ-1092 (q3-1): fitting the over-budget 'Exterior Painting and Fence Staining' keeps the joiner and the fence", () => {
    const name = fitJobNameToBudget("Exterior Painting and Fence Staining");
    expect(isValidJobName(name)).toBe(true);
    expect(name).toContain("and Fence");
  });

  it("REQ-1092 (q3-1): compactAreas shortens an area with no 'of' to the thing it names — 'Exterior Painting and Fence Staining' → 'Exterior Painting and Fence'", () => {
    expect(compactAreas("Exterior Painting and Fence Staining")).toBe(
      "Exterior Painting and Fence",
    );
  });
});
