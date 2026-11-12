/**
 * REQ-542 — demo-loop cycle 4, issues m31 ("Top-bar activity pill has text on
 * stage but empty/missing for customer") and m8 ("Text cut off": the pill read
 * "Carol Henderson aceptó tu cotizaci… ahora mism").
 *
 * - The sentence slid in with `tickerSlideIn … both` from opacity 0, so a
 *   paused, throttled or restarted animation left only "● just now" on the
 *   pill. The entrance now moves the text only; it is never transparent.
 * - `.topbar__ticker-time` could not shrink (flex-shrink:0, one line) next to
 *   a 120 px track inside a 220 px pill, so "ahora mismo" was clipped at the
 *   pill's edge. It may now wrap onto the pill's second line.
 * - `overflow-wrap:anywhere` split words mid-word ("cotizaci…"); the sentence
 *   now breaks between words.
 * - The dead copy of the ticker rules in the unlinked static/assistant.css is
 *   gone, so only one ruleset exists per linked sheet.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

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

/** The body of `@keyframes name { … }` (nested braces). */
function keyframes(css: string, name: string): string {
  const start = css.indexOf(`@keyframes ${name}`);
  if (start < 0) return "";
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(start, i + 1);
  }
  return css.slice(start);
}

const decl = (body: string, prop: string) =>
  body.match(new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+);`))?.[1].trim();

const SHEETS = [
  "front-end/static/dashboard.css",
  "front-end/static/assistant-page.css",
];

describe("REQ-542 (demo cycle 4, m31 / m8): the ticker's sentence is never hidden or clipped", () => {
  for (const file of SHEETS) {
    test(`${file}: the entrance animation never makes the sentence transparent`, () => {
      const css = read(file);
      const item = blocks(css, ".topbar__ticker-item")[0];
      expect(item).toBeDefined();
      const anim = decl(item, "animation") ?? "";
      const name = anim.match(/\b(ticker\w+)/)?.[1];
      if (!name) return; // no entrance animation at all is fine
      const kf = keyframes(css, name);
      expect(kf).not.toBe("");
      // no frame sets an opacity below 1
      for (const m of kf.matchAll(/opacity\s*:\s*([\d.]+)/g)) {
        expect(Number(m[1])).toBe(1);
      }
    });

    test(`${file}: the sentence breaks between words, never mid-word`, () => {
      for (const body of blocks(read(file), ".topbar__ticker-item")) {
        expect(decl(body, "overflow-wrap")).not.toBe("anywhere");
        expect(decl(body, "word-break")).not.toBe("break-all");
        expect(decl(body, "word-break")).not.toBe("break-word");
      }
    });

    test(`${file}: the time may give way (shrink and wrap) instead of being clipped at the pill's edge`, () => {
      const found = blocks(read(file), ".topbar__ticker-time");
      expect(found.length).toBeGreaterThan(0);
      for (const body of found) {
        expect(decl(body, "flex-shrink")).not.toBe("0");
        expect(decl(body, "flex")).not.toMatch(/^(none|\S+\s+0(\s|$))/);
        expect(decl(body, "white-space")).not.toBe("nowrap");
      }
    });
  }

  test("the unlinked static/assistant.css carries no stale ticker rules", () => {
    const css = read("front-end/static/assistant.css");
    expect(css).not.toMatch(/\.topbar__ticker\b/);
    expect(css).not.toMatch(/@keyframes\s+tickerSlideIn\b/);
  });
});
