/**
 * REQ-788 AMENDMENT — the overhead is a percentage OR a dollar amount: the pure rules the
 * Settings card, the subscription form, its card and the batch pull all share.
 */
import {
  overheadCentsFor,
  overheadSetting,
  overheadText,
} from "../../shared/field/overhead";

describe("REQ-788 AMENDMENT overhead setting", () => {
  test("the setting from the identity — flat by default, percent when chosen, 0 when unset", () => {
    expect(overheadSetting(null)).toEqual({ mode: "flat", cents: 0 });
    expect(overheadSetting({ fieldOverheadCents: 2500 })).toEqual({
      mode: "flat",
      cents: 2500,
    });
    expect(
      overheadSetting({
        fieldOverheadCents: 2500,
        fieldOverheadMode: "percent",
        fieldOverheadPct: 10,
      }),
    ).toEqual({ mode: "percent", pct: 10 });
    expect(overheadSetting({ fieldOverheadMode: "percent" })).toEqual({
      mode: "percent",
      pct: 0,
    });
    expect(overheadSetting({ fieldOverheadMode: "flat", fieldOverheadPct: 10 }))
      .toEqual({ mode: "flat", cents: 0 });
  });
  test("the cents for a visit: the flat amount, or the rounded share of the visit's services", () => {
    expect(overheadCentsFor({ mode: "flat", cents: 2500 }, 6500)).toBe(2500);
    expect(overheadCentsFor({ mode: "flat", cents: 2500 }, 0)).toBe(2500);
    expect(overheadCentsFor({ mode: "percent", pct: 10 }, 6500)).toBe(650);
    expect(overheadCentsFor({ mode: "percent", pct: 12.5 }, 10500)).toBe(1313); // 1312.5 → 1313
    expect(overheadCentsFor({ mode: "percent", pct: 10 }, 0)).toBe(0);
    expect(overheadCentsFor({ mode: "percent", pct: 0 }, 6500)).toBe(0);
  });
  test("the chip's text: money in flat, a percentage in percent", () => {
    expect(overheadText({ mode: "flat", cents: 2500 })).toBe("$25.00");
    expect(overheadText({ mode: "percent", pct: 10 })).toBe("10%");
    expect(overheadText({ mode: "percent", pct: 12.5 })).toBe("12.5%");
  });
});
