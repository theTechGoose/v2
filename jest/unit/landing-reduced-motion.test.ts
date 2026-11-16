/**
 * REQ-880 — Raphael: "For some reason, the phone is shaking on the landing
 * page." With macOS Reduce Motion on, the landing's reduced-motion block cut
 * every animation to 0.01ms but left `animation-iteration-count` at the
 * element's `infinite`, so phoneFloat/docFloat/blobDrift looped ~100 000×/s and
 * every frame sampled a random phase: the hero phone jittered between
 * translateY(0) and -10px (frame-diff mean 15.2 vs 1.3 with motion on).
 *
 * The block must also pin the iteration count to 1 so a shortened animation
 * runs once and settles.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const STATIC = path.join(ROOT, "front-end/static");
const SHEETS = fs.readdirSync(STATIC).filter((f) => f.endsWith(".css"));
const readCss = (f: string) => fs.readFileSync(path.join(STATIC, f), "utf8");
const CSS = readCss("landing.css");

/** Bodies of every `@media (prefers-reduced-motion: reduce) { … }` block. */
function reducedBlocks(css: string): string[] {
  const out: string[] = [];
  const re = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
    }
    out.push(css.slice(start, i - 1));
  }
  return out;
}

describe("REQ-880 landing reduced-motion block", () => {
  const blocks = reducedBlocks(CSS);
  const shortening = blocks.filter((b) => /animation-duration\s*:/.test(b));

  it("has a reduced-motion block that shortens animations", () => {
    expect(shortening.length).toBeGreaterThan(0);
  });

  it("every block that shortens animation-duration also caps animation-iteration-count at 1 !important", () => {
    for (const b of shortening) {
      expect(b).toMatch(/animation-iteration-count\s*:\s*1\s*!important/);
    }
  });

  it("the same holds in every other static stylesheet (dashboard, assistant, assistant-page carry the same block)", () => {
    const offenders: string[] = [];
    for (const f of SHEETS) {
      for (const b of reducedBlocks(readCss(f))) {
        // the bug pattern: a blanket `*` rule shortening every animation,
        // which also catches the page's infinite loops. Targeted one-shot
        // shortenings (motion.css view transitions, paycard entrances) are fine.
        if (
          /(?:^|[,{}])\s*\*(?:::before|::after)?\s*[,{]/.test(b) &&
          /animation-duration\s*:/.test(b) &&
          !/animation-iteration-count\s*:\s*1\s*!important/.test(b)
        ) offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the hero float keyframes are still infinite with motion on (the cap lives only under reduced motion)", () => {
    const phone = CSS.match(/\.hs-phone\s*\{[^}]*\}/)?.[0] ?? "";
    expect(phone).toMatch(
      /animation:\s*phoneFloat\s+6s\s+ease-in-out\s+infinite/,
    );
  });
});
