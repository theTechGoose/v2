/**
 * REQ-408 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle 2, issue p13-d: on a phone the /invoices intro paragraph sat
 * flush on top of "+ New invoice". `.qph__cta-row` had no CSS rule, the global
 * `* { margin: 0 }` zeroes the paragraph's margin, and the ghost export links
 * were spaced with inline `margin-left:10px` (which also misaligns them once
 * they wrap). The row is now a wrapping flex row with a gap and a top margin.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
/** the declarations of one top-level rule, comments dropped */
const rule = (src: string, selector: string) => {
  const css = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const i = css.indexOf(`\n${selector} {`);
  if (i < 0) return "";
  return css.slice(i, css.indexOf("}", i));
};

describe("REQ-408 p13-d the /invoices CTA row is spaced from the intro", () => {
  const css = read("front-end/static/quotes.css");
  const island = read("front-end/islands/InvoicesPage.tsx");

  test(".qph__cta-row is a wrapping flex row with a gap and a top margin", () => {
    const r = rule(css, ".qph__cta-row");
    expect(r).toMatch(/display:\s*flex/);
    expect(r).toMatch(/flex-wrap:\s*wrap/);
    expect(r).toMatch(/gap:\s*\d+px/);
    expect(r).toMatch(/margin-top:\s*(1[0-9]|[2-9]\d)px/);
  });

  test("the ghost export links carry no inline margin-left", () => {
    const row = island.slice(
      island.indexOf('<div class="qph__cta-row">'),
      island.indexOf("</div>", island.indexOf('<div class="qph__cta-row">')),
    );
    expect(row).toContain('data-cy="invoice-export-all"'); // REQ-794: all + unpaid, no year link
    expect(row).not.toMatch(/margin-left/);
  });
});
