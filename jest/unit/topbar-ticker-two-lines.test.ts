/**
 * REQ-476 — demo-loop cycle 3, issues p8-pair9-a ("Truncated chip
 * 'Cotización enviada a t…'") and p8-pair10-c ("Truncated 'Quote sent to
 * your…'").
 *
 * At 1280 px the live-activity pill gives way first (REQ-406) and lands near
 * its 220 px floor, where a one-line track holds ~120 px of text: "Quote sent
 * to your client" (145 px) and "Cotización enviada a María García" (204 px)
 * were cut off. The search box has only ~8 px to spare there, so the pill
 * cannot simply take more width. Instead the sentence may wrap onto a second
 * line inside the 36 px pill (two lines of 14 px), with an ellipsis only past
 * the second line, and the whole pill carries the full sentence as its hover
 * title.
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

const decl = (body: string, prop: string) =>
  body.match(new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+);`))?.[1].trim();

const px = (v: string | undefined) => Number(v?.match(/^([\d.]+)px$/)?.[1]);

const SHEETS = [
  "front-end/static/dashboard.css",
  "front-end/static/assistant-page.css",
];

describe("REQ-476 (demo cycle 3, p8-pair9-a / p8-pair10-c): the ticker's sentence wraps to two lines instead of being cut off", () => {
  for (const file of SHEETS) {
    test(`${file}: .topbar__ticker-item wraps (no nowrap) and clamps at two lines`, () => {
      const found = blocks(read(file), ".topbar__ticker-item");
      expect(found.length).toBeGreaterThan(0);
      for (const body of found) {
        expect(decl(body, "white-space")).not.toBe("nowrap");
        expect(decl(body, "-webkit-line-clamp")).toBe("2");
      }
    });

    test(`${file}: the track is tall enough for two lines and both fit the 36 px pill`, () => {
      const item = blocks(read(file), ".topbar__ticker-item")[0];
      const line = px(decl(item, "line-height"));
      const track = blocks(read(file), ".topbar__ticker-track")[0];
      const fixed = px(decl(track, "height"));
      const max = px(decl(track, "max-height"));
      // No fixed one-line height; room for two lines.
      expect(Number.isNaN(fixed) ? "auto" : fixed).toBe("auto");
      expect(max).toBeGreaterThanOrEqual(2 * line);
      const pill = blocks(read(file), ".topbar__ticker")[0];
      expect(2 * line).toBeLessThanOrEqual(px(decl(pill, "height")) - 2);
    });
  }

  test("the whole pill's hover title carries the full sentence (not only the text span)", () => {
    const src = read("front-end/islands/DashTopbar.tsx");
    const anchor =
      src.match(/<a\s+href="\/dashboard#activity"[\s\S]*?>\s*<span/)
        ?.[0] ?? "";
    expect(anchor).not.toBe("");
    expect(anchor).toMatch(/\stitle=\{[\s\S]*tickerPlainText\(/);
  });
});
