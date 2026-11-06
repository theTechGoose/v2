/**
 * REQ-153 — demo mode's wire protocol, pure and shared by the backend (the signaling server and
 * its KV mailbox), the overlay island (the customer's browser), the stage island (the staff's)
 * and jest.
 *
 * Two layers:
 *   - ClientMessage / ServerMessage ride the WebSocket to the deploy: `signal` carries WebRTC
 *     SDP/ICE between the two browsers, `relay` carries a PeerMessage when the data channel is
 *     not open, `end` ends the demo; the server answers `welcome`, `peer`, `ended` and forwards
 *     `signal`/`relay` stamped with who they are from.
 *   - PeerMessage rides the WebRTC data channel (or the relay): a pointer `move`, a `click`
 *     (a wave on the other screen, never an action), `leave`, and the customer's `view`.
 *
 * REQ-187 — the customer's screen is the truth: the customer's app reports its VIEW (viewport
 * size, page, scrolled elements, sidebar flags, map centre/zoom) and the staff's stage renders
 * the app in a frame of exactly that viewport, scaled to fit. REQ-188 — a pointer is then only
 * the fraction of the viewport (`vx`, `vy`): on two identical layouts the same fraction is the
 * same pixel.
 */
export type Role = "presenter" | "viewer";

/** REQ-188 — where the pointer is: the fraction of the sender's layout viewport */
export interface Anchor {
  vx: number;
  vy: number;
}

/** REQ-187 — a scrolled element (`sel` null = the window) and its scroll offsets */
export interface ScrollPos {
  sel: string | null;
  x: number;
  y: number;
}

/** REQ-187 — the customer's view; the wire carries patches of it */
export interface View {
  /** the layout viewport, CSS px */
  w: number;
  h: number;
  /** pathname + search */
  path: string;
  /** the sidebar: collapsed to a rail; the mobile drawer open; the open folder's path (REQ-156),
   *  ids outermost first, [] at the top level (AMENDMENT 2026-11-05) */
  sb: boolean;
  drawer: boolean;
  folder: string[];
  scroll: ScrollPos[];
  /** the map on /field/assignments: centre [lat, lng] and zoom */
  map: { c: [number, number]; z: number } | null;
}
export type ViewPatch = Partial<View>;

export type PeerMessage =
  | { k: "move"; a: Anchor; t?: number } // t: the sender's clock (REQ-180)
  | { k: "click"; a: Anchor }
  | { k: "leave" }
  | { k: "view"; v: ViewPatch };

export type ClientMessage =
  | { t: "signal"; data: unknown }
  | { t: "relay"; data: PeerMessage }
  | { t: "end" };

export type ServerMessage =
  | { t: "welcome"; role: Role; sessionId: string; peerOnline: boolean }
  | { t: "peer"; online: boolean }
  | { t: "signal"; from: Role; data: unknown }
  | { t: "relay"; from: Role; data: PeerMessage }
  | { t: "ended"; by: Role; reason?: "declined" };

/** how often a browser with no demo asks `active` again — the customer sees the invitation within this */
export const ACTIVE_POLL_MS = 5_000;
/** a demo nobody ended expires on its own */
export const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
/** how long the customer's last reported page is kept — the presenter lands there at once (AMENDMENT — same screen) */
export const WHERE_TTL_MS = 20_000;
/** the browser's socket path — under /api on every host, forwarded unchanged (see compose-router.ts) */
export const SOCKET_PATH = "/api/demo-mode/ws";
/** REQ-187 — the staff's page: the stage with the replica frame */
export const STAGE_PATH = "/demo/stage";
/** REQ-187 — the frame before the customer's app has reported: a phone */
export const DEFAULT_VIEW: View = {
  w: 390,
  h: 844,
  path: "/dashboard",
  sb: false,
  drawer: false,
  folder: [],
  scroll: [],
  map: null,
};
/** REQ-187 — how often the customer's view patches go out at most */
export const VIEW_GAP_MS = 50;

export function isRole(x: unknown): x is Role {
  return x === "presenter" || x === "viewer";
}

export function otherRole(r: Role): Role {
  return r === "presenter" ? "viewer" : "presenter";
}

const num = (x: unknown): x is number =>
  typeof x === "number" && Number.isFinite(x);
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** a same-origin path: starts with one slash, no scheme, no line breaks */
export function isSafePath(p: unknown): p is string {
  return typeof p === "string" && p.length > 0 && p.length <= 2048 &&
    p.startsWith("/") && !p.startsWith("//") &&
    !/[\r\n]/.test(p);
}

function parseAnchor(x: unknown): Anchor | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (!num(o.vx) || !num(o.vy)) return null;
  return { vx: clamp01(o.vx), vy: clamp01(o.vy) };
}

/** a coordinate pair: two finite numbers within ±90 / ±180 */
const geo = (v: unknown): v is [number, number] =>
  Array.isArray(v) && v.length === 2 && num(v[0]) && num(v[1]) &&
  Math.abs(v[0]) <= 90 && Math.abs(v[1]) <= 180;

const MAX_SCROLLS = 32;
const MAX_SIDE = 20_000;

function parseScroll(x: unknown): ScrollPos | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const sel = o.sel === null
    ? null
    : typeof o.sel === "string" && o.sel.length > 0 && o.sel.length <= 512
    ? o.sel
    : undefined;
  if (sel === undefined || !num(o.x) || !num(o.y) || o.x < 0 || o.y < 0) {
    return null;
  }
  return { sel, x: o.x, y: o.y };
}

/** REQ-187 — a view patch: each field kept only when it is well-formed; null when nothing is */
export function parseView(x: unknown): ViewPatch | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const v: ViewPatch = {};
  if (num(o.w) && o.w > 0 && o.w <= MAX_SIDE) v.w = o.w;
  if (num(o.h) && o.h > 0 && o.h <= MAX_SIDE) v.h = o.h;
  if (isSafePath(o.path)) v.path = o.path;
  if (typeof o.sb === "boolean") v.sb = o.sb;
  if (typeof o.drawer === "boolean") v.drawer = o.drawer;
  if (Array.isArray(o.folder) && o.folder.length <= 8) {
    const ids = o.folder.filter((id): id is string =>
      typeof id === "string" && id.length > 0 && id.length <= 64
    );
    if (ids.length === o.folder.length) v.folder = ids;
  }
  if (Array.isArray(o.scroll)) {
    const scroll = o.scroll.slice(0, MAX_SCROLLS).map(parseScroll).filter((
      s,
    ): s is ScrollPos => s !== null);
    if (scroll.length > 0 || o.scroll.length === 0) v.scroll = scroll;
  }
  if (o.map === null) v.map = null;
  else if (o.map && typeof o.map === "object") {
    const m = o.map as Record<string, unknown>;
    if (geo(m.c) && num(m.z) && m.z >= 0 && m.z <= 24) {
      v.map = { c: [m.c[0], m.c[1]], z: m.z };
    }
  }
  return Object.keys(v).length > 0 ? v : null;
}

/** REQ-187 — a patch over a view: scalar fields replace, scroll entries replace by element */
export function mergeView(prev: View, patch: ViewPatch): View {
  const next: View = { ...prev, ...patch, scroll: prev.scroll };
  if (patch.scroll) {
    const bySel = new Map(prev.scroll.map((s) => [s.sel, s] as const));
    for (const s of patch.scroll) bySel.set(s.sel, s);
    next.scroll = Array.from(bySel.values());
  }
  return next;
}

export function parsePeerMessage(x: unknown): PeerMessage | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  switch (o.k) {
    case "move": {
      const a = parseAnchor(o.a);
      if (!a) return null;
      return typeof o.t === "number" && Number.isFinite(o.t)
        ? { k: "move", a, t: o.t }
        : { k: "move", a };
    }
    case "click": {
      const a = parseAnchor(o.a);
      return a ? { k: "click", a } : null;
    }
    case "leave":
      return { k: "leave" };
    case "view": {
      const v = parseView(o.v);
      return v ? { k: "view", v } : null;
    }
    default:
      return null;
  }
}

function parseJson(raw: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function parseClientMessage(raw: string): ClientMessage | null {
  const o = parseJson(raw);
  if (!o) return null;
  switch (o.t) {
    case "signal":
      return o.data === undefined ? null : { t: "signal", data: o.data };
    case "relay": {
      const data = parsePeerMessage(o.data);
      return data ? { t: "relay", data } : null;
    }
    case "end":
      return { t: "end" };
    default:
      return null;
  }
}

export function parseServerMessage(raw: string): ServerMessage | null {
  const o = parseJson(raw);
  if (!o) return null;
  switch (o.t) {
    case "welcome":
      return isRole(o.role) && typeof o.sessionId === "string" &&
          typeof o.peerOnline === "boolean"
        ? {
          t: "welcome",
          role: o.role,
          sessionId: o.sessionId,
          peerOnline: o.peerOnline,
        }
        : null;
    case "peer":
      return typeof o.online === "boolean"
        ? { t: "peer", online: o.online }
        : null;
    case "signal":
      return isRole(o.from) && o.data !== undefined
        ? { t: "signal", from: o.from, data: o.data }
        : null;
    case "relay": {
      const data = parsePeerMessage(o.data);
      return isRole(o.from) && data ? { t: "relay", from: o.from, data } : null;
    }
    case "ended":
      if (!isRole(o.by)) return null;
      return o.reason === "declined"
        ? { t: "ended", by: o.by, reason: "declined" }
        : { t: "ended", by: o.by };
    default:
      return null;
  }
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** REQ-188 — the point a fraction names inside a box */
export function fracToPoint(a: Anchor, box: Rect): { x: number; y: number } {
  return { x: box.left + box.width * a.vx, y: box.top + box.height * a.vy };
}

/** REQ-188 — the fraction a point is at inside a box, clamped to it; the origin for a zero-size box */
export function pointToFrac(p: { x: number; y: number }, box: Rect): Anchor {
  return {
    vx: box.width > 0 ? clamp01((p.x - box.left) / box.width) : 0,
    vy: box.height > 0 ? clamp01((p.y - box.top) / box.height) : 0,
  };
}

export interface Inset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** REQ-187 — the customer's viewport fitted inside the stage (minus the inset), aspect kept,
 *  centred in the room left: the scale and the frame's box on the stage */
export function fitScale(
  stage: { w: number; h: number },
  view: { w: number; h: number },
  inset: Inset,
): Rect & { s: number } {
  const roomW = Math.max(1, stage.w - inset.left - inset.right);
  const roomH = Math.max(1, stage.h - inset.top - inset.bottom);
  const vw = Math.max(1, view.w);
  const vh = Math.max(1, view.h);
  const s = Math.max(1e-3, Math.min(roomW / vw, roomH / vh));
  const width = vw * s;
  const height = vh * s;
  return {
    s,
    width,
    height,
    left: inset.left + (roomW - width) / 2,
    top: inset.top + (roomH - height) / 2,
  };
}

/** the stage follows a reported page when it is a different same-origin path */
export function shouldFollow(current: string, reported: string): boolean {
  return isSafePath(reported) && reported !== current;
}

/** the slice of a DOM element the selector builder reads — so it runs on a fake in jest */
export interface ElLike {
  tagName: string;
  id: string;
  getAttribute(name: string): string | null;
  parentElement: ElLike | null;
  children: ArrayLike<ElLike>;
}

const IDENT = /^[A-Za-z_][\w-]*$/;

/** a selector for `el`: its id, its data-cy, or a positional path up to the nearest of those (or the body) */
/** a path segment: the tag, the element's first stable class (a modifier like `sb--collapsed` is
 *  never the first token, so a collapsed sidebar is still the sidebar), and its ordinal among the
 *  siblings with the SAME tag and first class. Siblings marked `data-demo-overlay` or
 *  `data-demo-skip` (the impersonation banner, which only the staff side has) never count — so
 *  the same page gives the same path on both screens. */
export interface PathSeg {
  tag: string;
  cls: string | null;
  n: number;
}

const skipped = (e: ElLike) =>
  e.getAttribute("data-demo-overlay") !== null ||
  e.getAttribute("data-demo-skip") !== null;

export function firstClass(e: ElLike): string | null {
  const tokens = (e.getAttribute("class") ?? "").trim().split(/\s+/);
  const first = tokens.find((t) => t && IDENT.test(t));
  return first ?? null;
}

function sameKind(a: ElLike, tag: string, cls: string | null): boolean {
  return a.tagName.toLowerCase() === tag && firstClass(a) === cls;
}

export function segmentFor(el: ElLike): PathSeg {
  const tag = el.tagName.toLowerCase();
  const cls = firstClass(el);
  let n = 1;
  const sibs = el.parentElement?.children;
  if (sibs) {
    for (let i = 0; i < sibs.length; i++) {
      const sib = sibs[i];
      if (sib === el) break;
      if (!skipped(sib) && sameKind(sib, tag, cls)) n++;
    }
  }
  return { tag, cls, n };
}

const segText = (s: PathSeg) =>
  `${s.tag}${s.cls ? `.${s.cls}` : ""}:nth-of-type(${s.n})`;

/** the element's path: from its nearest ancestor with an id or a data-cy (or body), segments down
 *  to it — `body > div.app-shell:nth-of-type(1) > main:nth-of-type(1) > button.asst__send:nth-of-type(1)`.
 *  It reads as CSS, but the ordinal is OUR count (same tag AND first class, skip-marked siblings
 *  left out): resolve it with `parseSelector` + `walkSelector`, querySelector only as a last resort. */
export function selectorFor(el: ElLike, maxDepth = 12): string {
  const parts: string[] = [];
  let cur: ElLike | null = el;
  let depth = 0;
  while (cur && depth < maxDepth) {
    const tag = cur.tagName.toLowerCase();
    if (tag === "body" || tag === "html") {
      parts.unshift(tag);
      break;
    }
    if (cur.id) {
      parts.unshift(
        IDENT.test(cur.id)
          ? `#${cur.id}`
          : `[id="${cur.id.replace(/"/g, '\\"')}"]`,
      );
      break;
    }
    const cy = cur.getAttribute("data-cy");
    if (cy) {
      parts.unshift(`[data-cy="${cy.replace(/"/g, '\\"')}"]`);
      break;
    }
    parts.unshift(segText(segmentFor(cur)));
    cur = cur.parentElement;
    depth++;
  }
  return parts.join(" > ");
}

const SEG = /^([a-z][a-z0-9-]*)(?:\.([A-Za-z_][\w-]*))?:nth-of-type\((\d+)\)$/;
const ROOT =
  /^(body|html|#[A-Za-z_][\w-]*|\[id="[^"]*"\]|\[data-cy="[^"]*"\])$/;

/** a selector `selectorFor` made → its root and segments; null for anything else */
export function parseSelector(
  sel: string,
): { root: string; segs: PathSeg[] } | null {
  const parts = sel.split(" > ");
  const root = parts.shift() ?? "";
  if (!ROOT.test(root)) return null;
  const segs: PathSeg[] = [];
  for (const p of parts) {
    const m = SEG.exec(p);
    if (!m) return null;
    segs.push({ tag: m[1], cls: m[2] ?? null, n: Number(m[3]) });
  }
  return { root, segs };
}

/** from `root`, follow the segments with the same counting `segmentFor` used; null when the
 *  path leads nowhere (never a wrong element) */
export function walkSelector(root: ElLike, segs: PathSeg[]): ElLike | null {
  let cur: ElLike = root;
  for (const s of segs) {
    let n = 0;
    let found: ElLike | null = null;
    const kids = cur.children;
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      if (skipped(k) || !sameKind(k, s.tag, s.cls)) continue;
      if (++n === s.n) {
        found = k;
        break;
      }
    }
    if (!found) return null;
    cur = found;
  }
  return cur;
}
