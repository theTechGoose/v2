/**
 * REQ-1145 — AMENDMENT of REQ-1004 (LOOP-007 cycle 3, q3-76): the New repeat visit
 * form's "Ends on" date shows its own inline error the moment it is before First visit
 * (and when First visit moves past it), next to the field like the address error — not
 * only as the shared bottom `subs-error` alert after Save, behind every earlier check.
 *
 * The rule is a pure helper, `endDateError(start, end)` in
 * front-end/lib/field-subs-end-date.ts, returning the lang key or null.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const island = fs.readFileSync(
  path.join(ROOT, "front-end/islands/FieldSubscriptionsPage.tsx"),
  "utf8",
);

type Helper = { endDateError: (start: string, end: string) => string | null };
const loadHelper = (): Helper =>
  require("../../front-end/lib/field-subs-end-date") as Helper;

describe("REQ-1145 (LOOP-007 q3, q3-76) — Ends on before First visit is flagged inline", () => {
  test("REQ-1145: endDateError — an end before the start answers field.subs.endBeforeStart", () => {
    const { endDateError } = loadHelper();
    expect(endDateError("2026-11-19", "2026-11-01")).toBe(
      "field.subs.endBeforeStart",
    );
  });

  test("REQ-1145: endDateError — the same day or later, and a blank end, answer null", () => {
    const { endDateError } = loadHelper();
    expect(endDateError("2026-11-19", "2026-11-19")).toBeNull();
    expect(endDateError("2026-11-19", "2026-12-31")).toBeNull();
    expect(endDateError("2026-11-19", "")).toBeNull();
  });

  test("REQ-1145: the island renders an inline subs-end-error tied to the Ends on input", () => {
    expect(island).toContain('data-cy="subs-end-error"');
    expect(island).toContain('id="subs-end-error"');
    // the input points at it, as the address field does (REQ-1004 + address pattern)
    const endInput = island.slice(
      island.indexOf('data-cy="subs-end"'),
      island.indexOf('data-cy="subs-end-text"'),
    );
    expect(endInput).toMatch(/aria-invalid=/);
    expect(endInput).toMatch(/subs-end-error/);
  });

  test("REQ-1145: the island uses the shared endDateError helper (so onChange and First visit re-check it)", () => {
    expect(island).toMatch(/endDateError\s*\(/);
  });
});
