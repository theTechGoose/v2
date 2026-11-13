/**
 * REQ-735 — demo-loop cycle 5, issue p6 "Plain browser-blue links and unstyled
 * box". dashboard.css had no text-link style, so a classless <a> in the Field
 * screens rendered the browser default (rgb(0,0,238), underlined): the REQ-601
 * worker/editor share link, "Clientes" in Nueva suscripción, the Batches
 * "Add an email or phone to …" fix link, "Add a worker" on Tasks and "Open
 * tasks" on Work orders. The share box's <textarea> had no class either, so it
 * kept the UA monospace font, black text and grey inset border (the "Times-font
 * box" the testers saw; getComputedStyle on the box's own text is Inter).
 * Fix: one `.link` class in dashboard.css (brand teal, 600, offset underline)
 * on those anchors, and a `.share-text` class in field.css for the textarea.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const DASH = read("front-end/static/dashboard.css");
const FIELD = read("front-end/static/field.css");

/** The first top-level declaration block for exactly `selector`. */
function block(css: string, selector: string): string | undefined {
  const re = new RegExp(
    `(^|[}\\s])${selector.replace(/[.\-:]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
    "m",
  );
  return css.match(re)?.[2];
}

/** Opening <a …> tag (possibly multi-line) whose attributes contain `marker`. */
function anchor(file: string, marker: string): string {
  const src = read(file);
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`${marker} not in ${file}`);
  const open = src.lastIndexOf("<a", at);
  return src.slice(open, src.indexOf(">", at) + 1);
}

function textarea(file: string, cy: string): string {
  const src = read(file);
  const at = src.indexOf(`data-cy="${cy}"`);
  if (at < 0) throw new Error(`${cy} not in ${file}`);
  const open = src.lastIndexOf("<textarea", at);
  return src.slice(open, src.indexOf("/>", at) + 2);
}

const LINKS: Array<[string, string]> = [
  ["front-end/islands/FieldWorkersPage.tsx", 'data-cy="wk-share-url"'],
  ["front-end/islands/AdminsPage.tsx", 'data-cy="adm-share-url"'],
  ["front-end/islands/FieldSubscriptionsPage.tsx", 'href="/customers"'],
  ["front-end/islands/FieldBatchesPage.tsx", 'data-cy="lt-send-fix"'],
  ["front-end/islands/FieldTasksPage.tsx", 'href="/field/workers"'],
  ["front-end/islands/WorkOrdersPage.tsx", 'href="/field/tasks"'],
];

describe("REQ-735 (demo p6, cycle 5): in-text links and the share box are styled, not browser defaults", () => {
  test("REQ-735 dashboard.css has a .link rule: brand teal, bold-ish, offset underline", () => {
    const b = block(DASH, ".link");
    expect(b).toBeDefined();
    expect(b).toMatch(/color\s*:\s*var\(--brand-teal\)/);
    expect(b).toMatch(/font-weight\s*:\s*(600|700)/);
    expect(b).toMatch(/text-underline-offset\s*:/);
  });

  test.each(LINKS)(
    'REQ-735 %s link %s carries class="link"',
    (file, marker) => {
      expect(anchor(file, marker)).toMatch(/\bclass="[^"]*\blink\b[^"]*"/);
    },
  );

  test("REQ-735 field.css styles .share-text like the form fields (inherited font, border, radius)", () => {
    const b = block(FIELD, ".share-text");
    expect(b).toBeDefined();
    expect(b).toMatch(/font\s*:\s*inherit/);
    expect(b).toMatch(/border\s*:\s*1px solid var\(--border\)/);
    expect(b).toMatch(/border-radius\s*:/);
    expect(b).toMatch(/color\s*:\s*var\(--fg\)/);
  });

  test.each([
    ["front-end/islands/FieldWorkersPage.tsx", "wk-share-text"],
    ["front-end/islands/AdminsPage.tsx", "adm-share-text"],
  ])('REQ-735 %s share textarea %s carries class="share-text"', (file, cy) => {
    expect(textarea(file, cy)).toMatch(/\bclass="share-text"/);
  });
});
