/**
 * REQ-1150 — LOOP-007 cycle 3, issue q3-81 [polish/BUG_POLISH]: the empty
 * /payments hero sub-line (`paymentsPage.hero.freshSub`, rendered as-is by
 * front-end/islands/PaymentsPage.tsx when the account has no payments) mixed
 * number styles in one sentence: "ACH in two days, checks in up to 5 business
 * days" / "ACH en dos días, cheques en hasta 5 días hábiles". Every duration
 * on the page uses digits (tip.upTo5, note.transitCheck, REQ-413), so the
 * hero must too — and it keeps the REQ-413 "up to 5 business days" wording.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

const EN_WORDS =
  /\b(one|two|three|four|five|six|seven|eight|nine|ten|a week|a few)\b/i;
// "un"/"una" are left out: they are the article ("un cliente", "una factura").
const ES_WORDS =
  /(?<![\p{L}])(dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|una semana)(?![\p{L}])/iu;

describe("REQ-1150 (q3-81) the empty /payments hero writes every duration in digits", () => {
  test("REQ-1150 en paymentsPage.hero.freshSub has no spelled-out number", () => {
    const s = en["paymentsPage.hero.freshSub"];
    expect(s).toBeTruthy();
    expect(s).not.toMatch(EN_WORDS);
  });

  test("REQ-1150 es paymentsPage.hero.freshSub has no spelled-out number", () => {
    const s = es["paymentsPage.hero.freshSub"];
    expect(s).toBeTruthy();
    expect(s).not.toMatch(ES_WORDS);
  });

  test("REQ-1150 the hero keeps REQ-413's check wording, matching the tip", () => {
    expect(en["paymentsPage.hero.freshSub"]).toContain(
      en["paymentsPage.tip.upTo5"],
    );
    expect(en["paymentsPage.tip.upTo5"]).toBe("up to 5 business days");
    expect(es["paymentsPage.hero.freshSub"]).toContain(
      es["paymentsPage.tip.upTo5"],
    );
    expect(es["paymentsPage.tip.upTo5"]).toBe("hasta 5 días hábiles");
  });

  test("REQ-1150 the ACH half states a digit duration in both languages", () => {
    expect(en["paymentsPage.hero.freshSub"]).toMatch(/ACH in [^,]*\d/);
    expect(es["paymentsPage.hero.freshSub"]).toMatch(/ACH en [^,]*\d/);
  });
});
