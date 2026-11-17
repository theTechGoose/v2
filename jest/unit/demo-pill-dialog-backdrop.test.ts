/**
 * REQ-832 — demo-loop cycle dm2, issue p1 "Customer pill/folded chip covers page content (composer,
 * headings, footer, Log out) - re-check 9 NOT_FIXED". Raphael: "fix every issue the demo found,
 * loop until there are none".
 *
 * Demo 5 opened the send dialog at 1280×800: the pill "jumps to the bottom-left and EXPANDS over
 * Log out". The overlay's counters (pageAt / countControls) asked only the TOPMOST element at each
 * sample point; under a dialog that is its full-screen backdrop (fixed, inset 0, a see-through dim),
 * which is too big to count as page (PAGE_BACKDROP_AREA) and is not a control. So every spot
 * outside the dialog's panel read as clear, dockPill returned home, and the pill sat over the
 * sidebar's Log out — breaking REQ-818's "never Log out" whenever a dialog is up.
 *
 * The counters now look THROUGH the backdrop (`pastBackdrop`): the dialog's own layer counts as
 * before, and beneath the dim only controls count (REQ-818: covering text stays allowed).
 */
import * as fs from "fs";
import * as path from "path";
import {
  pastBackdrop,
  pillHome,
  placePill,
} from "../../shared/demo-mode/pill.ts";

type Rect = { left: number; top: number; width: number; height: number };

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const view = { w: 1280, h: 800 };
const overlap = (a: Rect, b: Rect) =>
  a.left < b.left + b.width && b.left < a.left + a.width &&
  a.top < b.top + b.height && b.top < a.top + a.height;
const inside = (x: number, y: number, r: Rect) =>
  x >= r.left && x < r.left + r.width && y >= r.top && y < r.top + r.height;

/** a tiny DOM: each node has a box, a parent, and whether it is a control */
interface Node {
  id: string;
  box: Rect;
  parent: Node | null;
  control?: boolean;
  dialog?: boolean;
}
const node = (
  id: string,
  box: Rect,
  parent: Node | null,
  extra: Partial<Node> = {},
): Node => ({ id, box, parent, ...extra });
const holds = (a: Node, b: Node) => {
  for (let n: Node | null = b.parent; n; n = n.parent) if (n === a) return true;
  return false;
};
const closest = (n: Node, f: (n: Node) => boolean) => {
  for (let c: Node | null = n; c; c = c.parent) if (f(c)) return c;
  return null;
};

// /customers at 1280×800 with the send dialog open (assistant-page.css: the backdrop is
// position:fixed; inset:0; background rgba(20,44,48,.45), the panel centred in it)
const full = { left: 0, top: 0, width: 1280, height: 800 };
const html = node("html", full, null);
const body = node("body", full, html);
const sidebar = node(
  "sidebar",
  { left: 0, top: 0, width: 228, height: 800 },
  body,
);
const logout = node(
  "logout",
  { left: 16, top: 742, width: 196, height: 42 },
  sidebar,
  { control: true },
);
const heading = node(
  "heading",
  { left: 260, top: 20, width: 600, height: 40 },
  body,
);
const topActions = node(
  "new-customer",
  { left: 1100, top: 20, width: 160, height: 40 },
  body,
  { control: true },
);
const layer = node("dialog-layer", full, body);
const backdrop = node("backdrop", full, layer);
const panel = node(
  "panel",
  { left: 400, top: 200, width: 480, height: 400 },
  backdrop,
  { dialog: true },
);
const send = node(
  "send",
  { left: 700, top: 540, width: 160, height: 40 },
  panel,
  { control: true },
);
// top to bottom at a point, like document.elementsFromPoint
const paintOrder = [
  send,
  panel,
  backdrop,
  layer,
  logout,
  topActions,
  heading,
  sidebar,
  body,
  html,
];
const stackAt = (x: number, y: number) =>
  paintOrder.filter((n) => inside(x, y, n.box));

const samples = (r: Rect) => {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 12; i++) {
    for (let j = 0; j <= 2; j++) {
      pts.push([
        r.left + 1 + ((r.width - 2) * i) / 12,
        r.top + 1 + ((r.height - 2) * j) / 2,
      ]);
    }
  }
  return pts;
};

/** what the overlay counts under a box: the dialog's layer whole, beneath the dim controls only */
const seen = (r: Rect, onlyControls: boolean) => {
  const found = new Set<Node>();
  for (const [x, y] of samples(r)) {
    const hit = pastBackdrop(stackAt(x, y), backdrop, holds);
    if (!hit) continue;
    const c = closest(hit.el, (n) => !!n.control);
    if (c) found.add(c);
    else if (!onlyControls && !hit.under) {
      const d = closest(hit.el, (n) => !!n.dialog);
      if (d) found.add(d);
    }
  }
  return found.size;
};

describe("REQ-832 (demo-loop cycle dm2, p1) — under a dialog the pill is placed against the page beneath the backdrop", () => {
  test("REQ-832 pastBackdrop: the dialog's own layer is taken as is, never flagged as under", () => {
    const hit = pastBackdrop(stackAt(780, 560), backdrop, holds);
    expect(hit?.el.id).toBe("send");
    expect(hit?.under).toBe(false);
  });

  test("REQ-832 pastBackdrop: outside the panel it skips the backdrop and the boxes that hold it, and finds the page beneath", () => {
    const hit = pastBackdrop(stackAt(40, 763), backdrop, holds);
    expect(hit?.el.id).toBe("logout");
    expect(hit?.under).toBe(true);
    // the dialog layer that holds the backdrop, body and html are skipped too: bare page → nothing
    const bare = pastBackdrop(
      [backdrop, layer, body, html],
      backdrop,
      holds,
    );
    expect(bare).toBeUndefined();
  });

  test("REQ-832 pastBackdrop: no dialog up → the topmost element, as before", () => {
    const hit = pastBackdrop(stackAt(40, 763), null, holds);
    expect(hit?.el.id).toBe("backdrop");
    expect(hit?.under).toBe(false);
  });

  test("REQ-832 the send dialog open at 1280×800: the pill (whole or folded) does not land over Log out", () => {
    const h = pillHome({ view, size: { w: 520, h: 43 } });
    // demo 5's spot: home is bottom-left, over Log out
    expect(overlap(h.box, logout.box)).toBe(true);
    const p = placePill({
      home: h.box,
      view,
      dialog: true,
      dialogBox: panel.box,
      blocked: (r) => seen(r, false),
      controls: (r) => seen(r, true),
    });
    expect(overlap(p.box, logout.box)).toBe(false);
    expect(overlap(p.box, panel.box)).toBe(false);
    expect(seen(p.box, true)).toBe(0);
  });

  test("REQ-832 the overlay's counters look through the dialog's backdrop (pageAt, countControls)", () => {
    const src = read("front-end/islands/DemoModeOverlay.tsx");
    const fn = (name: string) => {
      const at = src.indexOf(`function ${name}(`);
      expect(at).toBeGreaterThan(-1);
      return src.slice(at, src.indexOf("\n}\n", at));
    };
    // both ask `hitAt`, which walks the point's stack through the backdrop
    expect(fn("hitAt")).toMatch(/pastBackdrop\(/);
    expect(fn("pageAt")).toMatch(/hitAt\(x, y, backdrop\)/);
    expect(fn("countControls")).toMatch(/hitAt\(x, y, backdrop\)/);
    // the placement hands the backdrop it found to both counters
    expect(src).toMatch(/blocked:[^\n]*pageUnder\([^\n]*backdrop/);
    expect(src).toMatch(/controls:[^\n]*countControls\([^\n]*backdrop/);
  });
});
