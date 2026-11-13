/**
 * REQ-809 — focusing a field never drags the page to its submit button on a desktop: the
 * MobileViewport keyboard-reveal only corrects while the on-screen keyboard overlaps the
 * viewport; and the new-invoice client box is not wrapped in a <label>, so clicking a row
 * does not re-focus the box and reopen the list.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-809 focus keeps the modal in place; a pick closes the list", () => {
  test("MobileViewport's reveal is gated on the keyboard overlapping the viewport", () => {
    const src = read("front-end/islands/MobileViewport.tsx");
    expect(src).toMatch(
      /const keyboardOpen = \(\) =>\s*globalThis\.innerHeight - vv\.height > 2/,
    );
    expect(src).toMatch(
      /const correct = \(\) => \{\s*\/\/[^\n]*\n\s*if \(!keyboardOpen\(\)\) return;/,
    );
  });

  test("the new-invoice client box is not inside a <label>", () => {
    const src = read("front-end/islands/InvoicesPage.tsx");
    expect(src).not.toMatch(
      /<label style=\{labelStyle\}>\s*\{tFor\(lang, "invoicesPage\.new\.client"\)\}/,
    );
    expect(src).toMatch(
      /<div style=\{labelStyle\}>\s*<span>\{tFor\(lang, "invoicesPage\.new\.client"\)\}<\/span>\s*<div data-cy="new-invoice-client"/,
    );
  });
});
