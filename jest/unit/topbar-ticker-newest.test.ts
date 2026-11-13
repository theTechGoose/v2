/**
 * REQ-319 — demo-loop cycle 1, issue m12: the topbar's live-activity pill went
 * backwards ("John Miller accepted · just now" → "Quote sent … 3m ago"), was
 * stale for up to a poll, and was cut off ("Quote sent to your c…"). Cause
 * (RCA m12): DashTopbar rotated through the last 10 notifications every 3.8 s
 * by array position, polled only every 10 s, and the pill was capped at 280 px
 * with an ellipsis at every width.
 */
import * as fs from "fs";
import * as path from "path";
import {
  MUTATION_EVENT,
  newestNotification,
  tickerPlainText,
} from "../../front-end/lib/ticker-pick";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const at = (iso: string, id: string, title = id) => ({
  id,
  title,
  createdAt: iso,
});

describe("REQ-319 the ticker shows only the newest event (demo m12)", () => {
  test("the newest event by createdAt wins, whatever its position in the list", () => {
    const older = at("2026-11-12T05:30:00Z", "quote-sent", "Quote sent");
    const newest = at("2026-11-12T05:38:00Z", "accepted", "John accepted");
    const mid = at("2026-11-12T05:35:00Z", "viewed", "Quote viewed");
    expect(newestNotification([older, newest, mid])).toBe(newest);
    expect(newestNotification([newest, mid, older])).toBe(newest);
    expect(newestNotification([older])).toBe(older);
  });

  test("no events → null; an unparsable date never wins; a tie keeps the first (feed order)", () => {
    expect(newestNotification([])).toBeNull();
    const bad = at("not a date", "bad");
    const good = at("2026-11-12T05:30:00Z", "good");
    expect(newestNotification([bad, good])).toBe(good);
    const a = at("2026-11-12T05:30:00Z", "a");
    const b = at("2026-11-12T05:30:00Z", "b");
    expect(newestNotification([a, b])).toBe(a);
  });

  test("the hover title is the event's plain words (markup stripped, entities decoded)", () => {
    expect(
      tickerPlainText("<strong>John Miller</strong> accepted quote Q-1042"),
    ).toBe("John Miller accepted quote Q-1042");
    expect(tickerPlainText("Quote sent to <em>M&amp;M</em>  Cafe")).toBe(
      "Quote sent to M&M Cafe",
    );
  });

  test("DashTopbar renders the newest event, never a rotation by index, and re-fetches on a mutation", () => {
    const src = read("front-end/islands/DashTopbar.tsx");
    expect(src).toMatch(/from "\.\.\/lib\/ticker-pick\.ts"/);
    // REQ-726 (cycle 5, m6): freshTickerItem is newestNotification + a lifetime
    expect(src).toMatch(/(newestNotification|freshTickerItem)\(/);
    expect(src).not.toMatch(/% liveItems\.length|tickerIdx/);
    expect(src).toMatch(/addEventListener\(MUTATION_EVENT/);
    // the full sentence on hover
    expect(src).toMatch(/title=\{tickerPlainText\(/);
  });

  test("a successful client-side mutation through lib/api dispatches the mutation event", () => {
    const src = read("front-end/lib/api.ts");
    expect(MUTATION_EVENT).toBe("pm:mutated");
    expect(src).toMatch(/from "\.\/ticker-pick\.ts"/);
    expect(src).toMatch(/new CustomEvent\(MUTATION_EVENT/);
  });

  test("both stylesheets let the pill grow past 280 px at ≥ 1024 px", () => {
    for (
      const css of [
        "front-end/static/dashboard.css",
        "front-end/static/assistant-page.css",
      ]
    ) {
      const text = read(css);
      const m = text.match(
        /@media\s*\(min-width:\s*1024px\)\s*\{[^}]*\.topbar__ticker\s*\{[^}]*max-width:\s*(\d+)px/,
      );
      expect(m ? Number(m[1]) : 0).toBeGreaterThanOrEqual(480);
    }
  });
});
