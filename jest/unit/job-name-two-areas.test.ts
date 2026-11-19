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
