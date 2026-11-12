/**
 * REQ-440 — demo-loop cycle 3, issue m2: the customer's demo pill covered page content on pages
 * whose document scrolls (/q "01 QUICK SUMMARY", /i, /co, /terms, the phone dashboard, the worker
 * view) and in the New invoice sheet. REQ-379 reserved its band only as body padding, which frees
 * the END of the document, not the bottom band of the window.
 *
 * The band is made real: scrolling to something (an anchor, focus, scrollIntoView) stops above it
 * (scroll-padding-bottom on <html>); the overlay paints the band in the page's own background, so
 * scrolled content goes under the band's edge, never under the pill; and the New invoice sheet's
 * scrolling backdrop ends above the band.
 */
import * as fs from "fs";
import * as path from "path";
import {
  bandBackground,
  clearPillRoom,
  PILL_ROOM_VAR,
  setPillRoom,
} from "../../shared/demo-mode/pill.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const recorder = () => {
  const calls: string[] = [];
  const style = (tag: string) => ({
    setProperty: (n: string, v: string) =>
      void calls.push(`${tag} set ${n}=${v}`),
    removeProperty: (n: string) => void calls.push(`${tag} rm ${n}`),
  });
  return { calls, style };
};

describe("REQ-440 (demo-loop cycle 3, m2) — the pill's band is real on pages whose document scrolls", () => {
  test("REQ-440: the room scroll-pads the document by the band, keeps the body's padding, and clears both", () => {
    const { calls, style } = recorder();
    setPillRoom(style("html"), style("body"), 52.2);
    expect(calls).toContain(`html set ${PILL_ROOM_VAR}=52px`);
    expect(calls).toContain(
      `html set scroll-padding-bottom=var(${PILL_ROOM_VAR}, 0px)`,
    );
    expect(calls).toContain(
      `body set padding-bottom=var(${PILL_ROOM_VAR}, 0px)`,
    );
    calls.length = 0;
    clearPillRoom(style("html"), style("body"));
    expect(calls).toContain("html rm scroll-padding-bottom");
    expect(calls).toContain(`html rm ${PILL_ROOM_VAR}`);
    expect(calls).toContain("body rm padding-bottom");
  });

  test("REQ-440: the band takes the first opaque background under it, else white", () => {
    expect(
      bandBackground(["rgba(0, 0, 0, 0)", "transparent", "rgb(247, 244, 236)"]),
    ).toBe("rgb(247, 244, 236)");
    // a see-through colour would show the text under the band
    expect(bandBackground(["rgba(20, 40, 45, 0.45)", "rgb(255, 0, 0)"])).toBe(
      "rgb(255, 0, 0)",
    );
    expect(bandBackground(["rgba(1, 2, 3, 1)"])).toBe("rgba(1, 2, 3, 1)");
    expect(bandBackground(["", "transparent", "rgba(0, 0, 0, 0)"])).toBe(
      "#fff",
    );
    expect(bandBackground([])).toBe("#fff");
  });

  test("REQ-440: the overlay paints the band — window-wide, the band's height, under the page's own fixed layers, never taking a click", () => {
    const src = read("front-end/islands/DemoModeOverlay.tsx");
    expect(src).toContain(`data-cy="demo-band"`);
    const band = src.match(/const bandStyle =\s*`[^`]*`/)?.[0] ?? "";
    expect(band).toContain("position:fixed");
    expect(band).toContain("left:0;right:0;bottom:0");
    // REQ-545 (cycle 4, m2) AMENDMENT — the band's height while the pill sits home on it; 0
    // while the pill is tucked to its tab (the band hid what scrolled into the strip)
    expect(band.replace(/\s+/g, " ")).toContain(
      `bandOn ? "var(${PILL_ROOM_VAR}, 0px)" : "0px"`,
    );
    expect(band).toContain("pointer-events:none");
    expect(band).toContain("z-index:1;");
    expect(src).toContain("bandBackground(");
  });

  // REQ-618 (demo-loop cycle 4, p4-p3b) amends REQ-440(c): the backdrop is also the dim, so
  // ending it above the band left a ~60 px undimmed strip under the sheet. The dim covers the
  // whole window again; only the sheet's CONTENT keeps clear of the band, by the scroller's
  // bottom padding (and scroll padding, for focus/scrollIntoView).
  test("REQ-618: the New invoice sheet's backdrop dims the whole window, and its content scrolls clear of the band", () => {
    const src = read("front-end/islands/InvoicesPage.tsx");
    const sheet = src.match(
      /<Backdrop\s+onClose=[^\n]*\n\s*style="(position:fixed;[^"]*overflow-y:auto[^"]*)"/,
    );
    expect(sheet?.[1]).toBeDefined();
    const style = sheet![1];
    // the dim: the full window, whatever the band
    expect(style).toMatch(/(^|;)inset:0;/);
    expect(style).not.toContain(`inset:0 0 var(${PILL_ROOM_VAR}`);
    expect(style).toContain("background:rgba(20,40,45,0.45)");
    // the content: its end, and anything scrolled to, stop above the band
    expect(style).toContain(
      `padding:20px 20px calc(20px + var(${PILL_ROOM_VAR}, 0px))`,
    );
    expect(style).toContain(
      `scroll-padding-bottom:var(${PILL_ROOM_VAR}, 0px)`,
    );
  });
});
