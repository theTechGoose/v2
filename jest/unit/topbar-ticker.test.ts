/**
 * REQ-273 — demo issue i18n-formatting-m10: the topbar's live-activity pill
 * read "● hace 1m" for two minutes straight and showed no event text on
 * /assistant. Cause (RCA i18n-m10): DashTopbar's fmtAgo clamped every age to
 * at least one minute (0-119 s all read "1m"), and the ticker's text track had
 * min-width:0 inside a shrinking pill, so on the crowded assistant topbar it
 * collapsed to nothing and only the dot and the time were left.
 */
import * as fs from "fs";
import * as path from "path";
import { tickerAge } from "../../front-end/lib/ticker-age";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

const NOW = Date.parse("2026-11-11T20:57:51Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("REQ-273 ticker age (demo i18n-formatting-m10)", () => {
  test("an event under a minute old is 'just now', not '1m'", () => {
    for (const s of [0, 1, 30, 59]) {
      expect(tickerAge(ago(s * 1000), NOW)).toEqual({
        key: "dashTopbar.justNow",
      });
    }
  });

  test("whole minutes count up from 1m — 60 s is 1m, 120 s is 2m", () => {
    const time = (ms: number) => tickerAge(ago(ms), NOW);
    expect(time(60_000)).toEqual({ key: "dashTopbar.timeAgo", time: "1m" });
    expect(time(119_000)).toEqual({ key: "dashTopbar.timeAgo", time: "1m" });
    expect(time(120_000)).toEqual({ key: "dashTopbar.timeAgo", time: "2m" });
    expect(time(59 * 60_000)).toEqual({
      key: "dashTopbar.timeAgo",
      time: "59m",
    });
    expect(time(60 * 60_000)).toEqual({
      key: "dashTopbar.timeAgo",
      time: "1h",
    });
    expect(time(24 * 3_600_000)).toEqual({
      key: "dashTopbar.timeAgo",
      time: "1d",
    });
  });

  test("the same event read later counts up (it is not frozen at its first value)", () => {
    const iso = ago(30_000);
    expect(tickerAge(iso, NOW)).toEqual({ key: "dashTopbar.justNow" });
    expect(tickerAge(iso, NOW + 61_000)).toEqual({
      key: "dashTopbar.timeAgo",
      time: "1m",
    });
    expect(tickerAge(iso, NOW + 151_000)).toEqual({
      key: "dashTopbar.timeAgo",
      time: "3m",
    });
  });

  test("a timestamp slightly in the future (clock skew) reads 'just now'; a bad one reads nothing", () => {
    expect(tickerAge(new Date(NOW + 5_000).toISOString(), NOW)).toEqual({
      key: "dashTopbar.justNow",
    });
    expect(tickerAge("not a date", NOW)).toBeNull();
  });

  test("both languages carry the 'just now' wording", () => {
    expect(en["dashTopbar.justNow"]).toBe("just now");
    expect(es["dashTopbar.justNow"]).toBe("ahora mismo");
  });

  test("DashTopbar renders the ticker time through tickerAge (no private clamp left)", () => {
    const src = read("front-end/islands/DashTopbar.tsx");
    expect(src).toMatch(/from "\.\.\/lib\/ticker-age\.ts"/);
    expect(src).not.toMatch(/Math\.max\(1,/);
  });
});

/** Every declaration block for `selector` in a stylesheet, in source order. */
function blocks(css: string, selector: string): string[] {
  const out: string[] = [];
  const re = new RegExp(
    `(^|[}\\s,])${selector.replace(/[.\-]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
    "g",
  );
  for (const m of css.matchAll(re)) out.push(m[2]);
  return out;
}
const px = (decl: string, prop: string): number | null => {
  const m = decl.match(new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([0-9.]+)px`));
  return m ? Number(m[1]) : null;
};

describe("REQ-273 the ticker keeps its event text (demo i18n-formatting-m10)", () => {
  for (
    const file of [
      "front-end/static/dashboard.css",
      "front-end/static/assistant-page.css",
    ]
  ) {
    test(`${file}: the text track never collapses below a readable width`, () => {
      const css = read(file);
      const tracks = blocks(css, ".topbar__ticker-track");
      expect(tracks.length).toBeGreaterThan(0);
      for (const decl of tracks) {
        expect(px(decl, "min-width") ?? 0).toBeGreaterThanOrEqual(100);
      }
      // The pill itself must not be allowed to shrink below its content
      // (an overflow:hidden flex item's auto min-width is 0).
      for (const decl of blocks(css, ".topbar__ticker")) {
        expect(decl).not.toMatch(/(^|;|\s)min-width\s*:\s*0\s*;/);
      }
    });
  }

  test("assistant-page.css hides the ticker on phones, as dashboard.css does", () => {
    const css = read("front-end/static/assistant-page.css");
    // The body of each `@media (max-width: 640px)` block, by brace matching.
    const phone = [...css.matchAll(/@media \(max-width: 640px\) \{/g)].map(
      (m) => {
        let depth = 0;
        let i = m.index! + m[0].length - 1;
        const start = i;
        for (; i < css.length; i++) {
          if (css[i] === "{") depth++;
          else if (css[i] === "}" && --depth === 0) break;
        }
        return css.slice(start, i);
      },
    );
    expect(
      phone.some((chunk) =>
        /\.topbar__ticker\s*\{\s*display:\s*none;?\s*\}/.test(chunk)
      ),
    ).toBe(true);
  });
});
