/**
 * REQ-406 — demo-loop cycle 2, issues m15 and m47.
 *
 * m15: "'… accepted your quote' toast covers the header search box" — the
 * live-activity pill (REQ-319: up to 480 px from 1024 px, floor 220 px) and
 * `.topbar__search { flex: 1; min-width: 0 }` shrank together, so at 1280 px
 * on /assistant the pill took 480 px and the search box 129 px ("Search a
 * number, customer,"). The search box now asks for its placeholder's room
 * (flex-basis 380 px), the pill gives way first (a far larger flex-shrink),
 * and below 1250 px — where the pill's 220 px floor and the search box cannot
 * both fit beside the greeting — the pill is hidden, as it is on phones.
 *
 * m47: "Header with ☰ isn't sticky on a phone" — DashTopbar rendered
 * `<header class="topbar" style="position:relative;z-index:40">`; an inline
 * style beats dashboard.css's phone `.topbar { position: sticky }`. The
 * positioning now lives in the island's own CSS (TOPBAR_CSS): relative on a
 * desktop, sticky under the impersonation banner on a phone.
 */
import * as fs from "fs";
import * as path from "path";
import { TOPBAR_CSS } from "../../front-end/lib/topbar-css";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const squash = (s: string) => s.replace(/\s+/g, "");

/** Every declaration block for `selector` (exact) in a stylesheet. */
function blocks(css: string, selector: string): string[] {
  const out: string[] = [];
  const re = new RegExp(
    `(^|[}\\s,])${selector.replace(/[.\-]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
    "g",
  );
  for (const m of css.matchAll(re)) out.push(m[2]);
  return out;
}

/** Bodies of `@media (max-width: Npx)` blocks, by brace matching. */
function maxWidthBlocks(css: string): { max: number; body: string }[] {
  const out: { max: number; body: string }[] = [];
  const re = /@media\s*\(\s*max-width\s*:\s*(\d+)px\s*\)\s*\{/g;
  for (const m of css.matchAll(re)) {
    let depth = 0;
    let i = m.index! + m[0].length - 1;
    const start = i + 1;
    for (; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) break;
    }
    out.push({ max: Number(m[1]), body: css.slice(start, i) });
  }
  return out;
}

/** Strip every @media block, leaving only the unconditional rules. */
function baseRules(css: string): string {
  let out = css;
  for (;;) {
    const m = out.match(/@media[^{]*\{/);
    if (!m) return out;
    let depth = 0;
    let i = m.index! + m[0].length - 1;
    for (; i < out.length; i++) {
      if (out[i] === "{") depth++;
      else if (out[i] === "}" && --depth === 0) break;
    }
    out = out.slice(0, m.index!) + out.slice(i + 1);
  }
}

const SHEETS = [
  "front-end/static/dashboard.css",
  "front-end/static/assistant-page.css",
];

describe("REQ-406 m15 (cycle 2): the live-activity pill never squeezes the search box", () => {
  for (const file of SHEETS) {
    test(`${file}: every base .topbar__search asks for its placeholder's room (flex-basis ≥ 360px)`, () => {
      const found = blocks(baseRules(read(file)), ".topbar__search");
      expect(found.length).toBeGreaterThan(0);
      for (const decl of found) {
        const flex = decl.match(/(?:^|;|\s)flex\s*:\s*([^;]+);/)?.[1].trim();
        const basis = Number(flex?.match(/(\d+)px$/)?.[1] ?? 0);
        expect({ flex, basis: basis >= 360 }).toEqual({ flex, basis: true });
      }
    });

    test(`${file}: every base .topbar__ticker gives way before the search box (flex-shrink ≥ 10)`, () => {
      const found = blocks(baseRules(read(file)), ".topbar__ticker");
      expect(found.length).toBeGreaterThan(0);
      for (const decl of found) {
        const flex = decl.match(/(?:^|;|\s)flex\s*:\s*([^;]+);/)?.[1].trim();
        const shrink = Number(flex?.split(/\s+/)[1] ?? 1);
        expect({ flex, gives: shrink >= 10 }).toEqual({ flex, gives: true });
        expect(decl).not.toMatch(/(?:^|;|\s)flex-shrink\s*:\s*1\s*;/);
      }
    });
  }

  test("TOPBAR_CSS hides the pill below 1250px (REQ-726: now below 1500px), on every route that renders the bar", () => {
    const hides = maxWidthBlocks(TOPBAR_CSS).filter((b) =>
      /\.topbar__ticker\{display:none\}/.test(squash(b.body))
    );
    expect(Math.max(...hides.map((b) => b.max))).toBeGreaterThanOrEqual(1249);
  });
});

describe("REQ-406 m47 (cycle 2): the topbar is sticky on a phone", () => {
  test('DashTopbar\'s <header class="topbar"> carries no inline position (it beat the phone rule)', () => {
    const src = read("front-end/islands/DashTopbar.tsx");
    const header = src.match(/<header\s+class="topbar"[^>]*>/)?.[0] ?? "";
    expect(header).not.toBe("");
    expect(header).not.toMatch(/position/);
  });

  test("TOPBAR_CSS: relative + z-index 40 on a desktop (REQ-207's stacking), sticky under the banner on a phone", () => {
    const base = squash(baseRules(TOPBAR_CSS));
    expect(base).toMatch(/(^|\})\.topbar\{[^}]*position:relative/);
    expect(base).toMatch(/(^|\})\.topbar\{[^}]*z-index:40/);
    const phone = maxWidthBlocks(TOPBAR_CSS)
      .filter((b) => b.max <= 640)
      .map((b) => squash(b.body))
      .join("");
    expect(phone).toMatch(
      /(^|\})\.topbar\{[^}]*position:sticky;top:var\(--banner-h,0px\)/,
    );
  });
});
