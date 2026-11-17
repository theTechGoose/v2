/**
 * REQ-867 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle dm4 (run rf5fcb8b9), issue m6: the customer (390×844, /dashboard) closed the
 * phone drawer while the presenter pointed at "Informes". The link was then at x = −244 inside
 * the off-canvas drawer, with document scrollWidth 390 = clientWidth 390 and scrollX 0. Even so,
 * the customer read "Alex señala a la izquierda — desplázate ←" and the stage read "You · pointing
 * to the left — the customer must scroll ←". `placeView` took its direction from geometry alone,
 * and nothing checked that a scroll could bring the point into view.
 * Now `scrollRoom` reads which ways the element's scrollers (the document included, unless a fixed
 * ancestor pins it) can still scroll. When the way to the point cannot be scrolled, `placeView`
 * marks the direction `hidden`, and `cueKey` / `ownCueKey` say "hidden — open the menu ☰" instead.
 */
import { assert, assertEquals } from "@std/assert";
import {
  type ClipNode,
  type ClipStyle,
  cueKey,
  ownCueKey,
  placeView,
  scrollRoom,
  visibleBox,
} from "../../shared/demo-mode/presenter-anchor.ts";

const lang = async (l: string) =>
  JSON.parse(
    await Deno.readTextFile(new URL(`../../lang/${l}.json`, import.meta.url)),
  ) as Record<string, string>;
const src = (p: string) =>
  Deno.readTextFile(new URL(`../${p}`, import.meta.url));

type N = ClipNode & { style: ClipStyle };
/** a node with a box, a style and its scroll metrics */
const node = (
  parent: N | null,
  rect: { left: number; top: number; width: number; height: number },
  style: ClipStyle = {},
  m: Partial<
    Pick<
      ClipNode,
      | "scrollLeft"
      | "scrollTop"
      | "scrollWidth"
      | "scrollHeight"
      | "clientWidth"
      | "clientHeight"
    >
  > = {},
): N => ({
  parentElement: parent,
  getBoundingClientRect: () => rect,
  style,
  scrollLeft: 0,
  scrollTop: 0,
  scrollWidth: rect.width,
  scrollHeight: rect.height,
  clientWidth: rect.width,
  clientHeight: rect.height,
  ...m,
});
const styleOf = (e: ClipNode) => (e as N).style;
const PHONE = { left: 0, top: 0, width: 390, height: 844 };

/** the report's page: html (390 wide, 2000 tall, scrolled to 0) › body › a fixed drawer
 *  translated off-canvas (x −280, 280 wide) › the "Informes" link at x −244 */
function drawerPage(drawerPos: "fixed" | "absolute" = "fixed") {
  const html = node(
    null,
    PHONE,
    { overflowX: "visible", overflowY: "visible" },
    {
      scrollWidth: 390,
      clientWidth: 390,
      scrollHeight: 2000,
      clientHeight: 844,
    },
  );
  const body = node(html, { left: 0, top: 0, width: 390, height: 2000 });
  const drawer = node(body, { left: -280, top: 0, width: 280, height: 844 }, {
    position: drawerPos,
  });
  const link = node(drawer, { left: -260, top: 300, width: 220, height: 40 });
  return { html, body, drawer, link };
}

Deno.test("REQ-867 (demo dm4 m6) unit: a point at x=-244 in a closed drawer, scrollWidth == clientWidth, scrollX 0 — no 'scroll ←' cue on either side", () => {
  const { link } = drawerPage();
  const room = scrollRoom(link, styleOf);
  assertEquals(room.left, false);
  const box = visibleBox(link, PHONE, styleOf);
  const v = placeView({ x: -244, y: 320 }, { ...box, room });
  assert(v.dir, "out of view: a direction");
  assertEquals(v.dir.dx, -1);
  assertEquals(v.dir.hidden, true);
  assert(cueKey(v.dir) !== "demoMode.pointerLeft", "customer told to scroll ←");
  assertEquals(cueKey(v.dir), "demoMode.pointerHidden");
  assert(
    ownCueKey(v.dir) !== "demoMode.pointerGhostCue.left",
    "stage told the customer must scroll ←",
  );
  assertEquals(ownCueKey(v.dir), "demoMode.pointerGhostCue.hidden");
});

Deno.test("REQ-867 (demo dm4 m6) unit: the same drawer laid out absolute on a page that cannot scroll sideways is hidden too; one the page can scroll to is not", () => {
  const { link } = drawerPage("absolute");
  assertEquals(scrollRoom(link, styleOf).left, false);
  const v = placeView({ x: -244, y: 320 }, {
    ...PHONE,
    room: scrollRoom(link, styleOf),
  });
  assertEquals(v.dir?.hidden, true);
  // the page scrolled 300 px right: a scroll ← brings it back — the scroll cue stays
  const html = node(null, PHONE, {}, {
    scrollLeft: 300,
    scrollWidth: 800,
    clientWidth: 390,
  });
  const row = node(
    node(html, { left: -300, top: 0, width: 800, height: 844 }),
    {
      left: -260,
      top: 300,
      width: 220,
      height: 40,
    },
  );
  const r = scrollRoom(row, styleOf);
  assertEquals(r.left, true);
  const w = placeView({ x: -244, y: 320 }, { ...PHONE, room: r });
  assertEquals(w.dir, { dx: -1, dy: 0 });
  assertEquals(cueKey(w.dir!), "demoMode.pointerLeft");
});

Deno.test("REQ-867 (demo dm4 m6) unit: below the fold of a page that scrolls — still 'scroll ↓'; in an inner scroller with room up — 'scroll ↑'; a fixed bar's child below the screen — hidden", () => {
  const { html, body } = drawerPage();
  const row = node(body, { left: 0, top: 1400, width: 390, height: 40 });
  const r = scrollRoom(row, styleOf);
  assertEquals(r.down, true);
  assertEquals(r.up, false);
  assertEquals(placeView({ x: 100, y: 1420 }, { ...PHONE, room: r }).dir, {
    dx: 0,
    dy: 1,
  });
  // an inner scroller scrolled 500 down, the document not
  const list = node(body, { left: 0, top: 100, width: 390, height: 600 }, {
    overflowY: "auto",
  }, { scrollTop: 500, scrollHeight: 1600, clientHeight: 600 });
  const item = node(list, { left: 0, top: -200, width: 390, height: 40 });
  const ri = scrollRoom(item, styleOf);
  assertEquals(ri.up, true);
  assertEquals(
    cueKey(placeView({ x: 100, y: -180 }, { ...PHONE, room: ri }).dir!),
    "demoMode.pointerAbove",
  );
  // a fixed sheet slid below the screen: scrolling the document cannot move it
  const sheet = node(body, { left: 0, top: 844, width: 390, height: 400 }, {
    position: "fixed",
  });
  const btn = node(sheet, { left: 20, top: 900, width: 100, height: 40 });
  assertEquals(scrollRoom(btn, styleOf).down, false);
  assertEquals(
    placeView({ x: 70, y: 920 }, { ...PHONE, room: scrollRoom(btn, styleOf) })
      .dir?.hidden,
    true,
  );
  void html;
});

Deno.test("REQ-867 (demo dm4 m6) unit: with no scroll metrics known (an old caller, no `room`), the way is as before", () => {
  const bare: ClipNode = {
    parentElement: null,
    getBoundingClientRect: () => PHONE,
  };
  const r = scrollRoom(bare, () => null);
  assertEquals(r, { left: true, right: true, up: true, down: true });
  assertEquals(placeView({ x: -244, y: 320 }, PHONE).dir, { dx: -1, dy: 0 });
});

Deno.test("REQ-867 (demo dm4 m6) unit: en and es word the hidden cue — the customer's names the presenter, the stage's own does not — and neither says scroll", async () => {
  for (const l of ["en", "es"]) {
    const d = await lang(l);
    const c = d["demoMode.pointerHidden"];
    const g = d["demoMode.pointerGhostCue.hidden"];
    assert(c, `${l} lacks demoMode.pointerHidden`);
    assert(g, `${l} lacks demoMode.pointerGhostCue.hidden`);
    assert(c.includes("{name}"), `${l} pointerHidden names no one`);
    assert(!g.includes("{name}"), `${l} pointerGhostCue.hidden names someone`);
    for (const s of [c, g]) {
      assert(!/scroll|despl|[←→↑↓]/i.test(s), `${l} "${s}" says scroll`);
      assert(s.includes("☰"), `${l} "${s}" does not point at the menu`);
    }
  }
});

Deno.test("REQ-867 (demo dm4 m6) integration: the customer's overlay and the stage's replay hand placeView the room to scroll (scrollRoom), and the stage keeps it through visOnStage", async () => {
  const overlay = await src("islands/DemoModeOverlay.tsx");
  assert(
    /room:\s*scrollRoom\(el as unknown as ClipNode, styleOf\)/.test(overlay),
    "DemoModeOverlay placeOnScreen does not read the scroll room",
  );
  const replay = await src("lib/demo-mode/mirror-replay.ts");
  assert(
    /room:\s*scrollRoom\(n as unknown as ClipNode, styleOf\)/.test(replay),
    "mirror-replay clipOf does not read the scroll room",
  );
  const stage = await src("islands/DemoStage.tsx");
  assert(
    /room:\s*c\.room/.test(stage),
    "DemoStage visOnStage drops the replay's scroll room",
  );
  // both callers still word the cue from placeView's dir
  assert(/cueKey\(p\.dir\)/.test(overlay));
  assert(/ownCueKey\(ghost\.dir\)/.test(stage));
});

Deno.test("REQ-867 (demo dm4 m6) integration: the customer's 'hidden' reaches the stage's ghost — placedReport → the wire → parsePeerMessage → reportedGhost keeps it, so the stage says hidden too", async () => {
  const { placedReport, reportedGhost } = await import(
    "../../shared/demo-mode/presenter-anchor.ts"
  );
  const { parsePeerMessage } = await import(
    "../../shared/demo-mode/protocol.ts"
  );
  const a = { vx: 0.5, vy: 0.5, n: { id: 7, x: 0.5, y: 0.5, l: "L1" } };
  const m = placedReport("p1", a as never, {
    at: { x: 0, y: 320 },
    outside: true,
    dir: { dx: -1, dy: 0, hidden: true },
  }, PHONE);
  const back = parsePeerMessage(JSON.parse(JSON.stringify(m)));
  assert(back && back.k === "placed", "the report does not parse back");
  const g = reportedGhost(
    { a, at: { x: 10, y: 10 } } as never,
    back as never,
    { left: 0, top: 0, width: 390, height: 844 },
  );
  assert(g?.dir, "no ghost chevron");
  assertEquals(g.dir.hidden, true);
  assertEquals(ownCueKey(g.dir), "demoMode.pointerGhostCue.hidden");
  // a scrollable way stays as it was on the wire: no `h`
  const plain = placedReport("p1", a as never, {
    at: { x: 0, y: 320 },
    outside: true,
    dir: { dx: -1, dy: 0 },
  }, PHONE);
  assertEquals(plain.d, { dx: -1, dy: 0 });
});
