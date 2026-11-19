/**
 * REQ-1009 — LOOP-007 cycle 1, QA issue q1-95: "Invoiced task still shows an editable price,
 * 'Mark not done' and 'Delete'". FieldTasksPage.card() sets `locked = !!x.invoiceId` and only
 * flips its controls to readOnly/disabled: the price stays a normal-looking `<input>` (same INPUT
 * style, "65.00"), the done-check keeps its "Mark not done" name and `.task__check:disabled` is not
 * dimmed, and Add service / Edit dates / Delete are still drawn. On an invoiced card: the price is
 * plain text (`tk-price-locked`), the three buttons are not rendered, and the check is dimmed and
 * named "Invoiced".
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const island = fs.readFileSync(
  path.join(ROOT, "front-end/islands/FieldTasksPage.tsx"),
  "utf8",
);
const css = fs.readFileSync(
  path.join(ROOT, "front-end/static/field.css"),
  "utf8",
);

/** the JSX of the element carrying `data-cy="<cy>"`, from its opening `<` to its first `>` */
function openTag(cy: string): string {
  const at = island.indexOf(`data-cy="${cy}"`);
  if (at < 0) throw new Error(`no data-cy="${cy}" in FieldTasksPage.tsx`);
  const start = island.lastIndexOf("<", at);
  const end = island.indexOf(">", at);
  return island.slice(start, end + 1);
}

/** the `{cond && (` guard that wraps the element carrying `data-cy="<cy>"` */
function guardOf(cy: string): string {
  const at = island.indexOf(`data-cy="${cy}"`);
  if (at < 0) throw new Error(`no data-cy="${cy}" in FieldTasksPage.tsx`);
  const tagStart = island.lastIndexOf("<", at);
  const open = island.lastIndexOf("{", tagStart);
  return island.slice(open, tagStart);
}

/** the body of card() */
function cardSrc(): string {
  const start = island.indexOf("function card(x: TaskView)");
  if (start < 0) throw new Error("no card() in FieldTasksPage.tsx");
  return island.slice(start, island.indexOf("\n  function ", start + 10));
}

describe("REQ-1009 (LOOP-007 q1-95, cycle 1) an invoiced task card on /field/tasks is visibly read-only", () => {
  test("REQ-1009: the price is plain text when locked — the tk-price input is only rendered when not locked", () => {
    const card = cardSrc();
    expect(card).toContain('data-cy="tk-price-locked"');
    // the editable input is gated on !locked, not merely readOnly
    expect(guardOf("tk-price")).toMatch(/!locked/);
    expect(openTag("tk-price")).not.toMatch(/readOnly=\{locked\}/);
  });

  test("REQ-1009: Add service, Edit dates and Delete are not rendered on an invoiced task", () => {
    for (const cy of ["tk-add-service", "tk-edit-dates", "tk-delete"]) {
      expect({ cy, guard: guardOf(cy) }).toEqual({
        cy,
        guard: expect.stringMatching(/!locked/),
      });
    }
  });

  test("REQ-1009: the done-check is named 'Invoiced' when locked, never 'Mark not done'", () => {
    const tag = openTag("tk-done");
    const label = tag.match(/aria-label=\{([\s\S]*?)\}\s*title=/)?.[1] ?? "";
    const title = tag.match(/title=\{([\s\S]*?)\}\s*disabled=/)?.[1] ?? "";
    for (const [name, expr] of [["aria-label", label], ["title", title]]) {
      expect({ name, expr }).toEqual({
        name,
        expr: expect.stringMatching(
          /locked[\s\S]*t\("field\.tk\.invoiced"\)/,
        ),
      });
    }
  });

  test("REQ-1009: field.css dims a disabled .task__check (opacity + not-allowed)", () => {
    const rule = css.match(/\.task__check:disabled\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/opacity\s*:\s*\.?\d/);
    expect(rule).toMatch(/cursor\s*:\s*not-allowed/);
  });
});
