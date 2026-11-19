/**
 * REQ-1159 — AMENDMENT of REQ-921/REQ-979 (LOOP-007 cycle 3, q3-91): /field/tasks
 * → Add task's Service box is the house service picker (ServiceSelect) with
 * `onCreate`, so a name that matches no service offers `+ Add "<name>" as a
 * service`, the same as New invoice, edit invoice and the repeat-visit form.
 * Before: a bare `<input list="tk-types">` over a native datalist, which shows
 * nothing for a new name. Source pin on the island (like service-lines.test.ts).
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const src = fs.readFileSync(
  path.join(ROOT, "front-end/islands/FieldTasksPage.tsx"),
  "utf8",
);

/** the JSX element (from its `<Tag` to the closing `/>` or `>`) that carries `data-cy="<cy>"` */
function elementWith(cy: string): string {
  const at = src.indexOf(`data-cy="${cy}"`);
  if (at < 0) return "";
  const open = src.lastIndexOf("<", at);
  const close = src.indexOf(">", at);
  return src.slice(open, close + 1);
}

describe("REQ-1159 (LOOP-007 q3-91) Add task's Service box", () => {
  it("REQ-1159 tk-add-type is a ServiceSelect with onCreate, not a free-text input", () => {
    const el = elementWith("tk-add-type");
    expect(el).not.toBe("");
    expect(el.startsWith("<ServiceSelect")).toBe(true);
  });

  it("REQ-1159 the Add task ServiceSelect offers to add a new service (onCreate → createTaskType)", () => {
    const at = src.indexOf(`data-cy="tk-add-type"`);
    const open = src.lastIndexOf("<ServiceSelect", at);
    expect(open).toBeGreaterThanOrEqual(0);
    // it is THIS field's picker (no other element between the tag and its data-cy)
    expect(src.slice(open + 1, at)).not.toMatch(/\n\s*<[A-Za-z]/);
    // the props of that element run until the next JSX closing "/>" at its own depth;
    // a generous window from the tag covers onPick/onCreate bodies
    const block = src.slice(open, open + 3000);
    expect(block).toMatch(/onCreate=\{/);
    expect(block).toMatch(/createTaskType\(/);
  });

  it("REQ-1159 tk-add-type no longer rides the native tk-types datalist", () => {
    expect(elementWith("tk-add-type")).not.toMatch(/list="tk-types"/);
  });
});
