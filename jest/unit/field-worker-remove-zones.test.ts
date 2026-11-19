/**
 * REQ-1015 (LOOP-007 q1, q1-101) — "Remove access confirm comes before the refusal".
 *
 * RCA: FieldWorkersPage's wk-delete button always ran `setRowErr(null); setConfirmId(w.id)`,
 * so the owner confirmed "Remove {name}'s access?" and only then learned from DELETE's 409
 * worker_covers_zones that it could not be done — though the row already knows the zones the
 * worker covers (`mine`, drawn as the "Covers" chips). The button must check `mine` first and
 * show the field.wk.err.coversZones refusal without the confirm step. Browser proof:
 * e2e/field-worker-errors/field-worker-errors.e2e.test.ts ("REQ-1015 …").
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const src = fs.readFileSync(
  path.join(ROOT, "front-end/islands/FieldWorkersPage.tsx"),
  "utf8",
);

/** the JSX of the <button data-cy="wk-delete"> element (its own attributes, incl. onClick) */
function wkDeleteButton(): string {
  const at = src.indexOf('data-cy="wk-delete"');
  expect(at).toBeGreaterThan(-1);
  const start = src.lastIndexOf("<button", at);
  const end = src.indexOf("</button>", at);
  const btn = src.slice(start, end);
  // a handler pulled out of the JSX (`onClick={() => askRemove(w, mine)}`) counts as the button's
  const named = btn.match(/onClick=\{\s*\(\)\s*=>\s*(\w+)\(/);
  if (named) {
    const fn = src.search(new RegExp(`(function\\s+${named[1]}\\b|const\\s+${named[1]}\\s*=)`));
    if (fn > -1) return btn + src.slice(fn, src.indexOf("\n  }\n", fn));
  }
  return btn;
}

describe("REQ-1015 (LOOP-007 q1-101) Remove access refuses before the confirm step when the worker covers zones", () => {
  test("the wk-delete onClick checks the zones the worker covers (`mine`) before opening the confirm step", () => {
    const btn = wkDeleteButton();
    expect(btn).toMatch(/setConfirmId\(/);
    expect(btn).toMatch(/\bmine\b|\.workerId\s*===/);
  });

  test("a worker with zones gets the coversZones refusal on the row, not setConfirmId", () => {
    const btn = wkDeleteButton();
    expect(btn).toMatch(/setRowErr\(\s*\{/);
    expect(btn).toMatch(/worker_covers_zones|coversZones/);
    expect(btn).not.toMatch(/setRowErr\(null\);\s*setConfirmId\(w\.id\);/);
  });
});
