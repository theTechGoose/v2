/**
 * REQ-383 (demo M26, demo-loop cycle 2) — "Job-options list is a 77px scroll
 * box holding 471px of content". REQ-338 bounded the picker to the chat panel
 * (`.chat__jobopts { max-height: 100% }`, `.chat__empty--picker { height:
 * 100% }`) and let the option list give (`flex: 1 1 auto; min-height: 72px;
 * overflow-y: auto`), so at 1280×720 the cards shrank to a two-bullet window.
 * The picker now takes its natural height and the chat panel scrolls; the
 * list is never an inner scroll box; the strip and Continue follow the cards in
 * flow (nothing pinned over a card); and the panel brings the picker's head
 * and first card into view once the options land (it otherwise pins to the
 * bottom on growth).
 * Source-level checks; the browser proof is e2e/confirm-strip-layout
 * ("REQ-383 M26 …").
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
/** the declarations of one rule, comments dropped (a comment may name the old value) */
const rule = (src: string, selector: string) => {
  const css = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const i = css.indexOf(`\n${selector} {`);
  if (i < 0) return "";
  return css.slice(i, css.indexOf("}", i));
};

describe("REQ-383 M26 the job-options list is not a squeezed scroll box", () => {
  const css = read("front-end/static/assistant-page.css");
  const chat = read("front-end/islands/AsstChat.tsx");

  test("the option list takes its natural height — no inner scroll, no shrinking", () => {
    const list = rule(css, ".chat__jobopts-list");
    expect(list).not.toBe("");
    expect(list).not.toMatch(/overflow-y:\s*(auto|scroll)/);
    expect(list).not.toMatch(/max-height/);
    expect(list).not.toMatch(/flex:\s*1 1 auto/);
    expect(list).toMatch(/flex:\s*0 0 auto/);
  });

  test("the picker is not bounded to the chat panel; the panel scrolls instead", () => {
    const picker = rule(css, ".chat__jobopts");
    expect(picker).not.toBe("");
    expect(picker).not.toMatch(/max-height:\s*100%/);
    // the empty-state box must not pin its height to the panel while the picker is open
    expect(rule(css, ".chat__empty--picker")).not.toMatch(
      /(^|[^-])height:\s*100%/,
    );
  });

  test("the strip and Continue follow the list in flow — nothing is pinned over a card", () => {
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const re =
      /\n([^{}]*\.chat__(?:jobopts|price-continue|confirm-details)[^{}]*)\{([^}]*)\}/g;
    for (const m of flat.matchAll(re)) {
      if (!/\.chat__jobopts/.test(m[1])) continue;
      expect(`${m[1].trim()} { ${m[2]}`).not.toMatch(
        /position:\s*(sticky|fixed)/,
      );
    }
  });

  test("the panel brings the picker's head into view once the options land", () => {
    expect(chat).toMatch(/REQ-383/);
    expect(chat).toMatch(/\.chat__jobopts/);
    expect(chat).toMatch(/function revealPicker\(/);
    expect(chat).toMatch(/return revealPicker\(scrollRef\.current\)/);
    expect(chat).toMatch(
      /useEffect\(\(\) => \{\s*if \(!jobOptionsReady\) return;/,
    );
  });
});
