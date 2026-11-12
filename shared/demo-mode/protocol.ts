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
 *     (a wave on the other screen, never an action), `leave`, the customer's screen as `dom`
 *     chunks, and a stage's `resync`.
 *
 * REQ-242 — the customer's screen is the truth, mirrored: the customer's app records its document
 * (a snapshot, then the changes — shared/demo-mode/mirror.ts) and sends the frames as `dom`
 * chunks of at most MIRROR_CHUNK_CHARS; a stage that misses one asks for a fresh snapshot
 * (`resync`). The stage replays them into a frame that runs no script, at the customer's
 * viewport, scaled to fit. A pointer is the fraction of the sender's viewport (REQ-188) and, when
 * there is one, the mirrored node under it (`n`: its mirror id and the point's fraction of its
 * box) — the receiver puts it on that node when it has it.
 */
export type Role = "presenter" | "viewer";

/** REQ-214 — one of the staff presenting a demo: their id (the `pid` on the wire), name and colour */
export interface Presenter {
  userId: string;
  name: string;
  color: string;
}

/** REQ-214 — the customer's pointer on a stage: never one of the presenters' colours */
export const CUSTOMER_COLOR = "#e8562a";
/** REQ-214 — the presenters' palette: distinct, readable on white, the first the demo's green */
export const PRESENTER_COLORS: readonly string[] = [
  "#2f6d29",
  "#1f5fa8",
  "#7a3fb3",
  "#b8860b",
  "#0f7f8a",
  "#c2185b",
  "#5d4037",
  "#4e5d6c",
];

/** REQ-214 — the first colour none of `taken` has; every colour taken, the palette starts over */
export function nextColor(taken: readonly string[]): string {
  const free = PRESENTER_COLORS.find((c) => !taken.includes(c));
  if (free) return free;
  return PRESENTER_COLORS[taken.length % PRESENTER_COLORS.length];
}

/** REQ-242 — the mirrored node a pointer is over: its mirror id, the point's fraction of its box,
 *  and the customer's page load the id belongs to (ids start over on every page) */
export interface NodeAnchor {
  id: number;
  x: number;
  y: number;
  l?: string;
}

/** REQ-188 — where the pointer is: the fraction of the sender's layout viewport; REQ-242 — and
 *  the mirrored node under it, when there is one */
export interface Anchor {
  vx: number;
  vy: number;
  n?: NodeAnchor;
  /** REQ-393 — the sender's pointer is OFF the shared screen (a presenter's mouse beside the
   *  phone frame on his stage): `vx`/`vy` say where it meets the screen's edge, and the receiver
   *  draws it there, marked outside. Never with a node. */
  o?: 1;
}

/** REQ-242 — one piece of a mirror frame: `l` the page load it belongs to, `s` the frame's
 *  number in that load, `i` of `n` pieces, `z` the frame is gzip + base64, `d` the text.
 *  REQ-391 — `t`: when the customer's app pushed the frame, on the deploy's clock (ms) — the
 *  stage measures how late each frame is in */
export interface DomChunk {
  l: string;
  s: number;
  i: number;
  n: number;
  z?: 1;
  d: string;
  t?: number;
}

/** REQ-391 — why a customer's page went, said by the page itself as it goes (`pagehide`): it is
 *  navigating to another page of the app (a link, `location.href`, a reload or a history step —
 *  a new socket follows), or no next page of the app is known to be coming (`closing`: a closed
 *  tab, the address bar pointed elsewhere, the browser's own reload button) */
export type LeaveWhy = "navigating" | "closing";

/** REQ-436 — a browser tab's key on the wire: what front-end/lib/demo-mode/tab-key.ts makes */
export const TAB_KEY = /^[A-Za-z0-9_-]{1,64}$/;
/** REQ-436 — a claim's browser-tab key and focus, each checked; junk is dropped, never the claim */
const claimExtras = (o: Record<string, unknown>): { tab?: string; f?: 1 } => ({
  ...(typeof o.tab === "string" && TAB_KEY.test(o.tab) ? { tab: o.tab } : {}),
  ...(o.f === 1 ? { f: 1 as const } : {}),
});

const isLeaveWhy = (x: unknown): x is LeaveWhy =>
  x === "navigating" || x === "closing";

export type PeerMessage =
  | { k: "move"; a: Anchor; t?: number } // t: the sender's clock (REQ-180)
  | { k: "click"; a: Anchor }
  | { k: "leave" }
  | ({ k: "dom" } & DomChunk)
  | { k: "resync" }
  // REQ-295 — the customer's demo pill box in their viewport (null: no pill), for the stage's ghost;
  // REQ-372 — and what the pill says, so the ghost is a replica, not an empty box
  | ({ k: "pill"; r: Rect | null } & PillFace);

/** REQ-372 — the pill's state in words the stage translates itself (the presenter's language) */
export type PillStatus = "live" | "connecting" | "ended";
const PILL_STATUSES: readonly PillStatus[] = ["live", "connecting", "ended"];
/** REQ-372 — the longest pill text that rides to the stage */
export const PILL_TEXT_MAX = 160;
/** REQ-430 — the longest status label / guide name that rides to the stage */
export const PILL_LABEL_MAX = 60;

/** REQ-372 (demo-loop cycle 2, m1) — what the customer's pill shows: compact (status only) or
 *  full, opened on a tap, its status, its line (the customer's words) and whether it runs off
 *  their screen. Every field optional: an older page sends the box alone. */
export interface PillFace {
  compact?: boolean;
  open?: boolean;
  status?: PillStatus;
  text?: string;
  clipped?: boolean;
  /** REQ-430 (cycle 3, m4) — the status as the customer's pill words it (their language) */
  label?: string;
  /** REQ-430 — the guide's short name, drawn on the compact pill while its details are hidden */
  guide?: string;
}

/** REQ-372 — the face fields of a pill message, each checked; junk is dropped, not fatal */
function parsePillFace(o: Record<string, unknown>): PillFace {
  const f: PillFace = {};
  if (typeof o.compact === "boolean") f.compact = o.compact;
  if (typeof o.open === "boolean") f.open = o.open;
  if (PILL_STATUSES.includes(o.status as PillStatus)) {
    f.status = o.status as PillStatus;
  }
  if (typeof o.text === "string") f.text = o.text.slice(0, PILL_TEXT_MAX);
  if (typeof o.clipped === "boolean") f.clipped = o.clipped;
  if (typeof o.label === "string") f.label = o.label.slice(0, PILL_LABEL_MAX);
  if (typeof o.guide === "string") f.guide = o.guide.slice(0, PILL_LABEL_MAX);
  return f;
}

/** REQ-214 — a presenter's relay may go to the other presenters only (their pointer rides to the
 *  customer directly). REQ-232 — a signal's `to` addresses ONE socket (its `cid`): a stage's offer
 *  the one customer tab it follows, the tab's answer the one stage it is for; a customer tab
 *  `claim`s the stage (it is the tab the customer is using, since `at` on its own clock); a stage
 *  asks one tab to `sync` (send its whole view) */
export type ClientMessage =
  | { t: "signal"; data: unknown; to?: string }
  // REQ-393 — `tab`: a presenter's relay for ONE customer tab (its cid) — the tab the stage
  // follows, or the one it just left (a `leave`); the customer's other tabs never get it
  | { t: "relay"; data: PeerMessage; to?: "presenters"; tab?: string }
  // REQ-436 — `tab`: the BROWSER tab's key (every page of one tab carries the same); `f: 1`: the
  // page has focus. A page sends one on every welcome (`at` 0 when it never claimed) so a stage
  // knows a new page as the same browser tab
  | { t: "claim"; at: number; tab?: string; f?: 1 }
  | { t: "sync"; to: string }
  | { t: "end" }
  // REQ-391 — this socket's page is going, and why (the server says so when it is gone)
  | { t: "leaving"; why: LeaveWhy }
  // REQ-391 — what time is it on the deploy? (`c`: this browser's clock, answered back)
  | { t: "time"; c: number };

/** REQ-214 — `pid`: which presenter a message is from (never on the viewer's), which presenter
 *  came or went (a `peer` without one is a customer tab), and a presenter's own id on their
 *  welcome. REQ-232 — `cid`: which SOCKET — this one's own on its welcome, the one that came or
 *  went on a `peer`, the sender on a signal, relay or claim; `sync`: a stage wants this tab's whole
 *  view; `replaced`: the same staff account opened the demo in a newer window, this one is done.
 *  REQ-235 — and which presenter ended the demo (an `ended` by the viewer never has one).
 *  REQ-296 — `reason: "expired"`: the demo reached SESSION_TTL_MS; nobody ended it (`by` names no
 *  side then, and there is no `pid`). REQ-391 — a socket gone (`online: false`) carries the `why`
 *  its page said as it went, when it said one; `time` answers a browser's ask with the deploy's
 *  clock (`s`) and the browser's own (`c`) */
export type ServerMessage =
  | {
    t: "welcome";
    role: Role;
    sessionId: string;
    peerOnline: boolean;
    pid?: string;
    cid?: string;
  }
  | { t: "peer"; online: boolean; pid?: string; cid?: string; why?: LeaveWhy }
  | { t: "time"; c: number; s: number }
  | { t: "signal"; from: Role; pid?: string; cid?: string; data: unknown }
  | { t: "relay"; from: Role; pid?: string; cid?: string; data: PeerMessage }
  | { t: "claim"; cid: string; at: number; tab?: string; f?: 1 }
  | { t: "sync" }
  | { t: "replaced" }
  | { t: "ended"; by: Role; reason?: EndReason; pid?: string };

/** REQ-296 — why a demo ended short of an End: declined (Not now), or expired (its two hours) */
export type EndReason = "declined" | "expired";

/** how often a browser with no demo asks `active` again — the customer sees the invitation within this */
export const ACTIVE_POLL_MS = 5_000;
/** REQ-378 (demo-loop cycle 2, m22) — how long the server may hold an ask that finds no demo
 *  (`GET /demo-mode/active?wait=`): it answers the moment a demo is opened for the caller, so the
 *  customer's app hears of it at once instead of on its next ask */
export const ACTIVE_WAIT_MS = 10_000;
/** REQ-378 — after an answered ask, the next one goes out this soon: the app is nearly always
 *  listening (a failed ask still waits ACTIVE_POLL_MS) */
export const ACTIVE_REASK_MS = 1_000;
/** REQ-232 — the other side's last socket went: the link stays "live" this long before it says it
 *  is waiting. A page change in the customer's app is a new page and a new socket (the old one
 *  closes, the new one joins once the page has loaded), and it must never flash "waiting".
 *  REQ-391 — on a stage this is the grace of a tab that said it is NAVIGATING (its next page is
 *  coming); one that said it is closing gets none, one that said nothing SILENT_GRACE_MS. */
export const PRESENCE_GRACE_MS = 5_000;
/** REQ-391 — a customer tab's socket went without a word (a crash, a lost network — whose first
 *  reconnect comes after 1 s — or a page from before REQ-391): the stage waits this long for a
 *  next page before it says it is waiting */
export const SILENT_GRACE_MS = 2_000;
/** a demo nobody ended expires on its own — and says so (REQ-296: `ended … expired` to everyone) */
export const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
/** how long the customer's last reported page is kept — the presenter lands there at once (AMENDMENT — same screen) */
export const WHERE_TTL_MS = 20_000;
/** the browser's socket path — under /api on every host, forwarded unchanged (see compose-router.ts) */
export const SOCKET_PATH = "/api/demo-mode/ws";
/** REQ-187 — the staff's page: the stage with the customer's screen in a frame */
export const STAGE_PATH = "/demo/stage";
/** REQ-242 — a mirror chunk's text at most: well inside a data-channel message and a KV value
 *  (64 KiB; a two-byte string is 32 000 bytes) */
export const MIRROR_CHUNK_CHARS = 16_000;
/** REQ-242 — the pieces one frame may take at most (32 M characters) */
export const MIRROR_MAX_CHUNKS = 2_048;

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

/** REQ-242 — a page load's id: what the customer's recorder stamps on every chunk */
const LOAD_ID = /^[A-Za-z0-9_-]{1,64}$/;

const posInt = (x: unknown): x is number =>
  typeof x === "number" && Number.isSafeInteger(x) && x > 0;
const natural = (x: unknown): x is number =>
  typeof x === "number" && Number.isSafeInteger(x) && x >= 0;

function parseNodeAnchor(x: unknown): NodeAnchor | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (!posInt(o.id) || !num(o.x) || !num(o.y)) return null;
  const n: NodeAnchor = { id: o.id, x: clamp01(o.x), y: clamp01(o.y) };
  if (typeof o.l === "string" && LOAD_ID.test(o.l)) n.l = o.l;
  return n;
}

function parseAnchor(x: unknown): Anchor | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (!num(o.vx) || !num(o.vy)) return null;
  // REQ-393 — off the shared screen: the edge's fraction, and no element of it
  if (o.o === 1) return { vx: clamp01(o.vx), vy: clamp01(o.vy), o: 1 };
  const n = parseNodeAnchor(o.n);
  return n
    ? { vx: clamp01(o.vx), vy: clamp01(o.vy), n }
    : { vx: clamp01(o.vx), vy: clamp01(o.vy) };
}

/** REQ-242 — a mirror chunk, each field checked; null when anything is off */
function parseDomChunk(o: Record<string, unknown>): DomChunk | null {
  if (typeof o.l !== "string" || !LOAD_ID.test(o.l)) return null;
  if (!natural(o.s) || o.s > 2 ** 31) return null;
  if (!posInt(o.n) || o.n > MIRROR_MAX_CHUNKS) return null;
  if (!natural(o.i) || o.i >= o.n) return null;
  if (o.z !== undefined && o.z !== 1) return null;
  if (
    typeof o.d !== "string" || o.d.length === 0 ||
    o.d.length > MIRROR_CHUNK_CHARS
  ) return null;
  const c: DomChunk = { l: o.l, s: o.s, i: o.i, n: o.n, d: o.d };
  if (o.z === 1) c.z = 1;
  // REQ-391 — a send time that is not one is dropped, never the chunk
  if (natural(o.t)) c.t = o.t;
  return c;
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
    case "dom": {
      const c = parseDomChunk(o);
      return c
        ? {
          k: "dom",
          l: c.l,
          s: c.s,
          i: c.i,
          n: c.n,
          ...(c.z ? { z: 1 as const } : {}),
          d: c.d,
          ...(c.t !== undefined ? { t: c.t } : {}),
        }
        : null;
    }
    case "resync":
      return { k: "resync" };
    case "pill": {
      if (o.r === null) return { k: "pill", r: null };
      const r = parseRect(o.r);
      return r ? { k: "pill", r, ...parsePillFace(o) } : null;
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
      if (o.data === undefined) return null;
      return typeof o.to === "string" && o.to
        ? { t: "signal", data: o.data, to: o.to }
        : { t: "signal", data: o.data };
    case "relay": {
      const data = parsePeerMessage(o.data);
      if (!data) return null;
      if (o.to === "presenters") return { t: "relay", data, to: "presenters" };
      // REQ-393 — for one customer tab
      return typeof o.tab === "string" && o.tab
        ? { t: "relay", data, tab: o.tab }
        : { t: "relay", data };
    }
    // REQ-232 — a claim with no usable time is still a claim (the oldest one)
    case "claim":
      return { t: "claim", at: num(o.at) ? o.at : 0, ...claimExtras(o) };
    case "sync":
      return typeof o.to === "string" && o.to ? { t: "sync", to: o.to } : null;
    case "end":
      return { t: "end" };
    case "leaving":
      return isLeaveWhy(o.why) ? { t: "leaving", why: o.why } : null;
    case "time":
      return num(o.c) ? { t: "time", c: o.c } : null;
    default:
      return null;
  }
}

const pidOf = (o: Record<string, unknown>): { pid?: string } =>
  typeof o.pid === "string" && o.pid ? { pid: o.pid } : {};
/** REQ-232 — the socket a message names */
const cidOf = (o: Record<string, unknown>): { cid?: string } =>
  typeof o.cid === "string" && o.cid ? { cid: o.cid } : {};

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
          ...pidOf(o),
          ...cidOf(o),
        }
        : null;
    case "peer":
      return typeof o.online === "boolean"
        ? {
          t: "peer",
          online: o.online,
          ...pidOf(o),
          ...cidOf(o),
          // REQ-391 — why a socket went: on a departure only
          ...(!o.online && isLeaveWhy(o.why) ? { why: o.why } : {}),
        }
        : null;
    case "time":
      return num(o.c) && num(o.s) ? { t: "time", c: o.c, s: o.s } : null;
    case "signal":
      return isRole(o.from) && o.data !== undefined
        ? { t: "signal", from: o.from, ...pidOf(o), ...cidOf(o), data: o.data }
        : null;
    case "relay": {
      const data = parsePeerMessage(o.data);
      return isRole(o.from) && data
        ? { t: "relay", from: o.from, ...pidOf(o), ...cidOf(o), data }
        : null;
    }
    case "claim":
      return typeof o.cid === "string" && o.cid && num(o.at)
        ? { t: "claim", cid: o.cid, at: o.at, ...claimExtras(o) }
        : null;
    case "sync":
      return { t: "sync" };
    case "replaced":
      return { t: "replaced" };
    case "ended":
      if (!isRole(o.by)) return null;
      return {
        t: "ended",
        by: o.by,
        ...(o.reason === "declined" || o.reason === "expired"
          ? { reason: o.reason as EndReason }
          : {}),
        // REQ-235 — the presenter who ended it; the viewer's end names nobody
        ...(o.by === "presenter" ? pidOf(o) : {}),
      };
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

/** REQ-295 — a Rect off the wire, or nothing */
export function parseRect(x: unknown): Rect | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const n = (v: unknown): v is number =>
    typeof v === "number" && Number.isFinite(v);
  if (!n(o.left) || !n(o.top) || !n(o.width) || !n(o.height)) return null;
  return { left: o.left, top: o.top, width: o.width, height: o.height };
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

/** REQ-305 — two anchors name the same place: the same node of the same page load at (nearly) the
 *  same point of its box, or — neither naming a node — (nearly) the same fraction of the viewport.
 *  A resting pointer placed again is sent only when this says no. */
export function sameAnchor(a: Anchor | null, b: Anchor | null): boolean {
  if (!a || !b) return a === b;
  // REQ-393 — off the screen is never the same place as on it
  if (!a.o !== !b.o) return false;
  const near = (p: number, q: number) => Math.abs(p - q) < 0.002;
  if (a.n || b.n) {
    return !!a.n && !!b.n && a.n.id === b.n.id && a.n.l === b.n.l &&
      near(a.n.x, b.n.x) && near(a.n.y, b.n.y);
  }
  return near(a.vx, b.vx) && near(a.vy, b.vy);
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
