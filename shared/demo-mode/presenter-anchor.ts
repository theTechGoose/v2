/**
 * REQ-451 (demo-loop cycle 3, M1 + M14) — the presenter's pointer is WHAT HE POINTED AT, in pure
 * terms the stage, the customer's overlay and the pointer share. Amends REQ-393, which made it
 * "the spot under his still mouse", looked up again after every layout pass of the replay: the
 * customer's arrow stayed at one screen spot over whatever scrolled or loaded under it, and with
 * his mouse beside a phone frame the whole arrow and his name sat on the phone's edge.
 *
 *   - `anchorPoint`: where an anchor is drawn on a screen — a node anchor on its node only (the
 *     page load it names is the one shown, the node is still in the page and laid out), never at
 *     its old fraction: that spot, on another page or before the page moved, is over something
 *     else now. An anchor naming no element is a fraction; an off anchor is its edge's point.
 *   - `resendable`: the anchor sent again to a page that joined or was mirrored afresh — only when
 *     it was made on that very page load (a tab followed again, its page unchanged), or when it is
 *     his mouse beside the frame (it names no element of any page); a new page gets nothing else
 *     until he moves.
 *   - `lookAgain`: a layout pass looks his still mouse up again only for a fraction made before
 *     the replay could name a node there, once that page's replay has SETTLED (its stylesheets,
 *     web fonts and images in: before that the node under his mouse is not the one under it on
 *     their screen — a logo with no height yet put the Continue button under the middle of the
 *     phone, and the arrow stayed on it); and while his mouse is beside the frame (where it meets
 *     the frame's edge moves with the frame).
 *     REQ-538 (cycle 4 M1) — and a node anchor that died (another page load shown, its node gone:
 *     a card swapped or flipped) once that replay has settled: looked up once under his still
 *     mouse; `pointerAbsent` tells the stage his arrow is not on their screen meanwhile.
 *   - `seedOn`: the mouse handed over by the page that opened the stage counts only on the frame.
 *     REQ-539 (cycle 4, m24) — `seedUse`: and only the stage's own hand-off (a reload) is sent;
 *     /admin's is where his mouse is, not what he points at — a hint for the stage only.
 *   - `ghostAt`: where the stage draws his arrow as their screen has it, faint, when that is apart
 *     from where he put it (their page moved it with its element, or the frame moved).
 *   - `offEdge`, `offMark`: a pointer off their screen is a small translucent marker against the
 *     edge it is off, pointing that way — no arrow, no name tag over their controls.
 *
 * REQ-645 (demo-loop cycle 5, M1 + M2 + m36 + c4-M6) — supersedes REQ-538's look-up under his
 * still mouse: the arrow was put on whatever the new content had at that spot ("or a person?"
 * where "Lock it in" was, "Back" for "Dashboard", empty space on another tab). An anchor carries
 * the PRINT of the node it names (`printOf`: tag, data-cy, role, a link's address, its accessible
 * name); a dead anchor (`anchorDead`) is re-found only as the ONE laid-out node with that print
 * (`pickByPrint`), as soon as the replay shown is styled and for at most REANCHOR_CAP_MS
 * (`seekPrint`, `reanchored`) — else no arrow, and the stage keeps saying so (`pointerAbsent`,
 * which now also counts nothing held: the demo's start, another tab followed). Another browser tab
 * followed drops his anchor and keeps it for its page load (`tabSwitched`, `keepHeld`,
 * `keptFor`). On their screen: an element out of view is a chevron at the edge of the box it can
 * be seen in — the page's scroller under its topbar, above the pill's band (`visibleBox`,
 * `placeView`, `cueKey`) — never an arrow over the app's chrome; an arrow whose element moved more
 * than DRIFT_FADE_PX since he pointed is faded (`drifted`); `pending` ("pointing…", PENDING_MS) is
 * what a fraction the replay could not name a node for becomes on the wire.
 *   - REQ-642 (cycle 5, m10 + setup-14d) — the ghost is a REPORT, not a guess: the customer's
 *     overlay says where it placed each presenter's arrow (`placedReport`, rate-limited per
 *     presenter by `placedReporter`), and the stage draws the ghost from that (`reportedGhost`) —
 *     its own replay put it elsewhere (the top edge while their arrow was mid-page). And the
 *     stage always draws his own small marker where he pointed (`ownAt`), in his colour, "You".
 *   - REQ-635 (demo m37, cycle 5): `offBadge`, `initialOf` — the marker carries the sender's
 *     initial on a dot in their colour (a bare chevron read as a stray '<'), is shown for
 *     OFF_MARK_SHOW_MS then fades out over OFF_MARK_FADE_MS, and on the customer's screen sits at
 *     OFF_MARK_Z, under the app's modal dims.
 */
import {
  ARROW_BOX,
  initialsOf,
  type MoveThrottle,
  moveThrottle,
  outsideBox,
  placeIn,
  type Pt,
  TAG_EDGE,
  TAG_GAP,
  type TagSide,
} from "./motion.ts";
import {
  type Anchor,
  fracToPoint,
  type NodeAnchor,
  type PlacedMessage,
  type Rect,
  sameAnchor,
} from "./protocol.ts";

/** what this presenter points at, as the stage keeps it */
export interface Held {
  /** the anchor as last sent (null: none — not pointed yet, or his mouse left the window) */
  a: Anchor | null;
  /** the customer's page load the replay showed when it was made (null: none shown) */
  load: string | null;
  /** where on the stage his mouse was when it was made */
  at: Pt | null;
  /** a bare fraction made only because the replay could not name a node yet */
  provisional: boolean;
  /** REQ-645 — what the node it names IS (null: it names none, or nothing to tell it by) */
  print?: NodePrint | null;
}

/** REQ-645 — what an element IS, as any replay of the customer's page can tell it: its tag, its
 *  data-cy, its role, a link's address and its accessible name — never where it is */
export interface NodePrint {
  /** its tag, lower case */
  t: string;
  /** its data-cy */
  cy?: string;
  /** its role attribute */
  r?: string;
  /** a link's address */
  h?: string;
  /** its accessible name: aria-label, title, an image's alt, a field's name or placeholder, else
   *  its text (whitespace collapsed, at most PRINT_TEXT_MAX characters) */
  nm?: string;
}

/** REQ-645 — the bits of a node a print reads (a DOM node, the replay's, or a test double) */
export interface PrintNode {
  nodeType: number;
  localName?: string;
  getAttribute?(name: string): string | null;
  childNodes: ArrayLike<PrintNode>;
  data?: string;
}

/** REQ-645 — the most of an element's text its print keeps */
export const PRINT_TEXT_MAX = 80;
const FIELDS = new Set(["input", "select", "textarea"]);
/** never part of an element's words: a style's rules, a script, a template */
const NO_TEXT = new Set(["style", "script", "template", "noscript"]);
const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** the element's own words, gathered only until there are PRINT_TEXT_MAX of them */
function textOf(n: PrintNode): string | undefined {
  let out = "";
  const walk = (m: PrintNode): boolean => {
    const kids = m.childNodes;
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i];
      if (c.nodeType === 3) {
        out += c.data ?? "";
        if (collapse(out).length > PRINT_TEXT_MAX) return true;
      } else if (
        c.nodeType === 1 && !NO_TEXT.has((c.localName ?? "").toLowerCase())
      ) {
        out += " ";
        if (walk(c)) return true;
      }
    }
    return false;
  };
  walk(n);
  const t = collapse(out).slice(0, PRINT_TEXT_MAX).trim();
  return t || undefined;
}

/** REQ-645 — the print of an element (null: not an element) */
export function printOf(n: PrintNode | null | undefined): NodePrint | null {
  if (!n || n.nodeType !== 1 || !n.localName || !n.getAttribute) return null;
  const get = n.getAttribute.bind(n);
  const at = (k: string): string | undefined => {
    const v = get(k);
    const c = v === null || v === undefined ? "" : collapse(v);
    return c || undefined;
  };
  const t = n.localName.toLowerCase();
  const p: NodePrint = { t };
  const cy = at("data-cy");
  if (cy) p.cy = cy;
  const r = at("role");
  if (r) p.r = r;
  if (t === "a") {
    const h = at("href");
    if (h) p.h = h;
  }
  const nm = at("aria-label") ?? at("title") ??
    (t === "img" ? at("alt") : undefined) ??
    (FIELDS.has(t) ? at("name") ?? at("placeholder") : undefined) ??
    textOf(n);
  if (nm) p.nm = nm;
  return p;
}

/** REQ-645 — two prints of the same element: every part equal */
export function samePrint(
  a: NodePrint | null | undefined,
  b: NodePrint | null | undefined,
): boolean {
  if (!a || !b) return false;
  return a.t === b.t && (a.cy ?? "") === (b.cy ?? "") &&
    (a.r ?? "") === (b.r ?? "") && (a.h ?? "") === (b.h ?? "") &&
    (a.nm ?? "") === (b.nm ?? "");
}

/** REQ-645 — a print tells an element by something: its data-cy, a link's address or its name
 *  (a bare <div> names nothing — never looked for) */
export function printable(p: NodePrint | null | undefined): p is NodePrint {
  return !!p && !!(p.cy || p.h || p.nm);
}

/** REQ-645 — the ONE laid-out node of `nodes` whose print is `p`: the same print; else, for a print
 *  with a data-cy, the same tag, data-cy, role and address (its words changed: a count, the
 *  language). None, or more than one alike, is null — the arrow is never put on one by chance */
export function pickByPrint<N>(
  p: NodePrint,
  nodes: Iterable<N>,
  printFn: (n: N) => NodePrint | null,
  laidOut: (n: N) => boolean,
): N | null {
  if (!printable(p)) return null;
  const exact: N[] = [];
  const byCy: N[] = [];
  for (const n of nodes) {
    const q = printFn(n);
    if (!q || q.t !== p.t) continue;
    const same = samePrint(p, q);
    const sameCy = !!p.cy && q.cy === p.cy && (q.r ?? "") === (p.r ?? "") &&
      (q.h ?? "") === (p.h ?? "");
    if ((!same && !sameCy) || !laidOut(n)) continue;
    if (same) exact.push(n);
    if (sameCy) byCy.push(n);
  }
  if (exact.length === 1) return exact[0];
  if (exact.length === 0 && byCy.length === 1) return byCy[0];
  return null;
}

/** a node anchor's point inside its element's box; null when there is no box with an area (the
 *  element is not in the page, or not laid out: a closed menu) */
export function pointInBox(
  n: { x: number; y: number },
  r: Rect | null,
): Pt | null {
  if (!r || !(r.width > 0) || !(r.height > 0)) return null;
  return { x: r.left + r.width * n.x, y: r.top + r.height * n.y };
}

/** where an anchor is drawn on a screen that shows page load `load` in `view`; null: nowhere.
 *  `pointOfNode` finds a node of that load on this screen (null when it is not there) */
export function anchorPoint(
  a: Anchor,
  view: Rect,
  load: string | null,
  pointOfNode: (n: NodeAnchor) => Pt | null,
): Pt | null {
  if (!a.n) return fracToPoint(a, view);
  if (!a.n.l || a.n.l !== load) return null;
  return pointOfNode(a.n);
}

/** the anchor to send again to page load `load` (it just joined, or was mirrored afresh): the
 *  held one when it was made on that load, or when it is his mouse beside the frame (the marker on
 *  their screen's edge names no element of any page) — else null, nothing until he moves */
export function resendable(h: Held, load: string | null): Anchor | null {
  if (!h.a || load === null) return null;
  return h.a.o === 1 || h.load === load ? h.a : null;
}

/** whether a layout pass of the replay (showing `shown`) looks his still mouse up again: his mouse
 *  beside the frame (the frame may have moved: the marker goes where his mouse meets its edge now),
 *  or a provisional fraction made on the page shown, once that page's replay has settled.
 *  REQ-645 (cycle 5 M1) — never a node anchor, dead or alive: REQ-538 looked a dead one up again
 *  under his still mouse and put the arrow on whatever the new content had there; a dead anchor
 *  is re-found by its print instead (`seekPrint`). `alive` is no longer read. */
export function lookAgain(
  h: Held,
  shown: { load: string | null; settled: boolean; alive?: boolean },
): boolean {
  if (h.a?.o === 1) return true;
  if (h.a?.n) return false;
  return h.provisional && h.load !== null && h.load === shown.load &&
    shown.settled;
}

/** REQ-645 — his node anchor is DEAD on the replay shown: another page load is shown (or none), or
 *  its node no longer resolves there (`alive` false: a card swapped, a button replaced). A fraction
 *  or the off edge never dies; `alive` unknown counts as alive */
export function anchorDead(
  h: Held,
  shown: { load: string | null; alive?: boolean },
): boolean {
  const n = h.a?.n;
  if (!n || h.a?.o === 1) return false;
  return shown.load === null || h.load !== shown.load || n.l !== shown.load ||
    shown.alive === false;
}

/** REQ-645 — how long after his anchor was found dead on a styled replay the stage looks for its
 *  node by its print: the dark window after a page change is at most this */
export const REANCHOR_CAP_MS = 1_000;
/** REQ-645 — how soon a look that found nothing is tried again (the node may come a moment later) */
export const SEEK_RETRY_MS = 150;

/** REQ-645 — whether a layout pass looks for a dead anchor's node by its print: the anchor is dead,
 *  its print tells the node by something, the replay shown is STYLED (a hidden copy has no box
 *  then; no wait for its fonts and images — the print is no position), and it is no more than
 *  REANCHOR_CAP_MS since it was found dead (`deadForMs`) */
export function seekPrint(
  h: Held,
  shown: { load: string | null; styled?: boolean; alive?: boolean },
  deadForMs: number,
): boolean {
  if (!anchorDead(h, shown) || shown.load === null || !shown.styled) {
    return false;
  }
  return printable(h.print) && deadForMs <= REANCHOR_CAP_MS;
}

/** REQ-813 (demo dm1 m4) — the look by the print gave up: the anchor is dead on a styled replay,
 *  its print tells the node by something, and REANCHOR_CAP_MS passed with no match. The stage
 *  then tells the customer's page to stop saying "pointing…" (`{k:"leave"}`) at that moment */
export function seekGaveUp(
  h: Held,
  shown: { load: string | null; styled?: boolean; alive?: boolean },
  deadForMs: number,
): boolean {
  if (!anchorDead(h, shown) || shown.load === null || !shown.styled) {
    return false;
  }
  return printable(h.print) && deadForMs > REANCHOR_CAP_MS;
}

/** REQ-645 — his anchor on the node found by its print: that node of the page load shown, at the
 *  same spot of its box he pointed at (`at`: that spot as a fraction of their screen now) */
export function reanchored(
  h: Held,
  id: number,
  load: string,
  at: { vx: number; vy: number },
): Anchor {
  const n = h.a?.n;
  return {
    vx: at.vx,
    vy: at.vy,
    n: { id, x: n?.x ?? 0.5, y: n?.y ?? 0.5, l: load },
  };
}

/** REQ-538 — whether the stage tells him his arrow is not on their screen: he holds a node anchor
 *  that is not drawn there (`alive` false: another page, its node gone) — until he moves, or it is
 *  re-found by its print. REQ-645 (cycle 5 M2) — and when he holds nothing (the demo's start: the
 *  hand-off from /admin is never sent; his mouse left the window; another tab followed): the stage
 *  tells him to move onto their screen. A provisional fraction ("pointing…") and the off edge
 *  (said by its own hint) are not */
export function pointerAbsent(h: Held, alive: boolean): boolean {
  if (!h.a) return true;
  return !!h.a.n && h.a.o !== 1 && !alive;
}

/** REQ-813 (demo dm1 m4) — how the stage draws his own marker, so it says what the customer has:
 *  "pending" while their page says "{name} is pointing…" (the stage's pending window), "absent"
 *  while his arrow is not on their screen (`pointerAbsent`: dimmed, hollow, "not shown"), else
 *  "live" (full strength) */
export type OwnLook = "live" | "absent" | "pending";
export function ownLook(absent: boolean, pending: boolean): OwnLook {
  if (pending) return "pending";
  return absent ? "absent" : "live";
}
/** REQ-813 — the strength of his own marker while it is not on their screen */
export const OWN_ABSENT_OPACITY = 0.4;

/** REQ-645 — how far an arrow's point may move from where it was drawn when he pointed (his mouse
 *  still: a card grew, the page moved) before it is faded: on another control by then */
export const DRIFT_FADE_PX = 40;
/** REQ-645 — a faded arrow and its tag */
export const DRIFT_OPACITY = 0.4;

/** REQ-645 — the arrow drawn at `now` moved past DRIFT_FADE_PX from `from` (where it was when he
 *  pointed; none when it was out of view then — scrolled to, it is what he points at) */
export function drifted(from: Pt | null | undefined, now: Pt): boolean {
  return !!from && Math.hypot(now.x - from.x, now.y - from.y) > DRIFT_FADE_PX;
}

/** REQ-645 — how long their screen says "{name} is pointing…" when nothing follows a `pending` */
export const PENDING_MS = 2_500;

/** REQ-645 (m36) — the stage now follows ANOTHER browser tab of the customer's: both keys known and
 *  different (the same tab's next page keeps its key) */
export function tabSwitched(
  was: string | null | undefined,
  now: string | null | undefined,
): boolean {
  return !!was && !!now && was !== now;
}

/** REQ-645 (m36) — the browser tab the stage follows, as the transport names its sockets: `follow`
 *  — another socket of theirs followed, with its tab's key when its claim said it first; `learn` —
 *  the followed socket's key, said by its claim AFTER the stage followed it (a socket is announced
 *  before its page says which tab it is). Each answers whether the stage shows ANOTHER browser tab
 *  than before (`tabSwitched` against the last key known). `unsure` — another socket is followed and
 *  which tab it is of is not known yet: nothing of his is sent to it or looked for on it until it is.
 *  REQ-823 (demo-loop cycle dm1, m8) — `shown`: the followed socket's page is on show (the replay's
 *  onShown). A socket followed and left before any page of it was on show is no tab he saw: the
 *  next follow is weighed against the tab last on show — A → B (never on show) → A is no switch,
 *  so the stage's own detour is never said as "Now showing {name}'s other tab" */
export function followTabs(): {
  follow(cid: string | undefined, key?: string): boolean;
  learn(cid: string, key: string): boolean;
  shown(): void;
  unsure(): boolean;
} {
  let cid: string | undefined;
  let key: string | undefined;
  /** the key of what was followed before `cid`, while `cid`'s own is not known */
  let before: string | undefined;
  /** REQ-823 — the key of the browser tab whose page was last on show; and whether a page of the
   *  socket followed now has been on show */
  let seenKey: string | undefined;
  let seen = false;
  return {
    follow(c, k) {
      if (c === cid) return false;
      const was = seen || seenKey === undefined ? key ?? before : seenKey;
      cid = c;
      key = k;
      seen = false;
      before = k ? undefined : was;
      return tabSwitched(was, k);
    },
    learn(c, k) {
      if (c !== cid || key) return false;
      key = k;
      if (seen) seenKey = k;
      const was = before;
      before = undefined;
      return tabSwitched(was, k);
    },
    shown() {
      seen = true;
      if (key) seenKey = key;
    },
    unsure: () => !key && !!before,
  };
}

/** REQ-645 (m36) — the anchors kept per page load: so many of the newest */
export const KEEP_MAX = 8;

/** REQ-645 (m36) — his node anchor kept for the page load it was made on (another tab followed:
 *  it comes back only to that load); the oldest goes past KEEP_MAX */
export function keepHeld(kept: Map<string, Held>, h: Held): void {
  if (!h.a?.n || h.a.o === 1 || h.load === null || h.a.n.l !== h.load) return;
  kept.delete(h.load);
  kept.set(h.load, h);
  while (kept.size > KEEP_MAX) kept.delete(kept.keys().next().value!);
}

/** REQ-645 (m36) — the anchor kept for page load `load`, or null */
export function keptFor(
  kept: Map<string, Held>,
  load: string | null,
): Held | null {
  return load === null ? null : kept.get(load) ?? null;
}

/** REQ-645 — which way an anchor out of view is: -1 left / up, 1 right / down, 0 neither */
export interface Dir {
  dx: -1 | 0 | 1;
  dy: -1 | 0 | 1;
  /** REQ-867 (demo dm4 m6) — no scroll can bring it into view that way (an item in a closed
   *  off-canvas drawer): the cue says it is hidden, never "scroll" */
  hidden?: true;
}

/** REQ-867 (demo dm4 m6) — which ways an element's scrollers can still scroll (`scrollRoom`) */
export interface Room {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
}

/** REQ-645 — where an anchor's point `p` is drawn against `box`, the box its element can be seen
 *  in (`visibleBox`): the point itself when it is inside; else the box's edge nearest to it (the
 *  whole arrow box inside, `placeIn`), `outside`, and which way the element is (`dir`) — drawn as
 *  a chevron with a cue there, never an arrow over the page's chrome */
export function placeView(
  p: Pt,
  box: Rect & { room?: Room | null },
  arrow: { w: number; h: number } = ARROW_BOX,
): { at: Pt; outside: boolean; dir: Dir | null } {
  if (!outsideBox(p, box)) {
    return { at: { x: p.x, y: p.y }, outside: false, dir: null };
  }
  const dx = p.x < box.left ? -1 : p.x > box.left + box.width ? 1 : 0;
  const dy = p.y < box.top ? -1 : p.y > box.top + box.height ? 1 : 0;
  // REQ-867 (demo dm4 m6) — a way no scroller can go (`box.room`, from `scrollRoom`): hidden
  const r = box.room;
  const stuck = !!r &&
    ((dx < 0 && !r.left) || (dx > 0 && !r.right) ||
      (dy < 0 && !r.up) || (dy > 0 && !r.down));
  const dir: Dir = stuck ? { dx, dy, hidden: true } : { dx, dy };
  return { ...placeIn(p, box, arrow), dir };
}

/** REQ-645 — the words for the way to an element out of view (up / down first) */
export function cueKey(
  dir: { dx: number; dy: number; hidden?: boolean },
):
  | "demoMode.pointerHidden"
  | "demoMode.pointerBelow"
  | "demoMode.pointerAbove"
  | "demoMode.pointerRight"
  | "demoMode.pointerLeft" {
  // REQ-867 (demo dm4 m6) — nothing can scroll to it: never "scroll ←"
  if (dir.hidden) return "demoMode.pointerHidden";
  if (dir.dy > 0) return "demoMode.pointerBelow";
  if (dir.dy < 0) return "demoMode.pointerAbove";
  return dir.dx < 0 ? "demoMode.pointerLeft" : "demoMode.pointerRight";
}

/**
 * REQ-843 (demo-loop cycle dm3, p15) — the stage's own ghost's words for the way to its element:
 * second person, no name ("You · pointing below — the customer must scroll ↓"). The customer's
 * `cueKey` words ("{name} is pointing below") stay for colleagues' pointers on the stage.
 */
export function ownCueKey(
  dir: { dx: number; dy: number; hidden?: boolean },
):
  | "demoMode.pointerGhostCue.hidden"
  | "demoMode.pointerGhostCue.below"
  | "demoMode.pointerGhostCue.above"
  | "demoMode.pointerGhostCue.right"
  | "demoMode.pointerGhostCue.left" {
  if (dir.hidden) return "demoMode.pointerGhostCue.hidden"; // REQ-867 (demo dm4 m6)
  if (dir.dy > 0) return "demoMode.pointerGhostCue.below";
  if (dir.dy < 0) return "demoMode.pointerGhostCue.above";
  return dir.dx < 0
    ? "demoMode.pointerGhostCue.left"
    : "demoMode.pointerGhostCue.right";
}

/** REQ-645 — the bits of an element `visibleBox` reads */
export interface ClipNode {
  parentElement: ClipNode | null;
  getBoundingClientRect(): Rect;
  /** its element children (a bar pinned over its other children: a sticky topbar) */
  children?: ArrayLike<ClipNode>;
  /** REQ-867 — its scroll metrics, as `scrollRoom` reads them (absent: unknown) */
  scrollLeft?: number;
  scrollTop?: number;
  scrollWidth?: number;
  scrollHeight?: number;
  clientWidth?: number;
  clientHeight?: number;
}
/** REQ-645 — the bits of its computed style `visibleBox` reads */
export interface ClipStyle {
  overflowX?: string;
  overflowY?: string;
  position?: string;
}
const clips = (o: string | undefined) => !!o && o !== "visible";

/** REQ-645 (c4-M6) — the part of `screen` where `el` can be seen: cut down by every ancestor that
 *  clips its overflow (the app's `.content` scroller under its topbar, on a wide screen) and by
 *  every bar pinned over the content beside it (a phone's sticky topbar over the scrolled page; a
 *  fixed bar at the bottom) — so a row scrolled up under the topbar is out of view, never
 *  "visible" over its search bar. A fixed element, or one under a fixed ancestor, is clipped by
 *  nothing above that.
 *  REQ-814 (demo dm1 m7) — a bar is judged against the screen (and the scrollers), never the box
 *  already narrowed by a clipping card: a card scrolled partly or fully out of view is still cut
 *  by the topbar. When the clipping ancestors leave nothing (the card is wholly out of view), the
 *  box is the outer one — the screen cut by the bars and the scrollers only — never a box at
 *  top 0 with no height (a chevron drawn over the topbar) */
export function visibleBox(
  el: ClipNode,
  screen: Rect,
  styleOf: (e: ClipNode) => ClipStyle | null,
): Rect {
  type B = { left: number; top: number; right: number; bottom: number };
  const empty = (b: B) => b.right <= b.left || b.bottom <= b.top;
  const full = (): B => ({
    left: screen.left,
    top: screen.top,
    right: screen.left + screen.width,
    bottom: screen.top + screen.height,
  });
  /** cut by every clipping ancestor and bar */
  const inner = full();
  /** cut by the bars and the scrollers only (a scroller that would leave nothing is skipped) */
  const outer = full();
  const scrolls = (o: string | undefined) =>
    o === "auto" || o === "scroll" || o === "overlay";
  /** a bar `r` covering `b`'s top or bottom edge cuts that strip off it */
  const cut = (b: B, r: Rect) => {
    if (r.top <= b.top + 1 && r.top + r.height > b.top) {
      b.top = Math.max(b.top, r.top + r.height);
    } else if (r.top + r.height >= b.bottom - 1 && r.top < b.bottom) {
      b.bottom = Math.min(b.bottom, r.top);
    }
  };
  const spans = (b: B, r: Rect) =>
    !empty(b) && r.left <= b.left + 1 && r.left + r.width >= b.right - 1;
  /** a sticky or fixed sibling of `child` that spans the box's width and sits at its top or its
   *  bottom edge covers that strip (never a full-screen layer, a floating button, or a sticky
   *  header mid-page, in its place in the flow) */
  const bars = (a: ClipNode, child: ClipNode) => {
    const kids = a.children;
    if (!kids) return;
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      if (k === child) continue;
      const pos = styleOf(k)?.position;
      if (pos !== "sticky" && pos !== "fixed") continue;
      const r = k.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      if (!spans(outer, r) && !spans(inner, r)) continue;
      if (r.height * 2 >= screen.height) continue;
      cut(outer, r);
      cut(inner, r);
    }
  };
  if (styleOf(el)?.position !== "fixed") {
    let child = el;
    for (let a = el.parentElement; a; child = a, a = a.parentElement) {
      bars(a, child);
      const s = styleOf(a);
      if (!s) continue;
      const cx = clips(s.overflowX);
      const cy = clips(s.overflowY);
      if (cx || cy) {
        const r = a.getBoundingClientRect();
        const narrow = (b: B, x: boolean, y: boolean) => {
          if (x) {
            b.left = Math.max(b.left, r.left);
            b.right = Math.min(b.right, r.left + r.width);
          }
          if (y) {
            b.top = Math.max(b.top, r.top);
            b.bottom = Math.min(b.bottom, r.top + r.height);
          }
        };
        narrow(inner, cx, cy);
        const sx = scrolls(s.overflowX);
        const sy = scrolls(s.overflowY);
        if (sx || sy) {
          const next = { ...outer };
          narrow(next, sx, sy);
          if (!empty(next)) Object.assign(outer, next);
        }
      }
      if (s.position === "fixed") break;
    }
  }
  const b = empty(inner) ? outer : inner;
  return {
    left: b.left,
    top: b.top,
    width: Math.max(0, b.right - b.left),
    height: Math.max(0, b.bottom - b.top),
  };
}

/** REQ-867 (demo dm4 m6) — which ways a scroll can still move `el`: every ancestor that scrolls on
 *  an axis (overflow auto / scroll / overlay) with room left that way — `scrollLeft > 0` for
 *  left, `scrollWidth − clientWidth − scrollLeft > 0` for right, the same for up / down — and the
 *  document (the root, unless its overflow, or the body's it takes, is hidden). A fixed element,
 *  or one under a fixed ancestor, is moved by nothing above it, so an item in a closed off-canvas
 *  drawer (fixed, translated off the screen; or on a page as wide as the screen at scrollX 0) can
 *  be scrolled to no way at all. With no scroll metrics on `el` (a bare box, not an element) every
 *  way is open, as before. */
export function scrollRoom(
  el: ClipNode,
  styleOf: (e: ClipNode) => ClipStyle | null,
): Room {
  const open: Room = { left: true, right: true, up: true, down: true };
  // a real element always has its metrics; a caller's bare box has none: unknown, every way open
  if (typeof el.scrollWidth !== "number") return open;
  const room: Room = { left: false, right: false, up: false, down: false };
  const scrolls = (o: string | undefined) =>
    o === "auto" || o === "scroll" || o === "overlay";
  const add = (a: ClipNode, x: boolean, y: boolean) => {
    const n = (v: number | undefined) => typeof v === "number" && isFinite(v);
    if (!n(a.scrollWidth) || !n(a.clientWidth)) return;
    const sl = Math.abs(a.scrollLeft ?? 0);
    const st = a.scrollTop ?? 0;
    if (x) {
      if (sl > 0.5) room.left = true;
      if (a.scrollWidth! - a.clientWidth! - sl > 0.5) room.right = true;
    }
    if (y && n(a.scrollHeight) && n(a.clientHeight)) {
      if (st > 0.5) room.up = true;
      if (a.scrollHeight! - a.clientHeight! - st > 0.5) room.down = true;
    }
  };
  if (styleOf(el)?.position !== "fixed") {
    let child: ClipNode = el;
    for (let a = el.parentElement; a; child = a, a = a.parentElement) {
      const s = styleOf(a);
      if (!a.parentElement) {
        // the document's scroller: the root's overflow, or the body's when the root's is visible
        const own = (o: string | undefined) => !o || o === "visible";
        const b = child !== el ? styleOf(child) : null;
        const ox = own(s?.overflowX) ? b?.overflowX : s?.overflowX;
        const oy = own(s?.overflowY) ? b?.overflowY : s?.overflowY;
        add(a, own(ox) || scrolls(ox), own(oy) || scrolls(oy));
        break;
      }
      if (s && (scrolls(s.overflowX) || scrolls(s.overflowY))) {
        add(a, scrolls(s.overflowX), scrolls(s.overflowY));
      }
      if (s?.position === "fixed") break;
    }
  }
  return room;
}

/** the mouse handed over by the page that opened the stage, counted only on the fitted frame */
export function seedOn(seed: Pt | null, frame: Rect): Pt | null {
  return seed && !outsideBox(seed, frame) ? seed : null;
}

/** REQ-539 (demo m24) — what the stage makes of a hand-off once the frame is fitted. The stage's
 *  own (its pagehide: a reload, the same page, the same spot) on the frame is where he points:
 *  `send`. /admin's (the click on Demo) says only where his mouse is — for a desktop customer the
 *  Demo button falls on the fitted frame, over whatever her page has there (her mic button) — so
 *  it is a hint for the stage's on/off-frame outline only, never sent: nothing reaches their
 *  screen until he moves. The stage's own beside the frame: nothing (REQ-451). */
export function seedUse(
  seed: (Pt & { from: "admin" | "stage" }) | null,
  frame: Rect,
): { at: Pt; send: boolean } | null {
  if (!seed) return null;
  const at = { x: seed.x, y: seed.y };
  if (seed.from !== "stage") return { at, send: false };
  return seedOn(at, frame) ? { at, send: true } : null;
}

/** within this of where he put it, his arrow on their screen is under his own cursor: no ghost */
export const GHOST_GAP_PX = 6;
/** the ghost is faint: the live arrow on their screen is the real one */
export const GHOST_OPACITY = 0.5;
/** REQ-789 — the ghost is drawn only once he has rested this long after his last anchor: while
 *  he moves, the report for each anchor (a link's round trip late) would flash it on and off */
export const GHOST_REST_MS = 500;

/** REQ-789 — how long a report must still wait before the ghost may be drawn: the rest left
 *  since his last anchor (`lastHoldAt`, 0: none yet), never less than nothing */
export function ghostWait(
  lastHoldAt: number,
  now: number,
  rest = GHOST_REST_MS,
): number {
  if (!lastHoldAt) return 0;
  const since = now - lastHoldAt;
  if (since < 0) return rest;
  return Math.max(0, rest - since);
}

/** where the stage draws the ghost of his arrow, or null: `placed` is where their screen has it
 *  now (on the frame), the page shown is `shownLoad` (REQ-645 — handed back as it came: its way
 *  to an element out of view rides along) */
export function ghostAt<P extends { at: Pt; outside: boolean }>(
  h: Held,
  shownLoad: string | null,
  placed: P | null,
): P | null {
  if (!h.a || h.a.o === 1 || !placed || h.load !== shownLoad) return null;
  if (
    !placed.outside && h.at &&
    Math.hypot(placed.at.x - h.at.x, placed.at.y - h.at.y) <= GHOST_GAP_PX
  ) return null;
  return placed;
}

/** REQ-642 — the customer's report on presenter `pid`'s arrow: `placed` is where their overlay
 *  drew it in `view` (their viewport; null — not on their screen), its tip as a fraction */
export function placedReport(
  pid: string,
  a: Anchor,
  placed: { at: Pt; outside: boolean; dir?: Dir | null } | null,
  view: Rect,
  tag?: TagPlace | null,
): PlacedMessage {
  if (!placed) return { k: "placed", pid, a, p: null };
  const frac = (v: number, lo: number, len: number) =>
    Math.round(Math.min(1, Math.max(0, (v - lo) / (len || 1))) * 1e4) / 1e4;
  /** REQ-837 — a signed length as a fraction of the viewport's */
  const part = (v: number, len: number) =>
    Math.round(Math.min(1, Math.max(-1, v / (len || 1))) * 1e4) / 1e4 || 0;
  const p = {
    vx: frac(placed.at.x, view.left, view.width),
    vy: frac(placed.at.y, view.top, view.height),
  };
  const m: PlacedMessage = placed.outside
    ? { k: "placed", pid, a, p, o: 1 }
    : { k: "placed", pid, a, p };
  // REQ-645 + REQ-642 (reconciled on demo-fixes) — out of view that way: a chevron on their screen
  if (placed.dir) {
    m.d = placed.dir.hidden // REQ-867 (demo dm4 m6) — hidden, not a way to scroll
      ? { dx: placed.dir.dx, dy: placed.dir.dy, h: 1 }
      : { dx: placed.dir.dx, dy: placed.dir.dy };
  }
  // REQ-837 (demo dm2 m3) — where its tag went beside the arrow, so the stage draws it there too
  if (tag) {
    m.t = {
      s: tag.side,
      x: part(tag.x, view.width),
      y: part(tag.y, view.height),
      w: part(tag.w, view.width),
      h: part(tag.h, view.height),
    };
  }
  return m;
}

/** REQ-837 (demo dm2 m3) — a tag's placement beside its arrow: the side it went to
 *  (`tagPlacement`), its top-left relative to the arrow's box (the tip's point) and its size, in
 *  px of the screen it is drawn on */
export interface TagPlace {
  side: TagSide;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** REQ-837 (demo dm2 m3) — the customer's tag for the anchor he holds, in the stage's px (`frame`:
 *  the fitted replica of their viewport): null when their report says no tag (none placed, or not
 *  on their screen), undefined when the report is not for this anchor (keep what is drawn) */
export function reportedTag(
  h: Held,
  r: PlacedMessage | null,
  frame: Rect,
): TagPlace | null | undefined {
  if (!h.a || !r || !sameAnchor(r.a, h.a)) return undefined;
  if (!r.p || !r.t) return null;
  return {
    side: r.t.s,
    x: r.t.x * frame.width,
    y: r.t.y * frame.height,
    w: r.t.w * frame.width,
    h: r.t.h * frame.height,
  };
}

/** REQ-837 (demo dm2 m3) — where a tag of size `own` goes to sit as `tag` does: the edge that
 *  faces the arrow kept (a tag above keeps its bottom, one to the left its right edge), so a
 *  smaller or larger label never runs into the arrow.
 *  REQ-860 (demo dm4 m5 + p6) — given the arrow's tip (`at`) and the box the tag must stay in
 *  (`bounds`: the fitted frame, the cue's box), the placed tag is shifted back TAG_EDGE inside it:
 *  the customer's tag was sized for HER words (Spanish, 244 px) and the stage's are wider
 *  (English, 333 px), so her left edge kept ran 30 px past the frame. A tag beside the arrow that
 *  a shift would push over it goes to the arrow's other side instead. Offsets from `at`. */
export function alignTag(
  tag: TagPlace,
  own: { w: number; h: number },
  at?: Pt | null,
  bounds?: Rect | null,
): { left: number; top: number } {
  let left = tag.side === "left" ? tag.x + tag.w - own.w : tag.x;
  let top = tag.side === "above" || tag.side === "tail-up"
    ? tag.y + tag.h - own.h
    : tag.y;
  if (!at || !bounds) return { left, top };
  // one axis: the offset `v` of a tag `n` long, from the tip at `p`, kept in [lo, hi]
  const into = (v: number, n: number, p: number, lo: number, hi: number) => {
    const over = p + v + n - hi;
    if (over > 0) v -= over;
    const under = lo - (p + v);
    if (under > 0) v += under;
    return v;
  };
  const loX = bounds.left + TAG_EDGE;
  const hiX = bounds.left + bounds.width - TAG_EDGE;
  const loY = bounds.top + TAG_EDGE;
  const hiY = bounds.top + bounds.height - TAG_EDGE;
  const x = into(left, own.w, at.x, loX, hiX);
  // beside the arrow (right / left of it) and shifted over it: the other side of the arrow
  const overArrow = x < ARROW_BOX.w && x + own.w > 0;
  if (tag.side === "right" && x !== left && overArrow) {
    left = into(-TAG_GAP - own.w, own.w, at.x, loX, hiX);
  } else if (tag.side === "left" && x !== left && overArrow) {
    left = into(ARROW_BOX.w + TAG_GAP, own.w, at.x, loX, hiX);
  } else left = x;
  const y = into(top, own.h, at.y, loY, hiY);
  const overY = y < ARROW_BOX.h && y + own.h > 0 && left < ARROW_BOX.w &&
    left + own.w > 0;
  if (tag.side === "above" && y !== top && overY) {
    top = into(ARROW_BOX.h + TAG_GAP, own.h, at.y, loY, hiY);
  } else if (
    (tag.side === "below" || tag.side === "tail") && y !== top && overY
  ) {
    top = into(-TAG_GAP - own.h, own.h, at.y, loY, hiY);
  } else top = y;
  return { left, top };
}

/** REQ-642 — the customer's reports go out at most this often per presenter (the last always) */
export const PLACED_GAP_MS = 100;

const samePlaced = (x: PlacedMessage | null, y: PlacedMessage) =>
  !!x && x.pid === y.pid && !x.o === !y.o && sameAnchor(x.a, y.a) &&
  x.d?.dx === y.d?.dx && x.d?.dy === y.d?.dy && x.d?.h === y.d?.h &&
  // REQ-837 — the tag moved (another side, another spot): a new report
  x.t?.s === y.t?.s && x.t?.x === y.t?.x && x.t?.y === y.t?.y &&
  x.t?.w === y.t?.w && x.t?.h === y.t?.h &&
  (x.p === null || y.p === null
    ? x.p === y.p
    : x.p.vx === y.p.vx && x.p.vy === y.p.vy);

/** REQ-642 — the customer's side: each presenter's reports rated leading + trailing (the arrow
 *  is placed again on every scroll frame), a report the same as the last sent never again */
export function placedReporter(o: {
  send(m: PlacedMessage): void;
  gap?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}): {
  report(m: PlacedMessage): void;
  forget(pid: string): void;
  cancel(): void;
} {
  const per = new Map<
    string,
    { t: MoveThrottle<PlacedMessage>; last: PlacedMessage | null }
  >();
  return {
    report(m) {
      let e = per.get(m.pid);
      if (!e) {
        const entry: {
          t: MoveThrottle<PlacedMessage>;
          last: PlacedMessage | null;
        } = {
          last: null,
          t: moveThrottle<PlacedMessage>({
            gap: () => o.gap ?? PLACED_GAP_MS,
            send: (v) => {
              entry.last = v;
              o.send(v);
            },
            now: o.now,
            setTimer: o.setTimer,
            clearTimer: o.clearTimer,
          }),
        };
        per.set(m.pid, e = entry);
      }
      if (samePlaced(e.last, m)) {
        e.t.cancel(); // a pending other one is stale now: it is back where it was
        return;
      }
      e.t.push(m);
    },
    forget(pid) {
      per.get(pid)?.t.cancel();
      per.delete(pid);
    },
    cancel() {
      for (const e of per.values()) e.t.cancel();
      per.clear();
    },
  };
}

/** REQ-642 — where the stage draws the ghost of his arrow: where the customer's screen REPORTED
 *  it (`r`) for the anchor he holds now, on `frame` (the fitted replica of their viewport), when
 *  that is apart from where he put it. A report of another anchor (an older one, still on the
 *  wire), of nowhere, or none: no ghost. */
export function reportedGhost(
  h: Held,
  r: PlacedMessage | null,
  frame: Rect,
): { at: Pt; outside: boolean; dir?: Dir | null } | null {
  if (!h.a || h.a.o === 1 || !r?.p || !sameAnchor(r.a, h.a)) return null;
  // REQ-645 + REQ-642 — out of view on their screen: the ghost is their chevron, where it is
  if (r.d) {
    const { dx, dy } = r.d;
    // REQ-867 (demo dm4 m6) — hidden on their screen: hidden on the ghost too
    const dir: Dir = r.d.h === 1 ? { dx, dy, hidden: true } : { dx, dy };
    return { at: fracToPoint(r.p, frame), outside: false, dir };
  }
  const placed = placeIn(fracToPoint(r.p, frame), frame, ARROW_BOX, r.o === 1);
  if (
    !placed.outside && h.at &&
    Math.hypot(placed.at.x - h.at.x, placed.at.y - h.at.y) <= GHOST_GAP_PX
  ) return null;
  return placed;
}

/** REQ-642 (setup-14d) — where the stage draws his own small marker: where he pointed, whenever
 *  he holds an anchor (a screenshot, or his screen shared, shows no OS cursor) */
export function ownAt(h: Held): Pt | null {
  return h.a && h.at ? { x: h.at.x, y: h.at.y } : null;
}

/** the off-screen marker: its size (px) and how translucent it is */
export const OFF_MARK_PX = 14;
export const OFF_MARK_OPACITY = 0.7;
/** how far the marker sits in from the edge */
const OFF_MARK_INSET = 2;

/** which edge of `box` a pointer placed off the screen sits against (`placeIn(…, off)` put its
 *  arrow box inside `box`): -1 left / top, 1 right / bottom, 0 neither */
export function offEdge(
  at: Pt,
  box: Rect,
  arrow = ARROW_BOX,
): { dx: -1 | 0 | 1; dy: -1 | 0 | 1 } {
  const side = (v: number, lo: number, hi: number): -1 | 0 | 1 =>
    v <= lo + 0.5 ? -1 : v >= hi - 0.5 ? 1 : 0;
  return {
    dx: side(at.x, box.left, box.left + box.width - arrow.w),
    dy: side(at.y, box.top, box.top + box.height - arrow.h),
  };
}

/** the marker inside the pointer's arrow box (its top-left at `at`): against the edge it is off,
 *  centred on the point along that edge (never pushed off the screen), turned to point out */
export function offMark(
  at: Pt,
  box: Rect,
): { left: number; top: number; deg: number } {
  const { dx, dy } = offEdge(at, box);
  const half = OFF_MARK_PX / 2;
  const left = dx === 1
    ? ARROW_BOX.w - OFF_MARK_PX - OFF_MARK_INSET
    : dx === -1
    ? OFF_MARK_INSET
    : Math.max(box.left - at.x, -half);
  const top = dy === 1
    ? ARROW_BOX.h - OFF_MARK_PX - OFF_MARK_INSET
    : dy === -1
    ? OFF_MARK_INSET
    : Math.max(box.top - at.y, -half);
  const deg = dx === 0 && dy === 0
    ? 0
    : Math.round(Math.atan2(dy, dx) * 180 / Math.PI);
  return { left, top, deg };
}

/** REQ-815 (demo dm1 p4) — the out-of-view chevron (REQ-645) inside the arrow box (its top-left
 *  at the tip), from the way to the element alone: against the edge it is off (OFF_MARK_INSET in),
 *  centred on the tip along that edge, turned to point out. The customer's DemoPointer and the
 *  stage's PointerGhost both draw it from this, so the two screens put it on the same pixel (the
 *  stage only gets the report's tip and way, never the customer's box) */
export function cueMarkOffset(
  dir: Dir,
): { left: number; top: number; deg: number } {
  const half = OFF_MARK_PX / 2;
  const along = (d: -1 | 0 | 1, size: number) =>
    d === 1
      ? size - OFF_MARK_PX - OFF_MARK_INSET
      : d === -1
      ? OFF_MARK_INSET
      : -half;
  return {
    left: along(dir.dx, ARROW_BOX.w),
    top: along(dir.dy, ARROW_BOX.h),
    deg: dir.dx === 0 && dir.dy === 0
      ? 0
      : Math.round(Math.atan2(dir.dy, dir.dx) * 180 / Math.PI),
  };
}

/** REQ-635 (demo m37, cycle 5) — how long the off marker is shown before it fades, and the fade */
export const OFF_MARK_SHOW_MS = 2_500;
export const OFF_MARK_FADE_MS = 400;
/** REQ-635 — the off marker's layer on the customer's screen: under the app's modal dims (the
 *  lowest is z-index 50) — a hint, never over a dialog. The arrow keeps the overlay's top layer. */
export const OFF_MARK_Z = 45;
/** REQ-635 — the dot with the sender's initial beside the chevron */
export const OFF_BADGE_PX = 16;
/** the gap between the chevron and the dot */
const OFF_BADGE_GAP = 1;

/** REQ-635 — where the initial's dot sits, relative to the marker's box (`offMark`'s left/top):
 *  on the chevron's inner side (away from the edge it is off), so it never leaves the screen */
export function offBadge(at: Pt, box: Rect): { left: number; top: number } {
  const { dx, dy } = offEdge(at, box);
  const mid = (OFF_MARK_PX - OFF_BADGE_PX) / 2;
  const after = OFF_MARK_PX + OFF_BADGE_GAP;
  const before = -OFF_BADGE_PX - OFF_BADGE_GAP;
  const left = dx === -1 ? after : dx === 1 ? before : dy === 0 ? after : mid;
  const top = dy === -1 ? after : dy === 1 ? before : mid;
  return { left, top };
}

/** REQ-635 — the sender's initial: the name's first letter, upper-cased ('?' for no name).
 *  REQ-817 (cycle dm1, m3) — a name with no letters (a phone, REQ-355) shows its last two
 *  digits, never '+' */
export function initialOf(name: string): string {
  return initialsOf(name, 1) || "?";
}
