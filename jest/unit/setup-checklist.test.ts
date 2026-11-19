/**
 * REQ-974 (LOOP-007 cycle 1, issue q1-53) — "Setup checklist shows the optional insurance item as
 * '1 thing left' with a red bar".
 *
 * The dashboard's SetupChecklist built the insurance item ("Insurance (optional but helps)") the
 * same way as the required items, so `remaining = items.filter(i => !i.done)` counted it: with
 * everything else done the heading read "Termina la configuración — falta 1 cosa" and the bar
 * stopped at 6/7 = 86%. Optional items stay on the list (REQ-227(5)) but never count as a
 * missing task: the heading count and the bar use the required items only, and with only
 * optional items open the card reads as done (`setupChecklist.heading.optionalOnly`, 100%).
 */
import * as fs from "fs";
import * as path from "path";

// loaded per test, so the wiring + dictionary checks report on their own while the helper is missing
type Summary = {
  requiredLeft: number;
  optionalLeft: number;
  pct: number;
  headingKey: string;
};
const setupChecklistSummary = (list: Fixture[]): Summary =>
  // deno-lint-ignore no-explicit-any
  (require("../../front-end/lib/setup-checklist") as any)
    .setupChecklistSummary(list);

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

type Fixture = { key: string; done: boolean; optional?: boolean };
const items = (open: string[]): Fixture[] =>
  ["name", "biz", "email", "logo", "address", "payment", "insurance"].map((
    key,
  ) => ({
    key,
    done: !open.includes(key),
    ...(key === "insurance" ? { optional: true } : {}),
  }));

describe("REQ-974 (LOOP-007 q1-53) — an optional setup item is never counted as a thing left", () => {
  test("REQ-974 every required item done, only insurance open → 0 required left, 100%, the optionalOnly heading", () => {
    const s = setupChecklistSummary(items(["insurance"]));
    expect(s.requiredLeft).toBe(0);
    expect(s.optionalLeft).toBe(1);
    expect(s.pct).toBe(100);
    expect(s.headingKey).toBe("setupChecklist.heading.optionalOnly");
  });

  test("REQ-974 logo and insurance open → 1 required left, heading.one, the bar counts required items only", () => {
    const s = setupChecklistSummary(items(["logo", "insurance"]));
    expect(s.requiredLeft).toBe(1);
    expect(s.optionalLeft).toBe(1);
    expect(s.headingKey).toBe("setupChecklist.heading.one");
    expect(s.pct).toBe(Math.round((5 / 6) * 100)); // 5 of the 6 required
  });

  test("REQ-974 two required open → heading.other; everything done → nothing left", () => {
    const two = setupChecklistSummary(items(["logo", "email"]));
    expect(two.requiredLeft).toBe(2);
    expect(two.optionalLeft).toBe(0);
    expect(two.headingKey).toBe("setupChecklist.heading.other");
    const none = setupChecklistSummary(items([]));
    expect(none.requiredLeft).toBe(0);
    expect(none.optionalLeft).toBe(0);
    expect(none.pct).toBe(100);
  });

  test("REQ-974 SetupChecklist marks insurance optional and counts through the helper", () => {
    const src = read("front-end/islands/SetupChecklist.tsx");
    expect(src).toMatch(/setupChecklistSummary\(/);
    expect(src).toMatch(
      /key:\s*"insurance"[\s\S]{0,400}?optional:\s*true/,
    );
    // the heading count no longer comes from every open item
    expect(src).not.toMatch(/remaining\.length === 1 \? "one" : "other"/);
  });

  test("REQ-974 both dictionaries carry the optional-only heading", () => {
    for (const lang of ["en", "es"]) {
      const dict = JSON.parse(read(`lang/${lang}.json`));
      expect(typeof dict["setupChecklist.heading.optionalOnly"]).toBe(
        "string",
      );
      expect(dict["setupChecklist.heading.optionalOnly"]).not.toMatch(
        /falta|thing left/,
      );
    }
  });
});
