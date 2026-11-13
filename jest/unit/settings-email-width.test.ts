/**
 * REQ-512 — demo-loop cycle 3, issue p8-pair1-f: "Email shown truncated in Settings". The
 * EditCard grid is `repeat(auto-fit, minmax(180px, 1fr))`; business name and website span the
 * full row (`grid-column:1 / -1`), but name and email each sat in one ~180-220 px track, so a
 * 24-character email ("maria@castropainting.com") overflowed and clipped
 * ("maria@castropainting.cor"). Every field of the EditCard spans the full row.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const src = fs.readFileSync(
  path.join(ROOT, "front-end/islands/SettingsPage.tsx"),
  "utf8",
);

/** The <label …> opening tag that wraps the input whose aria-label is `aria`. */
function labelTagFor(aria: string): string {
  const at = src.indexOf(`aria-label={t.${aria}}`);
  if (at < 0) throw new Error(`no input with aria-label t.${aria}`);
  const open = src.lastIndexOf("<label", at);
  return src.slice(open, src.indexOf(">", open) + 1);
}

const spansRow = (tag: string) => /grid-column:\s*1\s*\/\s*-1/.test(tag);

describe("REQ-512 (demo cycle 3, p8-pair1-f): the Settings email field is not squeezed into a narrow grid track", () => {
  test("REQ-512 the email label spans the full row (grid-column:1 / -1)", () => {
    expect(spansRow(labelTagFor("ariaEditEmail"))).toBe(true);
  });

  test("REQ-512 the name label spans the full row too, so no field sits alone in one narrow track", () => {
    expect(spansRow(labelTagFor("ariaEditName"))).toBe(true);
  });

  test("REQ-512 business name and website keep spanning the full row", () => {
    expect(spansRow(labelTagFor("ariaEditBusinessName"))).toBe(true);
    expect(spansRow(labelTagFor("ariaEditWebsite"))).toBe(true);
  });
});
