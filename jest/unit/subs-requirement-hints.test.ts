/**
 * REQ-1067 — LOOP-007 cycle 2, q2-55: the New / Edit repeat visit form kept
 * showing "Pick at least one day." with Thursday ticked and "Add at least one
 * task type with a price." with a task listed. Both hints were fixed
 * `<span class="hint">` text with no condition on the form state. A
 * requirement hint shows only while its requirement is unmet. The checklist
 * editor's "Add at least one task type" hint follows the same rule.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** the JSX between two markers of a file (throws when a marker is missing) */
function between(src: string, from: string, to: string): string {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(`marker not found: ${from}`);
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(`marker not found: ${to}`);
  return src.slice(a, b);
}

/**
 * The JSX expression that draws `t("<key>")`: walk back from the key to the
 * enclosing `{` that opens the expression at the hint's level (the text that
 * decides whether the hint renders at all), up to the closing `}`.
 */
function hintGuard(region: string, key: string): string {
  const at = region.indexOf(`t("${key}")`);
  if (at < 0) throw new Error(`t("${key}") not found in region`);
  // the line that opens the <span class="hint"...> holding the key
  const spanAt = region.lastIndexOf("<span", at);
  // what sits right before that span: a guard like `{!form.days.length && (`
  const before = region.slice(Math.max(0, spanAt - 200), spanAt);
  const inside = region.slice(spanAt, at + key.length + 6);
  return `${before}␞${inside}`;
}

const SUBS = read("front-end/islands/FieldSubscriptionsPage.tsx");
const CKL = read("front-end/islands/FieldChecklistsPage.tsx");

describe("REQ-1067 (LOOP-007 q2-55): requirement hints show only while unmet", () => {
  test("REQ-1067: the weekday picker's 'Pick at least one day' hint is guarded by an empty form.days", () => {
    const days = between(SUBS, 'data-cy="subs-days"', 'data-cy="subs-dom"');
    const g = hintGuard(days, "field.subs.daysHint");
    // the hint renders behind a check that no day is ticked
    expect(g).toMatch(/!\s*form\.days\.length\s*&&|form\.days\.length\s*===\s*0\s*&&/);
    // and it carries a handle the e2e story can look for
    expect(days).toMatch(/data-cy="subs-days-hint"/);
  });

  test("REQ-1067: the task-type block's 'Add at least one task type' hint is guarded by an empty form.items", () => {
    const items = between(SUBS, 'data-cy="subs-add-item"', 'data-cy="subs-error"');
    const g = hintGuard(items, "field.subs.noItems");
    expect(g).toMatch(/form\.items\.length/);
  });

  test("REQ-1067: with a task listed and no checklist, the items hint draws nothing (no unconditional noItems fallback)", () => {
    const items = between(SUBS, 'data-cy="subs-add-item"', 'data-cy="subs-error"');
    // the at-commit shape: `form.checklistId ? checklistHint : noItems` — noItems is the
    // fallback for every non-checklist state, items or not
    expect(items).not.toMatch(
      /form\.checklistId\s*\?\s*t\("field\.subs\.checklistHint"\)\s*:\s*t\("field\.subs\.noItems"\)/,
    );
  });

  test("REQ-1067: the checklist editor's 'Add at least one task type' hint is guarded by an empty form.items", () => {
    const g = hintGuard(CKL, "field.subs.noItems");
    expect(g).toMatch(/form\.items\.length/);
  });
});
