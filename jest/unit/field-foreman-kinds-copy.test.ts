/**
 * REQ-1008 (LOOP-007 q1, q1-94) — "Foreman" names two different powers. The account-wide role
 * (REQ-138/141, `FieldWorker.role: "foreman"`: sees and closes every crew's visits) and the crew
 * lead (REQ-840, `Crew.foremanId`: acts on their own crew's visits only) must not share one word.
 * The crew keys keep "Foreman"/"Encargado"; the account-wide keys must use a different word, and
 * the Spanish checkbox must say "every crew", not "the whole crew".
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
const DICTS = { en, es };

/** the labels that name the ACCOUNT-WIDE role */
const ACCOUNT_KEYS = [
  "field.wk.foreman",
  "field.wk.foremanBadge",
  "field.asg.foremanTag",
];

describe("REQ-1008 (q1-94): the account-wide role and the crew lead have different names", () => {
  for (const lang of ["en", "es"] as const) {
    test(`REQ-1008 ${lang}: no account-wide label uses the crew lead's word (field.crew.foreman)`, () => {
      const crewWord = DICTS[lang]["field.crew.foreman"].trim().toLowerCase();
      expect(crewWord).toBeTruthy();
      const clashes = ACCOUNT_KEYS
        .filter((k) => DICTS[lang][k].toLowerCase().includes(crewWord))
        .map((k) => `${k}: ${DICTS[lang][k]}`);
      expect(clashes).toEqual([]);
    });
  }
  test("REQ-1008 es: the account-wide checkbox says every crew, not the whole crew", () => {
    expect(es["field.wk.foreman"]).not.toMatch(/toda la cuadrilla/i);
    expect(es["field.wk.foreman"]).toMatch(/todas las cuadrillas/i);
  });
});
