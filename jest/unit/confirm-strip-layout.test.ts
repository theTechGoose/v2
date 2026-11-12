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
    expect(list).toMatch(/flex:\s*1 1 auto/);
    expect(list).toMatch(/overflow-y:\s*auto/);
    // a floor, so an opened echo cannot squeeze the cards out of sight
    expect(list).toMatch(/min-height:\s*(6\d|[7-9]\d|1\d\d)px/);
    // the picker itself is the bounded column: it fills the panel at most,
    // and the empty-state box gives it a definite height while it is open
    const picker = rule(css, ".chat__jobopts");
    expect(picker).toMatch(/max-height:\s*100%/);
    expect(picker).toMatch(/min-height:\s*0/);
    expect(rule(css, ".chat__empty--picker")).toMatch(/height:\s*100%/);
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
