/**
 * REQ-514 — demo-loop cycle 3, issue p8-pair4-b: "Dashboard empty-state text
 * flush to the card edge". `.panel` has no padding (border, 20 px radius,
 * overflow hidden); the Active jobs empty block padded `18px 4px`, the Quotes
 * awaiting empty line `8px 0 14px`, so the text sat 0–4 px from the rounded
 * border. Both `.panel` empty states now use one shared `.panel__empty` class whose horizontal padding matches the
 * panel's rows (`.job` / `.quote-item`: 20 px) and is at least `.panel__head`'s.
 * (The Outstanding card is `.money`, which already pads 18px 20px itself.)
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const CSS = read("front-end/static/dashboard.css");
const TSX = read("front-end/components/DashSections.tsx");

/** The first top-level declaration block for exactly `selector`. */
function block(css: string, selector: string): string | undefined {
  const re = new RegExp(
    `(^|[}\\s])${selector.replace(/[.\-]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
    "m",
  );
  return css.match(re)?.[2];
}

/** [top, right, bottom, left] px of a `padding:` shorthand in a block. */
function padding(body: string | undefined): number[] | undefined {
  const m = body?.match(/(?:^|;|\s)padding\s*:\s*([^;]+)/);
  if (!m) return undefined;
  const v = m[1].trim().split(/\s+/).map((x) => parseFloat(x));
  const [t, r = t, b = t, l = r] = v;
  return [t, r, b, l];
}

/** The JSX element (opening tag) that renders `key`'s empty copy: the nearest enclosing <div …>. */
function emptyWrapper(key: string): string {
  const at = TSX.indexOf(`"${key}"`);
  if (at < 0) throw new Error(`no ${key} in DashSections.tsx`);
  const before = TSX.slice(0, at);
  const open = before.lastIndexOf("<div");
  return TSX.slice(open, TSX.indexOf(">", open) + 1);
}

describe("REQ-514 (demo p8-pair4-b, cycle 3): dashboard empty states are not flush to the card edge", () => {
  test("REQ-514 .panel__empty pads horizontally like the panel's rows (≥ .panel__head's, 20 px)", () => {
    const head = padding(block(CSS, ".panel__head"))!;
    const empty = padding(block(CSS, ".panel__empty"));
    expect(empty).toBeDefined();
    const [, right, , left] = empty!;
    expect(left).toBeGreaterThanOrEqual(head[3]);
    expect(right).toBeGreaterThanOrEqual(head[1]);
    expect(left).toBe(20);
    expect(right).toBe(20);
  });

  test("REQ-514 the Active jobs empty block uses .panel__empty and no inline padding", () => {
    const tag = emptyWrapper("activeJobs.empty.text");
    expect(tag).toMatch(/class="[^"]*\bpanel__empty\b/);
    expect(tag).not.toMatch(/padding\s*:/);
  });

  test("REQ-514 the Quotes awaiting empty line uses .panel__empty and no inline padding", () => {
    const at = TSX.indexOf("dashQuotesEmpty({");
    const open = TSX.slice(0, at).lastIndexOf("<div");
    const tag = TSX.slice(open, TSX.indexOf(">", open) + 1);
    expect(tag).toMatch(/class="[^"]*\bpanel__empty\b/);
    expect(tag).not.toMatch(/padding\s*:/);
  });

  test("REQ-514 no `.panel` section pads a block with 0–4 px sides inline", () => {
    // the sections whose card is the unpadded `.panel` (Outstanding is `.money`, padded itself)
    for (const fn of ["ActiveJobs", "QuotesAwaiting", "Activity"]) {
      const start = TSX.indexOf(`export function ${fn}(`);
      expect(start).toBeGreaterThanOrEqual(0);
      const next = TSX.indexOf("export function ", start + 1);
      const body = TSX.slice(start, next < 0 ? undefined : next);
      expect(body).toMatch(/class="panel"/);
      // the shapes the demo hit: `padding:18px 4px`, `padding:8px 0 14px`
      expect(body).not.toMatch(/padding:\s*\d+px [0-4](px)?[;" ]/);
    }
  });
});
