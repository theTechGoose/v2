/**
 * REQ-643 — demo-loop cycle 5, issues m9 "Empty beige strip under footer cuts content and stays
 * after demo ends" and p18-3d "Send modal dim layer doesn't cover the demo pill".
 *
 * RCA (CONFIRMED, skeptic UPHELD, at 2444608a): the overlay's place() reserved REQ-379's band
 * (`room(home.room)`) on every pass — with the pill folded to its REQ-545 tab (band unpainted, so
 * an empty body-coloured strip cut the app), and under the ended notice until it was dismissed.
 * On a phone the send dialog's backdrop sits inside the transformed mobile `.app`, so its
 * `position:fixed; inset:0` stops at the app's foot, above the band: the band stayed bright under
 * a dimmed page — and the overlay did not even see a dialog (its backdrop missed the window's foot).
 *
 * Now: the room is reserved only while the pill sits home on its band (or a dialog is up, which
 * REQ-618's sheet padding relies on); folded to its tab or showing the ended notice (a floating
 * message), no room at all; a backdrop that ends at the band counts as a dialog, and the band under
 * it is painted in the backdrop's dim.
 */
import * as fs from "fs";
import * as path from "path";
import {
  backdropCovers,
  backdropDim,
  bandPaint,
  bandRoom,
  PILL_MARGIN,
  pillHome,
  placePill,
  seeThrough,
} from "../../shared/demo-mode/pill.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const view = { w: 390, h: 844 };
const home = () => pillHome({ view, size: { w: 300, h: 40 } });

describe("REQ-643 (demo-loop cycle 5, m9) — the band's room is reserved only while the pill sits home on it", () => {
  test("home on the band: the room; folded to its tab: none (no empty strip under the app)", () => {
    const h = home();
    const atHome = placePill({
      home: h.box,
      view,
      dialog: false,
      blocked: () => 0,
    });
    expect(bandRoom({ band: atHome.band, dialog: false }, h.room)).toBe(h.room);
    const tucked = placePill({
      home: h.box,
      view,
      dialog: false,
      blocked: () => 3,
    });
    expect(tucked.tucked).toBe(true);
    expect(bandRoom({ band: tucked.band, dialog: false }, h.room)).toBe(0);
    const minimal = placePill({
      home: h.box,
      view,
      dialog: false,
      minimal: true,
      blocked: () => 0,
    });
    // REQ-643 AMENDMENT (reconciled on demo-fixes with REQ-637): a public document's pill is no
    // longer folded — REQ-637 keeps it whole, home on its strip — so its band keeps the room
    expect(minimal.tucked).toBe(false);
    expect(bandRoom({ band: minimal.band, dialog: false }, h.room)).toBe(h.room);
  });

  test("a dialog is up: the room stays (REQ-618's sheet clears the pill by it), docked or tucked alike", () => {
    const h = home();
    expect(bandRoom({ band: false, dialog: true }, h.room)).toBe(h.room);
  });

  test("the ended notice floats: no band, no room — even with nothing under the home, even with a dialog", () => {
    const h = home();
    const p = placePill({
      home: h.box,
      view,
      dialog: false,
      yields: false,
      floats: true,
      blocked: () => 0,
    });
    expect(p).toEqual({ box: h.box, tucked: false, band: false });
    expect(bandRoom({ band: p.band, dialog: false, floats: true }, h.room))
      .toBe(0);
    expect(bandRoom({ band: false, dialog: true, floats: true }, h.room)).toBe(
      0,
    );
  });

  test("the floating notice moves off content under the home when a corner is clear, never tucks", () => {
    const h = home();
    const p = placePill({
      home: h.box,
      view,
      dialog: false,
      yields: false,
      floats: true,
      blocked: (r) => (r.top === h.box.top ? 2 : 0),
    });
    expect(p.tucked).toBe(false);
    expect(p.band).toBe(false);
    expect(p.box.top).toBe(PILL_MARGIN);
    const stuck = placePill({
      home: h.box,
      view,
      dialog: false,
      yields: false,
      floats: true,
      blocked: () => 2,
    });
    expect(stuck).toEqual({ box: h.box, tucked: false, band: false });
  });
});

describe("REQ-643 (demo-loop cycle 5, p18-3d) — a backdrop that stops at the band is a dialog, and the band takes its dim", () => {
  test("a phone backdrop confined to the transformed .app (ends at the band's top) covers the view above the band", () => {
    const room = 64;
    const r = { left: 0, top: 0, width: 390, height: 844 - room };
    expect(backdropCovers(r, view, 0)).toBe(false);
    expect(backdropCovers(r, view, room)).toBe(true);
    expect(backdropCovers({ ...r, height: 844 }, view, room)).toBe(true);
    // a card or a half sheet is not a backdrop
    expect(backdropCovers({ ...r, top: 300, height: 480 }, view, room)).toBe(
      false,
    );
  });

  test("only a see-through layer is a dim: the phone's own fixed .app (no background) is not a dialog", () => {
    expect(seeThrough("rgba(20, 44, 48, 0.45)")).toBe(true);
    expect(seeThrough("rgb(20 44 48 / 45%)")).toBe(true);
    expect(seeThrough("rgba(0, 0, 0, 0)")).toBe(false);
    expect(seeThrough("rgb(255, 255, 255)")).toBe(false);
    expect(seeThrough("transparent")).toBe(false);
    const src = read("front-end/islands/DemoModeOverlay.tsx");
    expect(src).toMatch(
      /seeThrough\(cs\.backgroundColor\) \|\| el\.matches\(MODAL_SELECTOR\)/,
    );
  });

  test("the dim: the backdrop's colour when it stops short of the window's foot, none when it covers it", () => {
    const short = { left: 0, top: 0, width: 390, height: 780 };
    expect(backdropDim(short, view, "rgba(20, 44, 48, 0.45)")).toBe(
      "rgba(20, 44, 48, 0.45)",
    );
    expect(
      backdropDim({ ...short, height: 844 }, view, "rgba(20, 44, 48, 0.45)"),
    ).toBeNull();
    expect(backdropDim(short, view, "rgba(0, 0, 0, 0)")).toBeNull();
    expect(backdropDim(short, view, "transparent")).toBeNull();
  });

  test("the band painted with the dim over the page's own colour; without one, the page's colour", () => {
    expect(bandPaint("rgb(250, 247, 240)", null)).toBe("rgb(250, 247, 240)");
    expect(bandPaint("rgb(250, 247, 240)", "rgba(20, 44, 48, 0.45)")).toBe(
      "linear-gradient(rgba(20, 44, 48, 0.45), rgba(20, 44, 48, 0.45)), rgb(250, 247, 240)",
    );
  });
});

describe("REQ-643 — the overlay wires it", () => {
  const o = () => read("front-end/islands/DemoModeOverlay.tsx");

  test("place() no longer reserves the room unconditionally: the room follows bandRoom", () => {
    const src = o();
    // the only room(home.room) left is the guarded probe (home asked with the room reserved)
    expect(src.match(/room\(home\.room\)/g)?.length).toBe(1);
    expect(src).toMatch(
      /if \(!floats && \(dialog \|\| !minimal\)\) \{\s*room\(home\.room\);/,
    );
    expect(src).toMatch(/room\(\s*bandRoom\(/);
  });

  test("the ended notice floats (no room); a backdrop ending at the band is a dialog; the band takes the dim", () => {
    const src = o();
    expect(src).toMatch(/const floats = floatsRef\.current;/);
    expect(src).toMatch(
      /if \(notice && !opening\) \{[\s\S]{0,200}?floatsRef\.current = true;/,
    );
    expect(src).toMatch(/backdropCovers\(/);
    expect(src).toMatch(/backdropDim\(/);
    expect(src).toMatch(/background:\$\{bandPaint\(bandBg, bandDim\)\}/);
  });
});
