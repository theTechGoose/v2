/**
 * REQ-379 — demo-loop cycle 2, issues M1 + M6 + M28: the customer's demo pill has ONE home, in a
 * band the page leaves for it, instead of REQ-295's hunt for an empty slot.
 *
 * M1 (CONFIRMED): the pill hopped from page to page (corners, edges, mid-chat) every 0.7 s check,
 * flipped between its compact and full form, came back per path after a reload, and covered the
 * shell anyway — `.app` is viewport-high with `overflow:hidden` and never subtracted the room the
 * pill reserved (`--demo-pill-h`). M6 (CONFIRMED): the pill wrote its measured box back as an
 * inline `min-width`, so a 390 px phone measured 366, rounded it up to 400 and never shrank —
 * "End demo" ran off the screen. M28 (LIKELY): a click on the pill's empty area never reached the
 * page under it ("the pill intercepts pointer events").
 *
 * Now: bottom-left, in a band reserved under the page (the shells subtract it, the REQ-181 way);
 * the pill is as wide as its content and never wider than the window minus a margin each side; a
 * dialog over its home docks it at the top-left, nothing else ever moves it; only its buttons
 * take a click; the phone's details stay open or closed across a reload.
 */
import * as fs from "fs";
import * as path from "path";
import {
  dockPill,
  PILL_BAND_GAP,
  PILL_COMPACT_MAX_W,
  PILL_MARGIN,
  PILL_OPEN_KEY,
  PILL_ROOM_VAR,
  pillHome,
  recallPillOpen,
  rememberPillOpen,
} from "../../shared/demo-mode/pill.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const PILL_H = `var(${PILL_ROOM_VAR}, 0px)`;

describe("REQ-379 — the pill's one home (cycle 2, M1 + M6)", () => {
  test("M6: on a 390 px phone a pill measured 366 px is never wider than 366 px — nor is a stale wider measure", () => {
    const view = { w: 390, h: 844 };
    for (const w of [366, 400, 760]) {
      const { box } = pillHome({ view, size: { w, h: 40 } });
      expect(box.width).toBeLessThanOrEqual(366);
      expect(box.left).toBe(PILL_MARGIN);
      expect(box.left + box.width).toBeLessThanOrEqual(390 - PILL_MARGIN);
    }
    // a narrower pill keeps its own width: nothing rounds it up
    expect(pillHome({ view, size: { w: 214, h: 40 } }).box.width).toBe(214);
  });

  test("bottom-left, the band's gap above the window's bottom; the band holds the pill with air above it", () => {
    const view = { w: 1280, h: 720 };
    const { box, room } = pillHome({ view, size: { w: 700, h: 43 } });
    expect(box).toEqual({
      left: PILL_MARGIN,
      top: 720 - PILL_BAND_GAP - 43,
      width: 700,
      height: 43,
    });
    expect(view.h - room).toBeLessThanOrEqual(box.top - PILL_BAND_GAP);
    // the band is the pill's height rounded up to 8 px, plus the gap above and below
    expect(room).toBe(48 + 2 * PILL_BAND_GAP);
    // a status a pixel or two taller or shorter does not move the page
    expect(pillHome({ view, size: { w: 650, h: 41 } }).room).toBe(room);
  });

  test("the same window and pill give the same home: no current box, no path, no memory goes in", () => {
    const a = pillHome({ view: { w: 1280, h: 800 }, size: { w: 300, h: 40 } });
    const b = pillHome({ view: { w: 1280, h: 800 }, size: { w: 300, h: 40 } });
    expect(a).toEqual(b);
    expect(pillHome.length).toBe(1);
  });
});

describe("REQ-379 — a dialog over the home docks the pill; nothing else moves it (supersedes REQ-300's freeze)", () => {
  const view = { w: 1280, h: 720 };
  // computed in each test, so a missing function fails the test, not the whole file
  const homeBox = () => pillHome({ view, size: { w: 700, h: 43 } }).box;

  test("the home clear: the pill stays home", () => {
    const home = homeBox();
    expect(dockPill({ home, view, top: 0, blocked: () => 0 })).toEqual(home);
  });

  test("the dialog's content under the home: the top-left, under the banner when there is one", () => {
    const home = homeBox();
    const underHome = (r: { top: number }) => (r.top === home.top ? 2 : 0);
    expect(dockPill({ home, view, top: 0, blocked: underHome })).toEqual({
      ...home,
      top: PILL_MARGIN,
    });
    expect(dockPill({ home, view, top: 40, blocked: underHome })).toEqual({
      ...home,
      top: 40 + PILL_MARGIN,
    });
  });

  test("both covered: home — never a third place, never a hunt", () => {
    const home = homeBox();
    const asked: number[] = [];
    const box = dockPill({
      home,
      view,
      top: 0,
      blocked: (r) => {
        asked.push(r.top);
        return 1;
      },
    });
    expect(box).toEqual(home);
    expect(asked).toEqual([home.top, PILL_MARGIN]);
  });
});

describe("REQ-379 — the phone pill's details survive a reload (the tab remembers the choice)", () => {
  const store = new Map<string, string>();
  const like = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };

  test("closed until opened; open stays open; closed again stays closed", () => {
    expect(recallPillOpen(like)).toBe(false);
    rememberPillOpen(like, true);
    expect(recallPillOpen(like)).toBe(true);
    expect([...store.keys()]).toEqual([PILL_OPEN_KEY]);
    rememberPillOpen(like, false);
    expect(recallPillOpen(like)).toBe(false);
  });

  test("junk, or a storage that throws, reads as closed", () => {
    store.set(PILL_OPEN_KEY, "junk");
    expect(recallPillOpen(like)).toBe(false);
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("full");
      },
      removeItem: () => {},
    };
    expect(recallPillOpen(broken)).toBe(false);
    expect(() => rememberPillOpen(broken, true)).not.toThrow();
  });
});

describe("REQ-379 — the page leaves the band free: the shells subtract --demo-pill-h (the REQ-181 way)", () => {
  test("every viewport-high desktop shell: .app in the dashboard and the assistant stylesheets", () => {
    for (
      const f of [
        "front-end/static/dashboard.css",
        "front-end/static/assistant-page.css",
      ]
    ) {
      const shells = [
        ...read(f).matchAll(/height: calc\(var\(--app-vh, 100dvh\)[^;]*;/g),
      ].map((m) => m[0]);
      expect(shells.length).toBeGreaterThan(0);
      for (const h of shells) {
        expect(h).toBe(
          `height: calc(var(--app-vh, 100dvh) - var(--banner-h, 0px) - ${PILL_H});`,
        );
      }
    }
  });

  test("the phone: the assistant's fixed shell and chat, the slide-in drawer, the drawer's conversations, the dashboard's body-scroll shell", () => {
    const a = read("front-end/static/assistant-page.css");
    expect(a).toContain(
      `height: calc(var(--vvh, 100dvh) - var(--banner-h, 0px) - ${PILL_H});`,
    );
    expect(a).toContain(
      `height: calc(var(--vvh, 100dvh) - var(--banner-h, 0px) - 60px - ${PILL_H});`,
    );
    const d = read("front-end/static/dashboard.css");
    expect(d).toContain(`min-height: calc(100dvh - ${PILL_H});`);
    // the drawer ends above the band: "Log out" at its foot is never under the pill
    for (const css of [a, d]) {
      const drawer = css.match(
        /@media \(max-width: 640px\) \{\s*\.sb \{[^}]*\}/,
      );
      expect(drawer?.[0]).toContain(`bottom: ${PILL_H};`);
    }
    expect(read("front-end/islands/AsstThreads.tsx")).toContain(
      `bottom:${PILL_H}`,
    );
  });

  test("the onboarding wizard's window-high shell leaves the band too", () => {
    expect(read("front-end/static/welcome.css")).toContain(
      `min-height: calc(100dvh - ${PILL_H});`,
    );
  });

  test("a toast pinned to the window's foot sits above the band (Customers' flash)", () => {
    expect(read("front-end/islands/ClientsPage.tsx")).toContain(
      `bottom:calc(28px + ${PILL_H})`,
    );
  });
});

describe("REQ-379 — the overlay keeps the pill home", () => {
  const o = read("front-end/islands/DemoModeOverlay.tsx");

  test("one home and the dock: no slot hunt, no per-path memory, no compact <-> full oscillation", () => {
    expect(o).toMatch(/pillHome\(/);
    expect(o).toMatch(/dockPill\(/);
    expect(o).not.toMatch(
      /pillSlots|pickPillSlot|planPill|recallPillBox|rememberPillBox|crampedRef|UNCRAMP_CHECKS|ghostsOfPage/,
    );
  });

  test("M6 / RC-A: the measured box is never written back as a minimum width", () => {
    expect(o).not.toMatch(/min-width:\$\{/);
    // anchored by CSS to the visible bottom (above an iOS keyboard), not placed by a measure
    expect(o).toMatch(
      /bottom:calc\(100% - var\(--vvt, 0px\) - var\(--vvh, 100%\) \+ \$\{PILL_BAND_GAP\}px\)/,
    );
  });

  test("the phone's compact form from the first render, and again whenever the window crosses the line", () => {
    expect(PILL_COMPACT_MAX_W).toBe(640);
    expect(o).toMatch(/useState\(narrow\)/);
    expect(o).toMatch(/setCompact\(narrow\(\)\)/);
  });

  test("a dialog is no longer a freeze: place() docks instead of returning early", () => {
    expect(o).not.toMatch(/posRef\.current && dialogBackdropUp\(\)\) return/);
    expect(o).toMatch(/dialogBackdropUp\(\)/);
    // REQ-300 still: End's question up, nothing moves
    expect(o).toMatch(
      /querySelector\(\s*['"]\[data-cy=["']?demo-end-ask["']?\]['"]\s*\)/,
    );
  });

  test("the phone pill's open details are remembered for the tab", () => {
    expect(o).toMatch(/recallPillOpen\(/);
    expect(o).toMatch(/rememberPillOpen\(/);
  });
});

describe("REQ-379 — M28: only the pill's buttons take a click", () => {
  test("the pill itself lets clicks through; every button of it takes them", () => {
    const o = read("front-end/islands/DemoModeOverlay.tsx");
    const style = o.match(/const pillStyle =\s*`([^`]*)`/)?.[1] ?? "";
    expect(style).toContain("pointer-events:none");
    // each <button> of the overlay (dismiss, Back to the demo, the status) takes clicks again
    // a button's opening tag: its attributes, up to the line that closes it (`>` alone)
    const buttons = o.split("<button").slice(1).map((b) =>
      b.match(/^([\s\S]*?)\n\s*>/)?.[1] ?? b.slice(0, 600)
    );
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    for (const b of buttons) expect(b).toContain("${HIT}");
    expect(o).toMatch(/const HIT = "pointer-events:auto"/);
  });

  test("End and its question take clicks (the same component on the stage, where it changes nothing)", () => {
    const e = read("front-end/components/demo-mode/EndDemo.tsx");
    expect(e).toMatch(/const BTN =\s*"[^"]*pointer-events:auto/);
    // the question's own words stay inside it: a click on them is not "outside"
    expect(e).toMatch(
      /data-cy="demo-end-ask"[\s\S]*?style="[^"]*pointer-events:auto/,
    );
    expect(e).toMatch(
      /data-cy="demo-end-cancel"[\s\S]*?style="[^"]*pointer-events:auto/,
    );
  });
});
