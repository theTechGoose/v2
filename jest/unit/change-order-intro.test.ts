/**
 * REQ-689 — demo-loop cycle 5, issue p5: an approved change order still
 * said "Review it below and approve to update your total."
 *
 * /co/:id rendered `changeOrderPublic.intro` for every status. The intro now
 * follows the order's status:
 *   pending  → the ask ("Review it below and approve…"), unchanged
 *   approved → "You approved this change on {date} — your total is now {total}."
 *   declined → "You declined this change."
 */
import * as fs from "fs";
import * as path from "path";
import { changeOrderIntro } from "../../shared/quote-flow/change-order-view";

const ROOT = path.resolve(__dirname, "../..");
const dict = (l: "en" | "es"): Record<string, string> =>
  JSON.parse(fs.readFileSync(path.join(ROOT, `lang/${l}.json`), "utf8"));
const money = (c: number) =>
  `$${
    (c / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }`;
/** Mirrors front-end/lib/i18n.ts tFor interpolation. */
function render(
  l: "en" | "es",
  r: { key: string; vars?: Record<string, string> },
): string {
  const tpl = dict(l)[r.key];
  if (tpl === undefined) throw new Error(`missing ${l} key ${r.key}`);
  return tpl.replace(/\{(\w+)\}/g, (_, k) => r.vars?.[k] ?? `{${k}}`);
}

const DECIDED = "2026-11-06T15:30:00.000Z";

describe("REQ-689 p5 the /co intro follows the order's status", () => {
  test("REQ-689 pending keeps the review-and-approve ask", () => {
    const r = changeOrderIntro({ status: "pending" }, "en", money);
    expect(r.key).toBe("changeOrderPublic.intro");
    expect(render("en", r)).toMatch(/Review it below and approve/);
  });

  test("REQ-689 approved says when it was approved and the new JOB total — never asks to approve", () => {
    const r = changeOrderIntro(
      {
        status: "approved",
        decidedAt: DECIDED,
        jobNewAmount: 2_005_000,
        newAmount: 1_045_000,
      },
      "en",
      money,
    );
    const en = render("en", r);
    expect(en).toBe(
      "You approved this change on Nov 6, 2026 — your total is now $20,050.00.",
    );
    expect(en).not.toMatch(/approve to update|Review it below/);
    const es = render(
      "es",
      changeOrderIntro(
        {
          status: "approved",
          decidedAt: DECIDED,
          jobNewAmount: 2_005_000,
        },
        "es",
        money,
      ),
    );
    expect(es).toContain("6 nov 2026");
    expect(es).toContain("$20,050.00");
    expect(es).not.toMatch(/apruébalo|Revísalo/);
  });

  test("REQ-689 approved with no job totals uses the invoice's new total", () => {
    const r = changeOrderIntro(
      { status: "approved", decidedAt: DECIDED, newAmount: 1_045_000 },
      "en",
      money,
    );
    expect(render("en", r)).toBe(
      "You approved this change on Nov 6, 2026 — your total is now $10,450.00.",
    );
  });

  test("REQ-689 approved with no date or total still reads as done", () => {
    for (const l of ["en", "es"] as const) {
      const out = render(l, changeOrderIntro({ status: "approved" }, l, money));
      expect(out).not.toMatch(/\{|approve to update|apruébalo/);
    }
    expect(render("en", changeOrderIntro({ status: "approved" }, "en", money)))
      .toBe("You approved this change.");
  });

  test("REQ-689 declined says it was declined", () => {
    const r = changeOrderIntro(
      { status: "declined", decidedAt: DECIDED, jobNewAmount: 2_005_000 },
      "en",
      money,
    );
    expect(render("en", r)).toBe("You declined this change.");
    expect(render("es", changeOrderIntro({ status: "declined" }, "es", money)))
      .toBe("Rechazaste este cambio.");
  });

  test("REQ-689 en and es carry the same intro keys", () => {
    const en = Object.keys(dict("en")).filter((k) =>
      k.startsWith("changeOrderPublic.intro")
    ).sort();
    const es = Object.keys(dict("es")).filter((k) =>
      k.startsWith("changeOrderPublic.intro")
    ).sort();
    expect(en.length).toBeGreaterThanOrEqual(4);
    expect(es).toEqual(en);
  });

  test("REQ-689 the /co route renders the status-chosen intro, not a fixed key", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "front-end/routes/co/[id].tsx"),
      "utf8",
    );
    expect(src).toMatch(/changeOrderIntro\(/);
    expect(src).not.toMatch(/tFor\(lang, "changeOrderPublic\.intro"\)/);
  });
});
