/**
 * REQ-338 (demo m31, cycle 1) — the "Looks right" confirm strip overlapped
 * the option list at 1280×720: the list's height was a fixed
 * `calc(100dvh - 235px)` and the strip's echo of the typed message was
 * unbounded. The picker is now a bounded flex column (the list takes the room
 * left, `flex: 1 1 auto; min-height: 0`), and the echo is clamped to three
 * lines with a "show more" control. Source-level wiring checks; the browser
 * proof is e2e/confirm-strip-layout.
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

describe("REQ-338 the confirm strip never covers the option list", () => {
  const css = read("front-end/static/assistant-page.css");
  const chat = read("front-end/islands/AsstChat.tsx");

  test("the option list takes the room the picker leaves, not a fixed viewport budget", () => {
    const list = rule(css, ".chat__jobopts-list");
    expect(list).not.toMatch(/100dvh\s*-\s*235px/);
    // REQ-383 (M26, cycle 2) superseded the bounded column: the list keeps
    // its natural height and the chat panel scrolls (jobopts-list-height.test.ts)
    expect(list).not.toMatch(/overflow-y:\s*auto/);
    expect(chat).toMatch(/jobOptionsOpen \? " chat__empty--picker" : ""/);
  });

  test("the echo of the typed message is clamped to three lines until 'show more'", () => {
    const text = rule(css, ".chat__confirm-details-text");
    expect(text).toMatch(/-webkit-line-clamp:\s*3/);
    expect(text).toMatch(/overflow:\s*hidden/);
    expect(css).toMatch(/\.chat__confirm-details-text\.is-open\b/);
    expect(rule(css, ".chat__confirm-details-text.is-open")).toMatch(
      /-webkit-line-clamp:\s*unset|-webkit-line-clamp:\s*none/,
    );
  });

  test("the strip renders a 'show more' toggle that does not confirm", () => {
    const strip = chat.slice(
      chat.indexOf('data-cy="confirm-details"'),
      chat.indexOf(
        'class="chat__price-continue"',
        chat.indexOf('data-cy="confirm-details"'),
      ),
    );
    expect(strip).toMatch(/data-cy="confirm-details-more"/);
    expect(strip).toMatch(/e\.stopPropagation\(\)/);
    expect(strip).toMatch(/"asstChat\.confirmDetails\.showMore"/);
    expect(strip).toMatch(/"asstChat\.confirmDetails\.showLess"/);
  });

  test("both languages carry the show more / show less labels", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    for (
      const k of [
        "asstChat.confirmDetails.showMore",
        "asstChat.confirmDetails.showLess",
      ]
    ) {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
      expect(es[k]).not.toBe(en[k]);
    }
  });
});
