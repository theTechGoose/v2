/**
 * REQ-195 — the motion system: one stylesheet on every page (page transitions through the View
 * Transitions API, staggered entrances, press feedback, a reduced-motion fallback that keeps the
 * fades) and a parser-blocking head script that tags each transition with its direction.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-195 the motion system", () => {
  const css = read("front-end/static/motion.css");
  const app = read("front-end/routes/_app.tsx");
  test("motion.css opts every page into cross-document view transitions, forward and back", () => {
    expect(css).toMatch(/@view-transition\s*\{\s*navigation:\s*auto;/);
    expect(css).toMatch(/::view-transition-new\(root\)/);
    expect(css).toMatch(
      /html:active-view-transition-type\(back\)::view-transition-new\(root\)/,
    );
    expect(css).toMatch(/\.sb\s*\{\s*view-transition-name:\s*pm-rail;/);
  });
  test("tokens follow the research: ease-out default, nothing over ~300 ms, exits faster", () => {
    expect(css).toMatch(/--pm-dur-fast:\s*120ms/);
    expect(css).toMatch(/--pm-dur-base:\s*200ms/);
    expect(css).toMatch(/--pm-dur-slow:\s*320ms/);
    expect(css).toMatch(
      /::view-transition-old\(root\)\s*\{\s*animation:\s*vt-fade-out var\(--pm-dur-fast\)/,
    );
  });
  test("entrances stagger, press feedback scales to .97, reduced motion keeps a fade", () => {
    expect(css).toMatch(
      /\[data-stagger\] > \*,\s*main\.main > \*\s*\{\s*animation:\s*pm-rise/,
    );
    expect(css).toMatch(/animation-delay:\s*calc\(var\(--i, 0\) \* 40ms\)/);
    expect(css).toMatch(/:active[^{]*\{\s*transform:\s*scale\(0\.97\)/);
    const reduced = css.slice(
      css.indexOf("@media (prefers-reduced-motion: reduce)"),
    );
    expect(reduced).toMatch(/vt-fade-in var\(--pm-dur-fast\) linear both/);
    expect(reduced).toMatch(/transform:\s*none/);
  });
  test("_app.tsx links the stylesheet and tags the direction from a classic head script", () => {
    expect(app).toMatch(
      /<link rel="stylesheet" href=\{asset\("\/motion\.css"\)\} \/>/,
    );
    expect(app).toMatch(/const MOTION_SCRIPT = `\(function\(\)\{try\{/);
    expect(app).toMatch(/addEventListener\("pagereveal"/);
    expect(app).toMatch(/vt\.types\.add\("back"\)/);
    expect(app).toMatch(/vt\.types\.add\("same"\)/);
    expect(app).toMatch(/__html: MOTION_SCRIPT/);
  });

  // REQ-807 (hotfix, 2026-11-13): a finished entrance must leave NO transform behind — `.content`
  // is `main.main > *`, and a transformed pane is the containing block for every position:fixed
  // overlay inside it (the client sheet opened ~5000 px above the viewport). `backwards` holds the
  // from-state through the delay and applies nothing once the animation ends; `both`/`forwards` do.
  test("REQ-807: every pm-rise entrance fills backwards, never both or forwards", () => {
    const rises = [...css.matchAll(/animation:\s*pm-rise[^;]*;/g)].map((m) =>
      m[0]
    );
    expect(rises.length).toBeGreaterThanOrEqual(2);
    for (const r of rises) {
      expect(r).toMatch(/\bbackwards\b/);
      expect(r).not.toMatch(/\b(both|forwards)\b/);
    }
  });
});
