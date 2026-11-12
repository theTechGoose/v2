/**
 * REQ-242 — the demo mirror's frames, in pure terms both ends share (and jest runs).
 *
 * The customer's app records its document (front-end/lib/demo-mode/mirror-record.ts) and the
 * stage replays it into a frame that runs no script (mirror-replay.ts). Between them:
 *
 *   - a FRAME is a full snapshot (`snap`: the viewport, the page, the `<html>` element as a tree of
 *     nodes each with the mirror id the recorder gave it, and the state no attribute carries —
 *     input values, checked boxes, scrolls, canvas bitmaps — as ops) or a batch of changes
 *     (`ops`): a node's children are now exactly these (ids kept, new subtrees whole), an
 *     attribute, a text, a value, a checked box, a scroll, the viewport, the URL, nodes gone for
 *     good, a canvas;
 *   - a frame travels as JSON, gzipped and base64'd when it is big (`encodeFrame`), cut into
 *     `dom` chunks of at most MIRROR_CHUNK_CHARS (`createMirrorSender`), each stamped with the
 *     page load it belongs to and its number in that load;
 *   - the stage puts the chunks back together in any order (`ChunkAssembler`), decodes, and
 *     hands the frames on strictly in order (`FrameSequencer`): a later frame waits for an
 *     earlier one, a gap that lasts MIRROR_GAP_MS is `stalled()` (the stage then asks for a fresh
 *     snapshot), a snapshot starts over, an older page load's frames are dropped.
 *
 * REQ-309 (demo M19/m14/m26) — a gap is found while the customer is idle: the recorder sends an
 * empty `ops` frame (a heartbeat) whenever nothing went out for MIRROR_HEARTBEAT_MS, so a frame
 * lost just before the customer stopped is a held heartbeat on the stage, stalled after
 * MIRROR_GAP_MS — not a picture that stays stale until their next change. A frame that does not
 * decode is told to the sequencer (`lost`) and stalls at once: nothing will close that gap. The
 * receiver counts what it saw (`stats`) so a lost frame can be pinned in one demo run.
 */
import {
  type DomChunk,
  isSafePath,
  MIRROR_CHUNK_CHARS,
  type PeerMessage,
} from "./protocol.ts";

/** how long the recorder gathers changes before a frame goes out */
export const MIRROR_FLUSH_MS = 50;
/** how long a missing frame is waited for before the stage asks for a fresh snapshot */
export const MIRROR_GAP_MS = 2_000;
/** REQ-309 — the recorder sends an empty `ops` frame when nothing went out for this long: the stage
 *  can then tell a lost frame (a held heartbeat, stalled after MIRROR_GAP_MS) from a quiet page */
export const MIRROR_HEARTBEAT_MS = 1_000;
/** a frame's JSON over this many characters is gzipped */
export const MIRROR_GZIP_OVER = 4_096;

/** an element: its mirror id, its tag (an SVG/MathML one keeps its case), attributes, children */
export interface SEl {
  i: number;
  t: string;
  a?: Record<string, string>;
  c?: SNode[];
  ns?: "svg" | "math";
}
/** a text node: its mirror id and its text */
export interface SText {
  i: number;
  x: string;
}
export type SNode = SEl | SText;

export type Op =
  /** node `i`'s children are now exactly `c`: a number is a node the replay has, an object a new one */
  | { o: "k"; i: number; c: (number | SNode)[] }
  /** an attribute set, or removed (`v` null) */
  | { o: "a"; i: number; n: string; v: string | null }
  /** a text node's text */
  | { o: "x"; i: number; x: string }
  /** an input's, a textarea's or a select's value */
  | { o: "v"; i: number; v: string }
  /** a checkbox's or a radio's checked state */
  | { o: "c"; i: number; c: boolean }
  /** a scroll: node `i`, or the window (`i` 0) */
  | { o: "s"; i: number; x: number; y: number }
  /** the layout viewport, CSS px */
  | { o: "w"; w: number; h: number }
  /** the page (pathname + search): pushState and replaceState change it without a new document */
  | { o: "u"; u: string }
  /** nodes out of the page for good: the replay forgets them and everything under them */
  | { o: "g"; i: number[] }
  /** a canvas's bitmap, as a data URL */
  | { o: "cv"; i: number; u: string };

export type MirrorFrame =
  | { t: "snap"; w: number; h: number; u: string; root: SEl; ops: Op[] }
  | { t: "ops"; ops: Op[] };

// ---- validation: a frame comes from the other browser; nothing malformed reaches the replay ----

const TAG = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
/** an attribute name the DOM takes: no spaces, quotes, angle brackets, slash or equals */
const ATTR = /^[^\s"'<>/=]{1,256}$/;
const MAX_SIDE = 20_000;
const MAX_DEPTH = 1_000;

const num = (x: unknown): x is number =>
  typeof x === "number" && Number.isFinite(x);
const id = (x: unknown): x is number =>
  typeof x === "number" && Number.isSafeInteger(x) && x > 0;
const str = (x: unknown): x is string => typeof x === "string";

function okNode(x: unknown, depth: number): boolean {
  if (!x || typeof x !== "object" || depth > MAX_DEPTH) return false;
  const o = x as Record<string, unknown>;
  if (!id(o.i)) return false;
  if ("x" in o) return str(o.x) && !("t" in o);
  if (!str(o.t) || !TAG.test(o.t)) return false;
  if (o.ns !== undefined && o.ns !== "svg" && o.ns !== "math") return false;
  if (o.a !== undefined) {
    if (!o.a || typeof o.a !== "object" || Array.isArray(o.a)) return false;
    for (const [k, v] of Object.entries(o.a as Record<string, unknown>)) {
      if (!ATTR.test(k) || !str(v)) return false;
    }
  }
  if (o.c !== undefined) {
    if (!Array.isArray(o.c)) return false;
    for (const c of o.c) if (!okNode(c, depth + 1)) return false;
  }
  return true;
}

function okOp(x: unknown): boolean {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  switch (o.o) {
    case "k":
      return id(o.i) && Array.isArray(o.c) &&
        o.c.every((c) => id(c) || okNode(c, 1));
    case "a":
      return id(o.i) && str(o.n) && ATTR.test(o.n) &&
        (o.v === null || str(o.v));
    case "x":
      return id(o.i) && str(o.x);
    case "v":
      return id(o.i) && str(o.v);
    case "c":
      return id(o.i) && typeof o.c === "boolean";
    case "s":
      return (o.i === 0 || id(o.i)) && num(o.x) && num(o.y);
    case "w":
      return num(o.w) && num(o.h) && o.w > 0 && o.h > 0 && o.w <= MAX_SIDE &&
        o.h <= MAX_SIDE;
    case "u":
      return str(o.u) && (o.u === "" || isSafePath(o.u));
    case "g":
      return Array.isArray(o.i) && o.i.every(id);
    case "cv":
      return id(o.i) && str(o.u) && o.u.startsWith("data:image/");
    default:
      return false;
  }
}

/** a well-formed frame, as it is; null for anything else */
export function parseMirrorFrame(x: unknown): MirrorFrame | null {
  if (!x || typeof x !== "object") return null;
  const f = x as Record<string, unknown>;
  if (!Array.isArray(f.ops) || !f.ops.every(okOp)) return null;
  if (f.t === "ops") return f as unknown as MirrorFrame;
  if (f.t !== "snap") return null;
  if (!num(f.w) || !num(f.h) || f.w <= 0 || f.h <= 0) return null;
  if (f.w > MAX_SIDE || f.h > MAX_SIDE) return null;
  if (!str(f.u) || !(f.u === "" || isSafePath(f.u))) return null;
  if (!okNode(f.root, 0) || "x" in (f.root as object)) return null;
  return f as unknown as MirrorFrame;
}

// ---- the wire: page loads, chunks, gzip ----

/** a page load's id: when it loaded (base 36, fixed width — ids sort by time) and a random tail */
export function newLoadId(ms: number = Date.now()): string {
  const tail = new Uint8Array(6);
  crypto.getRandomValues(tail);
  return `${Math.max(0, Math.floor(ms)).toString(36).padStart(9, "0")}-${
    Array.from(tail, (b) => (b % 36).toString(36)).join("")
  }`;
}

/** `text` in pieces of at most `size` characters; a surrogate pair is never cut */
export function chunkText(
  text: string,
  size: number = MIRROR_CHUNK_CHARS,
): string[] {
  if (text.length <= size) return [text];
  const out: string[] = [];
  let at = 0;
  while (at < text.length) {
    let end = Math.min(text.length, at + size);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
    out.push(text.slice(at, end));
    at = end;
  }
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let k = 0; k < bytes.length; k += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
  }
  return btoa(bin);
}

/** (the array's type is inferred: a Blob takes it as it is) */
function fromBase64(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k);
  return out;
}

const canGzip = () =>
  typeof CompressionStream === "function" &&
  typeof DecompressionStream === "function" && typeof Blob === "function" &&
  typeof Response === "function";

/** a frame as text: JSON, or (over `gzipOver` characters, where the browser can) gzip + base64 */
export async function encodeFrame(
  f: MirrorFrame,
  opts: { gzipOver?: number } = {},
): Promise<{ z: boolean; text: string }> {
  const json = JSON.stringify(f);
  if (json.length <= (opts.gzipOver ?? MIRROR_GZIP_OVER) || !canGzip()) {
    return { z: false, text: json };
  }
  try {
    const zipped = new Blob([json]).stream().pipeThrough(
      new CompressionStream("gzip"),
    );
    const bytes = new Uint8Array(await new Response(zipped).arrayBuffer());
    return { z: true, text: toBase64(bytes) };
  } catch {
    // REQ-309 — gzip refused (a browser quirk, memory): the frame still goes, plain — a frame
    // silently dropped here is a stage stale until the customer's next change
    return { z: false, text: json };
  }
}

/** a frame back from its text; null when it is not one */
export async function decodeFrame(
  text: string,
  z: boolean,
): Promise<MirrorFrame | null> {
  try {
    let json = text;
    if (z) {
      if (!canGzip()) return null;
      const bytes = fromBase64(text);
      const plain = new Blob([bytes]).stream().pipeThrough(
        new DecompressionStream("gzip"),
      );
      json = await new Response(plain).text();
    }
    return parseMirrorFrame(JSON.parse(json));
  } catch {
    return null;
  }
}

/** a frame's chunks back together, whatever order they come in; a duplicate is ignored */
export class ChunkAssembler {
  #parts = new Map<
    string,
    { n: number; got: number; d: (string | undefined)[]; z: boolean }
  >();

  push(
    c: DomChunk,
  ): { l: string; s: number; z: boolean; text: string } | null {
    if (c.n === 1) return { l: c.l, s: c.s, z: c.z === 1, text: c.d };
    const key = `${c.l}:${c.s}`;
    let p = this.#parts.get(key);
    if (!p) {
      // a bounded memory: the oldest unfinished frame goes first
      if (this.#parts.size >= 32) {
        this.#parts.delete(this.#parts.keys().next().value!);
      }
      p = { n: c.n, got: 0, d: new Array(c.n), z: c.z === 1 };
      this.#parts.set(key, p);
    }
    if (p.n !== c.n || p.d[c.i] !== undefined) return null;
    p.d[c.i] = c.d;
    if (++p.got < p.n) return null;
    this.#parts.delete(key);
    return { l: c.l, s: c.s, z: p.z, text: p.d.join("") };
  }
}

/** frames in order: per page load, by number; a snapshot starts over — whichever page load it
 *  comes from (REQ-292: a stage following an OLDER tab again gets that tab's snapshot; the "older
 *  load is over" rule drops that load's ops only) */
export class FrameSequencer {
  #load: string | null = null;
  #next = 0;
  /** frames that came early: by load, by number */
  #held = new Map<string, Map<number, MirrorFrame>>();
  #since: number | null = null;
  /** REQ-309 — a frame came that cannot be used: a gap nothing will close, stalled at once */
  #broken = false;
  #gapMs: number;
  #now: () => number;
  /** REQ-309 — frames dropped as an older page load's, already past, or seen before */
  dropped = 0;

  constructor(o: { gapMs?: number; now?: () => number } = {}) {
    this.#gapMs = o.gapMs ?? MIRROR_GAP_MS;
    this.#now = o.now ?? (() => Date.now());
  }

  push(l: string, s: number, f: MirrorFrame): MirrorFrame[] {
    const out: MirrorFrame[] = [];
    if (f.t === "snap") {
      // a stale copy of the page shown: a lower number of the same load
      if (l === this.#load && s < this.#next) return this.#drop(out);
      this.#load = l;
      this.#next = s + 1;
      this.#broken = false;
      // the other loads' early frames go: an older load is over; a newer one's ops before its
      // own snapshot are superseded by that snapshot when it comes (REQ-292: a closed tab's late
      // op must never keep the stage stalled)
      for (const k of [...this.#held.keys()]) if (k !== l) this.#held.delete(k);
      const mine = this.#held.get(l);
      if (mine) {
        for (const k of [...mine.keys()]) if (k <= s) mine.delete(k);
      }
      out.push(f);
      this.#drain(out);
      return this.#settle(out);
    }
    if (l === this.#load) {
      if (s < this.#next) return this.#drop(out);
      if (s === this.#next) {
        this.#next++;
        out.push(f);
        this.#drain(out);
        return this.#settle(out);
      }
    }
    // an op of an older page load (ids sort by load time): that load is over — until its snapshot
    // (REQ-292: a snapshot of any load starts ordering over; REQ-309 counts the drop)
    if (this.#load !== null && l < this.#load) return this.#drop(out);
    // early: a later number of this load, or a newer load whose snapshot is not here yet
    let mine = this.#held.get(l);
    if (!mine) this.#held.set(l, mine = new Map());
    mine.set(s, f);
    return this.#settle(out);
  }

  /** REQ-309 — frame (l, s) came but cannot be used (it did not decode): the gap at s will never
   *  close by itself, so this stalls at once, until a snapshot starts over. One already past, or
   *  of an older load, changes nothing. */
  lost(l: string, s: number): void {
    if (this.#load !== null && l < this.#load) return;
    if (l === this.#load && s < this.#next) return;
    this.#broken = true;
  }

  /** a frame has been missing for MIRROR_GAP_MS (or one came broken): time for a fresh snapshot */
  stalled(): boolean {
    return this.#broken ||
      (this.#since !== null && this.#now() - this.#since >= this.#gapMs);
  }

  /** REQ-309 — frames waiting for an earlier one */
  heldCount(): number {
    let n = 0;
    for (const m of this.#held.values()) n += m.size;
    return n;
  }

  /** REQ-292 — would push(l, s, snapshot) be rejected? (a stale copy of the page shown) */
  rejectsSnap(l: string, s: number): boolean {
    return l === this.#load && s < this.#next;
  }

  reset(): void {
    this.#load = null;
    this.#next = 0;
    this.#held.clear();
    this.#since = null;
    this.#broken = false;
  }

  #drop(out: MirrorFrame[]): MirrorFrame[] {
    this.dropped++;
    return this.#settle(out);
  }

  #drain(out: MirrorFrame[]): void {
    const mine = this.#load === null ? undefined : this.#held.get(this.#load);
    while (mine?.has(this.#next)) {
      out.push(mine.get(this.#next)!);
      mine.delete(this.#next);
      this.#next++;
    }
  }

  #settle(out: MirrorFrame[]): MirrorFrame[] {
    for (const [k, m] of this.#held) if (m.size === 0) this.#held.delete(k);
    if (this.#held.size === 0) this.#since = null;
    else if (this.#since === null) this.#since = this.#now();
    return out;
  }
}

export interface MirrorSender {
  /** this page load's id: on every chunk, and on every pointer anchored to this page's nodes */
  load: string;
  push(f: MirrorFrame): Promise<void>;
  /** every frame pushed so far is out */
  idle(): Promise<void>;
}

/** the customer's end: frames numbered per page load, encoded in order, sent as dom chunks */
export function createMirrorSender(o: {
  send(m: PeerMessage): void;
  load?: string;
  gzipOver?: number;
  chunkChars?: number;
}): MirrorSender {
  const load = o.load ?? newLoadId();
  let seq = 0;
  let chain: Promise<void> = Promise.resolve();
  return {
    load,
    push(f) {
      const s = seq++;
      chain = chain.then(async () => {
        const { z, text } = await encodeFrame(f, { gzipOver: o.gzipOver });
        const parts = chunkText(text, o.chunkChars ?? MIRROR_CHUNK_CHARS);
        for (let i = 0; i < parts.length; i++) {
          o.send({
            k: "dom",
            l: load,
            s,
            i,
            n: parts.length,
            ...(z ? { z: 1 as const } : {}),
            d: parts[i],
          });
        }
      }).catch(() => {});
      return chain;
    },
    idle: () => chain,
  };
}

/** REQ-309 — what the receiver counted since it started (the stage shows it in dev) */
export interface MirrorStats {
  /** frames handed on in order: snapshots, changes and heartbeats */
  frames: number;
  snaps: number;
  /** empty `ops` frames: the customer's heartbeat */
  beats: number;
  /** frames that did not decode — each a gap, stalled at once */
  undecodable: number;
  /** frames dropped as an older page load's, already past, or seen before */
  older: number;
  /** frames waiting for an earlier one, right now */
  held: number;
  /** times a gap lasted into a stall */
  stalls: number;
}

/** the stage's end: chunks in, frames out in order, each with the page load it belongs to;
 *  `stalled()` says when to ask for a snapshot; `reset()` starts over (REQ-309 — the stage follows
 *  another tab: a frame decoded from before the reset is never handed on, and the other tab's
 *  page-load id is not "older") */
export function createMirrorReceiver(o: {
  onFrame(f: MirrorFrame, load: string): void;
  /** REQ-292 tripwire — a snapshot the sequencer rejected: the stage logs it and resyncs */
  onDropped?(f: MirrorFrame, load: string, seq: number): void;
  gapMs?: number;
  now?: () => number;
}): {
  push(c: DomChunk): Promise<void>;
  stalled(): boolean;
  reset(): void;
  idle(): Promise<void>;
  stats(): MirrorStats;
} {
  const asm = new ChunkAssembler();
  const order = new FrameSequencer({ gapMs: o.gapMs, now: o.now });
  let chain: Promise<void> = Promise.resolve();
  let epoch = 0;
  const n = { frames: 0, snaps: 0, beats: 0, undecodable: 0, stalls: 0 };
  let wasStalled = false;
  return {
    push(c) {
      const whole = asm.push(c);
      if (!whole) return chain;
      const mine = epoch;
      chain = chain.then(async () => {
        const f = await decodeFrame(whole.text, whole.z);
        if (mine !== epoch) return;
        if (!f) {
          // REQ-309 — an undecodable frame is a gap nothing will close: stalled at once, and
          // the stage asks for a snapshot
          n.undecodable++;
          order.lost(whole.l, whole.s);
          return;
        }
        if (f.t === "snap" && order.rejectsSnap(whole.l, whole.s)) {
          // REQ-292 tripwire — a snapshot the sequencer will refuse is never silent
          try {
            o.onDropped?.(f, whole.l, whole.s);
          } catch {
            // the stage's own trouble
          }
          return;
        }
        for (const g of order.push(whole.l, whole.s, f)) {
          n.frames++;
          if (g.t === "snap") n.snaps++;
          else if (g.ops.length === 0) n.beats++;
          try {
            o.onFrame(g, whole.l);
          } catch {
            // the replay's own trouble; the next snapshot mends it
          }
        }
      }).catch(() => {});
      return chain;
    },
    stalled() {
      const s = order.stalled();
      if (s && !wasStalled) n.stalls++;
      wasStalled = s;
      return s;
    },
    reset() {
      epoch++;
      order.reset();
      wasStalled = false;
    },
    idle: () => chain,
    stats: () => ({ ...n, older: order.dropped, held: order.heldCount() }),
  };
}
