/**
 * REQ-611 — demo-loop cycle 4, demo issue p4-p8a: "Day-stepper buttons named 'Day 2026-11-12
 * Today' and '+1'". islands/FieldTasksPage.tsx wrapped the whole day stepper (prev chevron, date
 * input, next chevron, Today) in ONE `<label class="field">Day …</label>`. A label names its first
 * labelable descendant — the prev chevron button — so a screen reader heard "Day 2026-11-12 Today";
 * the next chevron was icon-only with `title="+1"`. Now: the stepper is a
 * `<div role="group" aria-labelledby>`, a `<label for>` names only the date input, and the chevrons
 * carry aria-labels `field.tk.prevDay` / `field.tk.nextDay` ("Previous day" / "Next day").
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const island = fs.readFileSync(
  path.join(ROOT, "front-end/islands/FieldTasksPage.tsx"),
  "utf8",
);
const en = JSON.parse(fs.readFileSync(path.join(ROOT, "lang/en.json"), "utf8"));
const es = JSON.parse(fs.readFileSync(path.join(ROOT, "lang/es.json"), "utf8"));

/** the JSX of the element carrying `data-cy="<cy>"`, from its opening `<` to its first `>` */
function openTag(cy: string): string {
  const at = island.indexOf(`data-cy="${cy}"`);
  if (at < 0) throw new Error(`no data-cy="${cy}" in FieldTasksPage.tsx`);
  const start = island.lastIndexOf("<", at);
  const end = island.indexOf(">", at);
  return island.slice(start, end + 1);
}

/** the source between the stepper's group open and the date input, plus a little after */
function stepper(): string {
  const prev = island.indexOf('data-cy="tk-prev"');
  return island.slice(
    island.lastIndexOf("<FieldHead", prev),
    island.indexOf("</FieldHead>", prev),
  );
}

describe("REQ-611 (demo p4-p8a, cycle 4) the /field/tasks day stepper has real names", () => {
  test("the chevrons are named Previous day / Next day from the dictionary", () => {
    expect(openTag("tk-prev")).toContain('aria-label={t("field.tk.prevDay")}');
    expect(openTag("tk-next")).toContain('aria-label={t("field.tk.nextDay")}');
    expect(openTag("tk-prev")).not.toContain('title="−1"');
    expect(openTag("tk-next")).not.toContain('title="+1"');
  });

  test("the keys exist in en and es", () => {
    expect([en["field.tk.prevDay"], en["field.tk.nextDay"]]).toEqual([
      "Previous day",
      "Next day",
    ]);
    expect([es["field.tk.prevDay"], es["field.tk.nextDay"]]).toEqual([
      "Día anterior",
      "Día siguiente",
    ]);
  });

  test("no <label> wraps the buttons: a role=group names the stepper, a label[for] names the input", () => {
    const s = stepper();
    // the old wrapper: a <label class="field"> whose body holds the prev chevron
    expect(s).not.toMatch(
      /<label[^>]*class="field"[^>]*>\s*\{t\("field\.tk\.date"\)\}\s*<span/,
    );
    expect(s).toMatch(/<div[^>]*role="group"[^>]*aria-labelledby=/);
    const input = openTag("tk-date");
    const id = /id="([^"]+)"/.exec(input)?.[1];
    expect(id).toBeTruthy();
    expect(s).toContain(`for="${id}"`);
    // the label element is closed before the prev chevron starts
    const labelOpen = s.indexOf(`for="${id}"`);
    const labelClose = s.indexOf("</label>", labelOpen);
    expect(labelClose).toBeGreaterThan(0);
    expect(labelClose).toBeLessThan(s.indexOf('data-cy="tk-prev"'));
  });
});
