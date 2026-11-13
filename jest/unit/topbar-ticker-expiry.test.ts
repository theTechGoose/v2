/**
 * REQ-726 — demo-loop cycle 5 (run r37f88707), issues m6 and m57.
 *
 * m6 "Toasts/top-bar notice stay for minutes and squeeze the search box":
 * DashTopbar showed `newestNotification(items)` whenever any notification
 * existed — nothing expired it, so "Pago registrado … hace 4m" sat in the bar
 * on every page. It shared the search row from 1250 px up, so at 1280/1440 the
 * search placeholder and the pill's sentence were cut and the time wrapped.
 *
 * m57 "Activity toast link doesn't scroll to Activity": the pill links to
 * /dashboard#activity, but the DashboardPage island's SSR render is the
 * skeleton (no #activity), so the browser's fragment scroll finds nothing and
 * nothing retried after mount; the first-visit coach mark covered the page.
 */
import * as fs from "fs";
import * as path from "path";
import {
  freshTickerItem,
  TICKER_LIFETIME_MS,
} from "../../front-end/lib/ticker-pick";
import { TOPBAR_CSS } from "../../front-end/lib/topbar-css";
import {
  ACTIVITY_HASH,
  scrollToHashTarget,
} from "../../front-end/lib/dash-anchor";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const squash = (s: string) => s.replace(/\s+/g, "");

const NOW = Date.parse("2026-11-12T10:00:00Z");
const ago = (ms: number, id = `n-${ms}`) => ({
  id,
  title: id,
  createdAt: new Date(NOW - ms).toISOString(),
});

describe("REQ-726 m6 (cycle 5): the live-activity pill is a transient notice, not a permanent banner", () => {
  test("the lifetime is about 90 s (between 60 s and 120 s)", () => {
    expect(TICKER_LIFETIME_MS).toBeGreaterThanOrEqual(60_000);
    expect(TICKER_LIFETIME_MS).toBeLessThanOrEqual(120_000);
  });

  test("a fresh newest event shows; once it is older than the lifetime nothing shows", () => {
    const fresh = ago(5_000, "fresh");
    const old = ago(10 * 60_000, "old");
    expect(freshTickerItem([old, fresh], NOW)).toBe(fresh);
    expect(freshTickerItem([ago(TICKER_LIFETIME_MS - 1, "edge")], NOW)?.id)
      .toBe("edge");
    expect(freshTickerItem([ago(TICKER_LIFETIME_MS, "gone")], NOW)).toBeNull();
    // the demo's "Pago registrado … hace 4m" no longer shows
    expect(freshTickerItem([ago(4 * 60_000)], NOW)).toBeNull();
    expect(freshTickerItem([], NOW)).toBeNull();
  });

  test("an older event never stands in for an expired newest one", () => {
    expect(freshTickerItem([ago(3 * 60_000), ago(5 * 60_000)], NOW)).toBeNull();
  });

  test("a timestamp slightly ahead of the browser clock (skew) still shows", () => {
    expect(freshTickerItem([ago(-20_000, "ahead")], NOW)?.id).toBe("ahead");
  });

  test("DashTopbar renders only the fresh event, re-evaluated on its age tick", () => {
    const src = read("front-end/islands/DashTopbar.tsx");
    expect(src).toMatch(/freshTickerItem\(/);
    expect(src).not.toMatch(/const tickerItem = newestNotification\(items\)/);
  });

  test("TOPBAR_CSS hides the pill up to ~1500 px, so it never shares the search row at 1280/1440", () => {
    const hides = [
      ...TOPBAR_CSS.matchAll(/@media\s*\(max-width:(\d+)px\)\{([^@]*)\}/g),
    ].filter((m) => /\.topbar__ticker\{display:none\}/.test(squash(m[2])))
      .map((m) => Number(m[1]));
    expect(Math.max(...hides)).toBeGreaterThanOrEqual(1499);
  });

  for (
    const file of [
      "front-end/static/dashboard.css",
      "front-end/static/assistant-page.css",
    ]
  ) {
    test(`${file}: the time stays on one line in the body font`, () => {
      const css = read(file);
      const re = /(^|[}\s,])\.topbar__ticker-time\s*\{([^}]*)\}/g;
      const found = [...css.matchAll(re)].map((m) => m[2]);
      expect(found.length).toBeGreaterThan(0);
      for (const body of found) {
        expect(body).toMatch(/white-space\s*:\s*nowrap\s*;/);
        expect(body).toMatch(/font-family\s*:\s*var\(--font-body\)/);
        expect(body).not.toMatch(/max-height/);
      }
    });
  }
});

describe("REQ-726 m57 (cycle 5): /dashboard#activity lands on the Activity panel", () => {
  const fakeDoc = (el: { scrollIntoView: jest.Mock } | null) => ({
    getElementById: jest.fn((_id: string) => el),
  });

  test("the #activity hash scrolls the panel into view, block start", () => {
    const el = { scrollIntoView: jest.fn() };
    const doc = fakeDoc(el);
    expect(scrollToHashTarget(doc, "#activity")).toBe(true);
    expect(doc.getElementById).toHaveBeenCalledWith("activity");
    expect(el.scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ block: "start" }),
    );
  });

  test("no hash, another hash, or a panel not mounted yet → no scroll (false, retried later)", () => {
    const el = { scrollIntoView: jest.fn() };
    expect(scrollToHashTarget(fakeDoc(el), "")).toBe(false);
    expect(scrollToHashTarget(fakeDoc(el), "#other")).toBe(false);
    expect(el.scrollIntoView).not.toHaveBeenCalled();
    expect(scrollToHashTarget(fakeDoc(null), "#activity")).toBe(false);
    expect(ACTIVITY_HASH).toBe("#activity");
  });

  test("DashboardPage retries the scroll after mount and once the lists render (the SSR skeleton has no #activity)", () => {
    const src = read("front-end/islands/DashboardPage.tsx");
    expect(src).toMatch(/from "\.\.\/lib\/dash-anchor\.ts"/);
    expect(src).toMatch(/scrollToHashTarget\(/);
    expect(src).toMatch(/\[s\.loading,\s*s\.listsLoaded\]/);
  });

  test("the coach mark stays away when the user arrives via #activity", () => {
    const src = read("front-end/islands/AssistantCoachmark.tsx");
    expect(src).toMatch(/ACTIVITY_HASH/);
  });
});
