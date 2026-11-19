/**
 * REQ-1013 (LOOP-007 cycle 1, q1-100) — the Annual cadence hint under the
 * month calendar said "One visit a year, on the day(s) you pick", while the
 * calendar takes several days and the scheduler (REQ-787 isDue) makes one
 * visit for each picked day. The copy must say what the scheduler does.
 */
import * as fs from "fs";
import * as path from "path";

const root = path.resolve(__dirname, "../..");
const dict = (l: string) =>
  JSON.parse(fs.readFileSync(path.join(root, `lang/${l}.json`), "utf8"));

describe("REQ-1013 q1-100: Annual hint matches the multi-day picker", () => {
  test("REQ-1013: en field.subs.annualHint does not promise a single visit and says each picked day", () => {
    const hint: string = dict("en")["field.subs.annualHint"];
    expect(hint).toBeTruthy();
    expect(hint).not.toMatch(/\bone visit\b/i);
    expect(hint).toMatch(/\beach day\b/i);
    expect(hint).toMatch(/every year/i);
  });

  test("REQ-1013: es field.subs.annualHint does not promise a single visit and says each picked day", () => {
    const hint: string = dict("es")["field.subs.annualHint"];
    expect(hint).toBeTruthy();
    expect(hint).not.toMatch(/\buna visita\b/i);
    expect(hint).toMatch(/cada d[ií]a/i);
    expect(hint).toMatch(/cada año/i);
  });
});
