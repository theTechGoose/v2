/**
 * REQ-545 — demo-loop cycle 4, issue m2: the customer's demo pill covered page content — tiles,
 * fields, confirm buttons, the presenter's pointer.
 *
 * RCA (CONFIRMED, skeptic UPHELD): REQ-379 gave the pill one fixed home bottom-left in a reserved
 * band, and REQ-440 painted that band opaque. Body padding frees only the END of a document that
 * scrolls, so mid-scroll whatever scrolled into the window's bottom strip was under the band and
 * the pill. A dialog over the home moved the pill to the top-left only while that was clear, else
 * it stayed home OVER the dialog (the Publish confirm, the Add task sheet, the send modal). Public
 * /q, /i, /co opened in the owner's browser got the full pill and band too. And the stage's
 * replay skips the overlay, so the presenter saw content where the customer saw the band.
 *
 * Now the pill yields: anything of the page under its home → it tucks into a small edge tab (the
 * band is not painted, the page shows); a dialog docks it home, top-left, then top-right, else it
 * tucks; on a public document page it is always the tab; the stage draws the customer's band.
 */
import * as fs from "fs";
import * as path from "path";
import {
  bandGhostBox,
  dockPill,
  isPublicDocPath,
  PILL_MARGIN,
  PILL_TAB,
  pillHome,
  placePill,
  tabBox,
} from "../../shared/demo-mode/pill.ts";
import { parsePeerMessage } from "../../shared/demo-mode/protocol.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const view = { w: 1280, h: 720 };
const homeBox = () => pillHome({ view, size: { w: 700, h: 43 } }).box;

describe("REQ-545 (demo-loop cycle 4, m2) — mid-scroll content under the home: the pill tucks into an edge tab", () => {
  test("a tile scrolled into the bottom strip (no dialog): a small tab at the left edge, the band not painted", () => {
    const home = homeBox();
    const p = placePill({ home, view, dialog: false, blocked: () => 2 });
    expect(p.tucked).toBe(true);
    expect(p.band).toBe(false);
    expect(p.box).toEqual(tabBox(home));
    expect(p.box.left).toBe(0);
    expect(p.box.width).toBeLessThanOrEqual(PILL_TAB.w);
    // REQ-637 (cycle 5, m5) AMENDMENT — a labelled mini-pill, still a small part of the pill
    expect(p.box.width * p.box.height).toBeLessThan(
      (home.width * home.height) / 4,
    );
    // its foot on the home's foot: it never rises into the page
    expect(p.box.top + p.box.height).toBe(home.top + home.height);
  });

  // REQ-781 (demo-loop cycle dv1, d7) AMENDMENT — no band any more: home, floating over the page
  test("nothing of the page under the home: home (REQ-781: floating, never on a band)", () => {
    const home = homeBox();
    expect(placePill({ home, view, dialog: false, blocked: () => 0 }))
      .toEqual({ box: home, tucked: false, band: false });
  });
});

describe("REQ-545 — only the live pill yields: the ended notice is a message to read and dismiss", () => {
  test("yields:false — content under the home keeps it home; a dialog still docks it, else home", () => {
    const home = homeBox();
    expect(
      placePill({ home, view, dialog: false, yields: false, blocked: () => 2 }),
    ).toEqual({ box: home, tucked: false, band: false });
    expect(
      placePill({
        home,
        view,
        dialog: false,
        minimal: true,
        yields: false,
        blocked: () => 0,
      }).tucked,
    ).toBe(false);
    const docked = placePill({
      home,
      view,
      dialog: true,
      yields: false,
      blocked: (r) => (r.top === home.top ? 1 : 0),
    });
    expect(docked.tucked).toBe(false);
    expect(docked.box.top).toBe(PILL_MARGIN);
    expect(
      placePill({ home, view, dialog: true, yields: false, blocked: () => 1 })
        .box,
    ).toEqual(home);
  });

  test("the overlay marks only the customer's live pill as yielding", () => {
    const src = read("front-end/islands/DemoModeOverlay.tsx");
    const off = src.indexOf("yieldsRef.current = false;");
    const ended = src.indexOf("if (notice && !opening)");
    // the phone pill's details opened by a tap stay shown until closed
    const on = src.indexOf("yieldsRef.current = !(compact && open)");
    const live = src.indexOf("const presenters: Presenter[]");
    expect(off).toBeGreaterThan(0);
    expect(off).toBeLessThan(ended);
    expect(on).toBeGreaterThan(ended);
    expect(on).toBeLessThan(live);
  });
});

describe("REQ-545 — a dialog: home, top-left, top-right, else the tab — never home over the dialog", () => {
  test("home and top-left covered, top-right clear: the top-right, under the banner", () => {
    const home = homeBox();
    const asked: { left: number; top: number }[] = [];
    const box = dockPill({
      home,
      view,
      top: 40,
      blocked: (r) => {
        asked.push({ left: r.left, top: r.top });
        return r.left > PILL_MARGIN ? 0 : 1;
      },
    });
    expect(box).toEqual({
      ...home,
      left: view.w - PILL_MARGIN - home.width,
      top: 40 + PILL_MARGIN,
    });
    expect(asked.length).toBe(3);
  });

  test("all three covered: no spot (null) — and placePill tucks the pill instead of leaving it on the dialog's buttons", () => {
    const home = homeBox();
    expect(dockPill({ home, view, top: 0, blocked: () => 1 })).toBeNull();
    const p = placePill({ home, view, dialog: true, blocked: () => 1 });
    expect(p.tucked).toBe(true);
    expect(p.box).toEqual(tabBox(home));
    expect(p.box).not.toEqual(home);
  });

  test("a dialog that leaves the home clear: home", () => {
    const home = homeBox();
    expect(placePill({ home, view, dialog: true, blocked: () => 0 }).box)
      .toEqual(home);
  });
});

describe("REQ-545 — public /q, /i, /co pages in the owner's browser: the pill stays minimal", () => {
  test("the public document paths, and only those", () => {
    for (const p of ["/q/abc123", "/i/abc123", "/co/abc123"]) {
      expect(isPublicDocPath(p)).toBe(true);
    }
    for (
      const p of ["/quotes/abc", "/q", "/q/", "/invoices/x", "/customers", "/"]
    ) {
      expect(isPublicDocPath(p)).toBe(false);
    }
  });

  // REQ-637 (demo-loop cycle 5, m5) SUPERSEDED — "minimal: the tab even with the home clear":
  // the 16 px tab hid End on the owner's own document; now the whole pill sits on its strip there
  // REQ-781 (cycle dv1, d7) AMENDMENT — whole where no control is under it, never on a band
  test("minimal (REQ-637): the whole pill home, even with content (no control) under it", () => {
    const home = homeBox();
    const p = placePill({
      home,
      view,
      dialog: false,
      minimal: true,
      blocked: () => 2,
      controls: () => 0,
    });
    expect(p.tucked).toBe(false);
    expect(p.band).toBe(false);
  });
});

describe("REQ-545 — the stage draws the customer's band, so both screens agree", () => {
  test("the band's box on the stage: window-wide at the foot of their screen, scaled like the frame", () => {
    const fit = { left: 100, top: 50, s: 0.5 };
    expect(bandGhostBox(64, { w: 390, h: 844 }, fit)).toEqual({
      left: 100,
      top: 50 + (844 - 64) * 0.5,
      width: 195,
      height: 32,
    });
    expect(bandGhostBox(0, { w: 390, h: 844 }, fit)).toBeNull();
  });

  test("the pill message carries whether it is tucked and the band (height + colour); junk is dropped", () => {
    const r = { left: 0, top: 664, width: 16, height: 40 };
    expect(
      parsePeerMessage({
        k: "pill",
        r,
        tucked: true,
        band: 64,
        bandBg: "rgb(255, 255, 255)",
      }),
    ).toEqual({
      k: "pill",
      r,
      tucked: true,
      band: 64,
      bandBg: "rgb(255, 255, 255)",
    });
    expect(
      parsePeerMessage({
        k: "pill",
        r,
        tucked: "yes",
        band: -3,
        bandBg: "url(javascript:x)",
      }),
    ).toEqual({ k: "pill", r });
  });

  test("the stage paints the band ghost and a tucked ghost as a tab (no words)", () => {
    const s = read("front-end/islands/DemoStage.tsx");
    expect(s).toMatch(/bandGhostBox\(/);
    expect(s).toMatch(/data-cy="demo-band-ghost"/);
    expect(s).toMatch(/tucked: m\.tucked/);
  });
});

describe("REQ-545 — the overlay wires it: placePill, a scroll re-check, the edge tab that expands on hover or tap", () => {
  const o = () => read("front-end/islands/DemoModeOverlay.tsx");

  test("placed by placePill (public pages minimal), re-checked on scroll", () => {
    expect(o()).toMatch(/placePill\(/);
    expect(o()).toMatch(/isPublicDocPath\(/);
    expect(o()).toMatch(/addEventListener\(\s*"scroll"/);
  });

  test("the tab: its own control, expands on hover (mouseenter) or tap (click)", () => {
    const src = o();
    expect(src).toMatch(/data-cy="demo-pill-tab"/);
    const tab = src.slice(src.indexOf('data-cy="demo-pill-tab"') - 400);
    expect(tab.slice(0, 1600)).toMatch(/onMouseEnter=/);
    expect(tab.slice(0, 1600)).toMatch(/onClick=/);
  });

  // REQ-781 (cycle dv1, d7) SUPERSEDES it: no band is painted at all
  test("REQ-781: no band is painted under the pill", () => {
    expect(o()).not.toMatch(/bandOn/);
  });
});
