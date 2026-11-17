/**
 * REQ-357 — demo-loop cycle 1, issue p5: "/customers filter chips overflow".
 * The seven filter chips on /customers must all be visible at any width and in
 * every language: the chip row wraps instead of clipping, gets a full row of its
 * own in the toolbar, and the Spanish labels stay short.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const CSS = read("front-end/static/clients.css");
const BOARD = read("front-end/islands/ClientsBoard.tsx");
const EN = JSON.parse(read("lang/en.json")) as Record<string, string>;
const ES = JSON.parse(read("lang/es.json")) as Record<string, string>;

/** every declaration block for `selector` (top-level and inside media queries) */
function blocks(css: string, selector: string): string[] {
  const out: string[] = [];
  const re = new RegExp(
    `(^|[}\\s,])${
      selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    }\\s*\\{([^}]*)\\}`,
    "g",
  );
  for (const m of css.matchAll(re)) out.push(m[2]);
  return out;
}
const decl = (css: string, selector: string) => blocks(css, selector).join(";");

const labelKeys = [
  ...BOARD.matchAll(/labelKey:\s*"(clientsBoard\.filter\.[A-Za-z]+)"/g),
]
  .map((m) => m[1]);

describe("REQ-357 /customers filter chips never overflow (demo cycle 1, p5)", () => {
  test("the board has its seven chips, each labelled in en and es", () => {
    expect(labelKeys).toHaveLength(7);
    for (const k of labelKeys) {
      expect(typeof EN[k]).toBe("string");
      expect(typeof ES[k]).toBe("string");
    }
  });

  test("the chip row wraps (flex-wrap: wrap) and may shrink below its content (min-width: 0)", () => {
    const d = decl(CSS, ".ctoolbar2__filters");
    expect(d).toMatch(/flex-wrap:\s*wrap/);
    expect(d).toMatch(/min-width:\s*0/);
  });

  test("the chip row is never a hidden horizontal scroller", () => {
    expect(decl(CSS, ".ctoolbar2__filters")).not.toMatch(/overflow-x:\s*auto/);
  });

  test("REQ-799 (amends REQ-357): the toolbar has no search box; the chip row leads the toolbar's row and wraps, so nothing squeezes it", () => {
    const d = decl(CSS, ".ctoolbar2__filters");
    expect(d).toMatch(/grid-column:\s*1\s*;/);
    expect(d).toMatch(/flex-wrap:\s*wrap/);
    expect(d).toMatch(/min-width:\s*0/);
    expect(CSS).not.toMatch(/\.ctoolbar2__search/);
  });

  test("every chip label is short (≤ 12 characters) in en and es", () => {
    for (const k of labelKeys) {
      expect({ k, en: EN[k], ok: EN[k].length <= 12 }).toEqual({
        k,
        en: EN[k],
        ok: true,
      });
      expect({ k, es: ES[k], ok: ES[k].length <= 12 }).toEqual({
        k,
        es: ES[k],
        ok: true,
      });
    }
  });
});
