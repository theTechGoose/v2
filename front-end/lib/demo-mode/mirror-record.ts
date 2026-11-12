/**
 * REQ-242 — the customer's side of the demo mirror: their document, recorded.
 *
 * `snapshot()` serializes the page as it is now — the `<html>` element as a tree of nodes, each
 * with a mirror id, plus the state no attribute carries (typed values, checked boxes, scrolls,
 * canvases) — and starts watching. Every change after that (a MutationObserver for the tree,
 * attributes and texts; input, change, scroll and resize listeners; a sweep for what changes
 * without an event — a value set by code, the URL after pushState, a canvas drawn on) goes out
 * as an `ops` frame, gathered for MIRROR_FLUSH_MS. `pause()` stops watching (nobody is looking);
 * the next `snapshot()` starts over. `stop()` lets go of everything.
 *
 * The changes keep one rule: the stage's copy is exactly this page's mirrorable tree after every
 * frame. A parent whose children changed is sent as its new child list — a child the stage has
 * (and that never left the page in this batch) by id, any other child as a whole new subtree — so
 * a node that was moved, or taken out, edited and put back, is always sent as it is now. Nodes
 * that left the page for good are named last (`g`) so the stage can forget them.
 *
 * What never crosses: scripts, <noscript>, <template>, <base>, http-equiv metas (refresh, CSP),
 * links other than stylesheets and icons (preloads), tracking pixels, comments, the demo overlay
 * (`data-demo-overlay`) and anything marked `data-demo-skip` (the staff banner); event handler
 * attributes, `javascript:` URLs, integrity/nonce, an embedded page's src/srcdoc (the frame is an
 * empty box), media sources. URLs are made absolute (the stage's frame has no base of its own).
 * Passwords, one-time codes, card numbers and anything under `data-demo-mask` are masked, a
 * bullet per character, before they leave this browser.
 *
 * REQ-309 (demo M19) — a heartbeat: while somebody watches, an empty `ops` frame goes out
 * whenever nothing went out for MIRROR_HEARTBEAT_MS (`beat()`, on the sweep), so the stage can
 * tell a lost frame (a held heartbeat, stalled after MIRROR_GAP_MS) from a page that is quiet.
 *
 * REQ-380 (demo-loop cycle 2, M10) — a width or height set on a canvas clears its bitmap, on the
 * stage too; the page usually redraws the same picture at once (the /q signature pad's
 * setupCanvas on mount and resize), so the bitmap reads as before and the sweep would never send
 * it again. Any width/height change on a canvas re-sends its bitmap in the same frame, after the
 * attribute ops. `stats()` counts the bitmaps sent.
 */
import {
  MIRROR_FLUSH_MS,
  MIRROR_HEARTBEAT_MS,
  type MirrorFrame,
  type Op,
  type SEl,
  type SNode,
} from "../../../shared/demo-mode/mirror.ts";
import { isSafePath } from "../../../shared/demo-mode/protocol.ts";

/** REQ-534 (cycle 4, M8) — while a canvas is drawn on, its bitmap goes out at most this often
 *  (the 1 s sweep left a live signature up to a second behind, or unseen until after signing) */
export const CANVAS_INK_MS = 100;

export interface RecorderOptions {
  /** a frame to send */
  emit(f: MirrorFrame): void;
  /** the MutationObserver to use (jest hands in its own) */
  Observer?: typeof MutationObserver;
  /** no timers at all: frames go out on `flush()` only (jest) */
  manual?: boolean;
  /** how long changes are gathered before a frame goes out */
  flushMs?: number;
  /** how often the sweep looks for changes that come without an event */
  sweepMs?: number;
  /** REQ-534 — how often a canvas being drawn on is re-sent (default CANVAS_INK_MS) */
  inkMs?: number;
  /** REQ-309 — a heartbeat (an empty frame) when nothing went out for this long */
  heartbeatMs?: number;
  /** the clock the heartbeat reads (jest hands in its own) */
  now?: () => number;
}

export interface Recorder {
  /** the whole page, and from now on its changes */
  snapshot(): void;
  /** the changes since the last frame, as a frame (nothing when nothing changed) */
  flush(): void;
  /** REQ-309 — an empty frame when nothing went out for heartbeatMs while somebody watches: the
   *  stage can tell a lost frame from a quiet page (nothing while paused) */
  beat(): void;
  /** stop watching until the next snapshot */
  pause(): void;
  /** stop for good */
  stop(): void;
  /** the mirror id of `n`, or of its nearest mirrored ancestor element (a pointer's anchor) */
  idOf(n: Node | null): number | null;
  /** the mirrored element with id `id` */
  nodeOf(id: number): Element | null;
  /** REQ-380 — canvas bitmaps sent (`cv` ops) since the recorder was made */
  stats(): { cv: number };
}

const XHTML = "http://www.w3.org/1999/xhtml";
const SVG_NS = "http://www.w3.org/2000/svg";
const MATH_NS = "http://www.w3.org/1998/Math/MathML";

const ELEMENT = 1;
const TEXT = 3;
const DOCUMENT = 9;

const SKIP_TAGS = new Set(["script", "noscript", "template", "base"]);
const URL_ATTRS = new Set([
  "href",
  "src",
  "poster",
  "action",
  "formaction",
  "background",
  "cite",
  "longdesc",
  "xlink:href",
]);
/** an embedded page or plugin: an empty box on the stage, never loaded */
const EMBED_TAGS = new Set(["iframe", "frame", "object", "embed"]);
/** sound and video: the stage frame plays nothing */
const MEDIA_TAGS = new Set(["video", "audio", "track"]);
const DROP_ATTRS = new Set(["integrity", "nonce", "autofocus"]);
/** a name the DOM takes (and the stage's parser accepts) */
const ATTR_NAME = /^[^\s"'<>/=]{1,256}$/;
const TRACKERS =
  /(^|\.)(facebook\.(com|net)|google-analytics\.com|googletagmanager\.com|doubleclick\.net|googleadservices\.com|analytics\.google\.com|bat\.bing\.com|clarity\.ms|hotjar\.com|ads-twitter\.com|licdn\.com)$/i;
const SECRET_AUTOCOMPLETE =
  /\b(one-time-code|cc-number|cc-csc|cc-exp|cc-exp-month|cc-exp-year|current-password|new-password)\b/i;
const FORM = new Set(["input", "textarea", "select"]);
/** inputs whose value is not what they show (or must not travel) */
const NO_VALUE = new Set([
  "checkbox",
  "radio",
  "file",
  "hidden",
  "submit",
  "button",
  "reset",
  "image",
]);

/** a bullet per character; spaces stay, so the shape of the text is all that crosses */
export const mask = (s: string) => s.replace(/\S/g, "•");

const lower = (s: string | null | undefined) => (s ?? "").toLowerCase();

function tagOf(e: Element): string {
  const ns = e.namespaceURI;
  return !ns || ns === XHTML ? e.localName.toLowerCase() : e.localName;
}

function nsOf(e: Element): "svg" | "math" | undefined {
  return e.namespaceURI === SVG_NS
    ? "svg"
    : e.namespaceURI === MATH_NS
    ? "math"
    : undefined;
}

/** a URL the stage can load as is: absolute; a fragment stays a fragment; null for anything unsafe */
function absUrl(v: string, base: string): string | null {
  const t = v.trim();
  if (!t) return v;
  if (t.startsWith("#")) return t;
  try {
    const u = new URL(t, base);
    switch (u.protocol) {
      case "http:":
      case "https:":
      case "mailto:":
      case "tel:":
      case "sms:":
      case "blob:":
        return u.href;
      case "data:":
        return /^data:image\//i.test(t) ? t : null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function absSrcset(v: string, base: string): string {
  return v.split(",").map((part) => {
    const p = part.trim();
    if (!p) return "";
    const [u, ...d] = p.split(/\s+/);
    const a = absUrl(u, base);
    return a === null ? "" : [a, ...d].join(" ");
  }).filter(Boolean).join(", ");
}

const CSS_URL = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
const CSS_IMPORT = /@import\s+(['"])(.*?)\1/gi;

/** a style sheet's or style attribute's URLs, made absolute */
function absCss(css: string, base: string): string {
  if (!css.includes("url(") && !css.includes("@import")) return css;
  return css
    .replace(CSS_URL, (m, q: string, u: string) => {
      const t = u.trim();
      if (!t || /^(data:|#)/i.test(t)) return m;
      const a = absUrl(t, base);
      return a === null ? "url()" : `url(${q}${a}${q})`;
    })
    .replace(CSS_IMPORT, (_m, q: string, u: string) => {
      const a = absUrl(u, base);
      return a === null ? "" : `@import ${q}${a}${q}`;
    });
}

/** an input whose value is a secret wherever it is */
function secretInput(e: Element, tag: string): boolean {
  if (tag !== "input" && tag !== "textarea") return false;
  if (lower(e.getAttribute("type")) === "password") return true;
  return SECRET_AUTOCOMPLETE.test(e.getAttribute("autocomplete") ?? "");
}

/** an attribute that may cross at all (its value is checked separately) */
function nameAllowed(tag: string, name: string): boolean {
  const n = name.toLowerCase();
  if (!ATTR_NAME.test(name)) return false;
  if (n.startsWith("on") || n.startsWith("xmlns") || DROP_ATTRS.has(n)) {
    return false;
  }
  if (EMBED_TAGS.has(tag) && (n === "src" || n === "srcdoc" || n === "data")) {
    return false;
  }
  if (MEDIA_TAGS.has(tag) && (n === "src" || n === "srcset")) return false;
  return true;
}

/** an attribute's value as it crosses: URLs absolute, unsafe ones gone, secrets masked */
function attrValue(
  e: Element,
  tag: string,
  name: string,
  value: string,
  masked: boolean,
  base: string,
): string | null {
  const n = name.toLowerCase();
  if (n === "srcset" || n === "imagesrcset") return absSrcset(value, base);
  if (n === "style") return absCss(value, base);
  if (URL_ATTRS.has(n)) {
    const a = absUrl(value, base);
    if (a !== null) return a;
    return n === "href" || n === "xlink:href" ? "#" : null;
  }
  if (n === "value" && (masked || secretInput(e, tag))) return mask(value);
  return value;
}

/** a change to one of these may change whether (or how) the element crosses at all */
function structural(tag: string, name: string): boolean {
  switch (name.toLowerCase()) {
    case "data-demo-skip":
    case "data-demo-overlay":
    case "data-demo-mask":
    case "rel":
    case "http-equiv":
    case "type":
    case "autocomplete":
      return true;
    case "src":
    case "width":
    case "height":
      return tag === "img";
    default:
      return false;
  }
}

export function createRecorder(doc: Document, o: RecorderOptions): Recorder {
  const win = doc.defaultView as (Window & typeof globalThis) | null;
  const Observer = o.Observer ?? globalThis.MutationObserver;
  const flushMs = o.flushMs ?? MIRROR_FLUSH_MS;
  const sweepMs = o.sweepMs ?? 500;
  const inkMs = o.inkMs ?? CANVAS_INK_MS;
  const heartbeatMs = o.heartbeatMs ?? MIRROR_HEARTBEAT_MS;
  const now = o.now ?? (() => Date.now());
  /** REQ-309 — when the last frame went out (the heartbeat's clock) */
  let lastEmit = 0;
  const emit = (f: MirrorFrame) => {
    lastEmit = now();
    for (const op of f.ops) if (op.o === "cv") cvSent++;
    o.emit(f);
  };
  const base = () => doc.baseURI || win?.location.href || "";
  const pageHost = () => {
    try {
      return new URL(base()).hostname;
    } catch {
      return "";
    }
  };

  let nextId = 1;
  /** every node that ever had an id keeps it (a node that comes back is sent with the same id) */
  const ids = new WeakMap<Node, number>();
  /** the nodes the stage has now, by id */
  const nodes = new Map<number, Node>();
  /** the stage's child list of every element it has */
  const kids = new Map<number, number[]>();
  /** what was last sent of the state no attribute carries */
  const formIds = new Set<number>();
  const lastVal = new Map<number, string>();
  const lastChk = new Map<number, boolean>();
  const canvasIds = new Set<number>();
  const lastCanvas = new Map<number, string>();
  const lastScroll = new Map<number, string>();
  let lastWin = "";
  let lastSize = "";
  let lastUrl = "";
  let lastCanvasSweep = 0;
  /** REQ-534 — canvases a pointer drew on since the last frame, and the ink throttle */
  const inked = new Set<number>();
  let lastInk = 0;
  let inkTimer: ReturnType<typeof setTimeout> | undefined;
  /** set while the ink timer's flush runs: only then (or on a manual flush) are inked canvases read */
  let inkDue = false;
  /** REQ-380 — canvas bitmaps sent */
  let cvSent = 0;

  let observer: MutationObserver | null = null;
  let pending: MutationRecord[] = [];
  const scrolled = new Set<EventTarget>();
  let attached = false;
  let stopped = false;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let sweepTimer: ReturnType<typeof setInterval> | undefined;

  const idFor = (n: Node) => {
    let id = ids.get(n);
    if (id === undefined) {
      id = nextId++;
      ids.set(n, id);
    }
    return id;
  };
  const mirrored = (n: Node | null): n is Node => {
    if (!n) return false;
    const id = ids.get(n);
    return id !== undefined && nodes.get(id) === n;
  };

  const here = () => {
    const p = (win?.location.pathname ?? "") + (win?.location.search ?? "");
    return isSafePath(p) ? p : "";
  };

  function tracker(e: Element): boolean {
    const src = e.getAttribute("src") ?? "";
    if (!src) return false;
    let host = "";
    try {
      host = new URL(src, base()).hostname;
    } catch {
      return false;
    }
    if (TRACKERS.test(host)) return true;
    return e.getAttribute("width") === "1" &&
      e.getAttribute("height") === "1" && host !== pageHost();
  }

  /** an element that never crosses (and nothing under it does) */
  function skipped(e: Element): boolean {
    const tag = e.localName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return true;
    if (
      e.hasAttribute("data-demo-skip") || e.hasAttribute("data-demo-overlay")
    ) return true;
    if (tag === "meta" && e.hasAttribute("http-equiv")) return true;
    if (tag === "link") {
      const rel = lower(e.getAttribute("rel")).split(/\s+/);
      return !rel.includes("stylesheet") && !rel.includes("icon");
    }
    if (tag === "img" && tracker(e)) return true;
    return false;
  }

  /** `n` or an ancestor is marked to be masked */
  function maskedAt(n: Node | null): boolean {
    for (let a = n; a && a.nodeType !== DOCUMENT; a = a.parentNode) {
      if (
        a.nodeType === ELEMENT && (a as Element).hasAttribute("data-demo-mask")
      ) return true;
    }
    return false;
  }

  /** the stage has `n`, attached where it is here: it and every ancestor mirrored, none skipped */
  function inPage(n: Node): boolean {
    if (!n.isConnected) return false;
    for (
      let a: Node | null = n;
      a && a.nodeType !== DOCUMENT;
      a = a.parentNode
    ) {
      if (!mirrored(a)) return false;
      if (a.nodeType === ELEMENT && skipped(a as Element)) return false;
    }
    return true;
  }

  const isStyle = (p: Node | null) =>
    !!p && p.nodeType === ELEMENT &&
    (p as Element).localName.toLowerCase() === "style";

  function textValue(t: CharacterData, masked: boolean): string {
    if (masked) return mask(t.data);
    return isStyle(t.parentNode) ? absCss(t.data, base()) : t.data;
  }

  function valueOf(e: Element, tag: string, masked: boolean): string {
    const v = String((e as HTMLInputElement).value ?? "");
    return masked || secretInput(e, tag) ? mask(v) : v;
  }

  function canvasUrl(e: Element): string | null {
    try {
      const c = e as HTMLCanvasElement;
      if (!c.width || !c.height) return null;
      const u = c.toDataURL();
      return u && u.startsWith("data:image/") ? u : null;
    } catch {
      return null; // a tainted canvas
    }
  }

  const isViewport = (e: Element) =>
    e === doc.scrollingElement || e === doc.documentElement;

  /** the state of `e` an attribute does not carry, as ops (and remembered as sent) */
  function stateOf(
    e: Element,
    i: number,
    tag: string,
    masked: boolean,
    out: Op[],
  ) {
    if (FORM.has(tag) && (!e.namespaceURI || e.namespaceURI === XHTML)) {
      const type = lower(e.getAttribute("type"));
      if (tag === "input" && (type === "checkbox" || type === "radio")) {
        formIds.add(i);
        const c = Boolean((e as HTMLInputElement).checked);
        lastChk.set(i, c);
        out.push({ o: "c", i, c });
      } else if (!(tag === "input" && NO_VALUE.has(type))) {
        formIds.add(i);
        const v = valueOf(e, tag, masked);
        lastVal.set(i, v);
        out.push({ o: "v", i, v });
      }
    }
    if (tag === "canvas") {
      canvasIds.add(i);
      const u = canvasUrl(e);
      if (u) {
        lastCanvas.set(i, u);
        out.push({ o: "cv", i, u });
      }
    }
    if (!isViewport(e)) {
      const x = e.scrollLeft || 0;
      const y = e.scrollTop || 0;
      if (x || y) {
        lastScroll.set(i, `${x},${y}`);
        out.push({ o: "s", i, x, y });
      }
    }
  }

  /** `n` and everything under it as it is now; null when it never crosses */
  function ser(
    n: Node,
    masked: boolean,
    out: Op[],
    fresh: Set<Node>,
  ): SNode | null {
    if (n.nodeType === TEXT) {
      const i = idFor(n);
      nodes.set(i, n);
      fresh.add(n);
      return { i, x: textValue(n as CharacterData, masked) };
    }
    if (n.nodeType !== ELEMENT) return null;
    const e = n as Element;
    if (skipped(e)) return null;
    const tag = tagOf(e);
    const i = idFor(e);
    nodes.set(i, e);
    fresh.add(e);
    const m = masked || e.hasAttribute("data-demo-mask");
    const s: SEl = { i, t: tag };
    const ns = nsOf(e);
    if (ns) s.ns = ns;
    const b = base();
    let a: Record<string, string> | undefined;
    for (const at of Array.from(e.attributes)) {
      if (!nameAllowed(tag, at.name)) continue;
      const v = attrValue(e, tag, at.name, at.value, m, b);
      if (v === null) continue;
      (a ??= {})[at.name] = v;
    }
    if (a) s.a = a;
    const c: SNode[] = [];
    const list: number[] = [];
    for (const k of Array.from(e.childNodes)) {
      const sk = ser(k, m, out, fresh);
      if (!sk) continue;
      c.push(sk);
      list.push(sk.i);
    }
    if (c.length) s.c = c;
    kids.set(i, list);
    stateOf(e, i, tag, m, out);
    return s;
  }

  function reset() {
    nodes.clear();
    kids.clear();
    formIds.clear();
    lastVal.clear();
    lastChk.clear();
    canvasIds.clear();
    lastCanvas.clear();
    lastScroll.clear();
    scrolled.clear();
    inked.clear();
    pending = [];
  }

  function forget(id: number) {
    nodes.delete(id);
    kids.delete(id);
    formIds.delete(id);
    lastVal.delete(id);
    lastChk.delete(id);
    canvasIds.delete(id);
    lastCanvas.delete(id);
    lastScroll.delete(id);
    inked.delete(id);
  }

  const onScroll = (e: Event) => {
    if (e.target) scrolled.add(e.target);
    schedule();
  };
  const onEvent = () => schedule();
  /** REQ-534 — a pointer on a mirrored canvas: its ink goes out within inkMs, not on the sweep */
  const onInk = (e: Event) => {
    const t = e.target as Node | null;
    if (!t || t.nodeType !== ELEMENT || tagOf(t as Element) !== "canvas") {
      return;
    }
    const id = ids.get(t);
    if (id === undefined || !canvasIds.has(id)) return;
    inked.add(id);
    scheduleInk();
  };
  const INK_EVENTS = ["pointerdown", "pointermove", "pointerup"] as const;

  function scheduleInk() {
    if (o.manual || !attached || inkTimer !== undefined) return;
    const wait = Math.max(0, inkMs - (now() - lastInk));
    inkTimer = setTimeout(() => {
      inkTimer = undefined;
      lastInk = now();
      inkDue = true;
      try {
        flush();
      } finally {
        inkDue = false;
      }
    }, wait);
  }

  function schedule() {
    if (o.manual || !attached || flushTimer !== undefined) return;
    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      flush();
    }, flushMs);
  }

  function attach() {
    if (attached || stopped) return;
    attached = true;
    if (!observer) {
      observer = new Observer((recs) => {
        for (const r of recs) pending.push(r);
        schedule();
      });
    }
    observer.observe(doc, {
      childList: true,
      attributes: true,
      characterData: true,
      subtree: true,
    });
    doc.addEventListener("input", onEvent, true);
    doc.addEventListener("change", onEvent, true);
    doc.addEventListener("scroll", onScroll, { capture: true, passive: true });
    win?.addEventListener("resize", onEvent);
    for (const t of INK_EVENTS) {
      doc.addEventListener(t, onInk, { capture: true, passive: true });
    }
    if (!o.manual) {
      sweepTimer = setInterval(() => {
        flush();
        beat();
      }, sweepMs);
    }
  }

  /** REQ-309 — nothing went out for heartbeatMs while somebody watches: an empty frame */
  function beat() {
    if (!attached || now() - lastEmit < heartbeatMs) return;
    emit({ t: "ops", ops: [] });
  }

  function detach() {
    if (!attached) return;
    attached = false;
    observer?.disconnect();
    doc.removeEventListener("input", onEvent, true);
    doc.removeEventListener("change", onEvent, true);
    doc.removeEventListener("scroll", onScroll, { capture: true });
    win?.removeEventListener("resize", onEvent);
    for (const t of INK_EVENTS) {
      doc.removeEventListener(t, onInk, { capture: true });
    }
    clearTimeout(flushTimer);
    flushTimer = undefined;
    clearTimeout(inkTimer);
    inkTimer = undefined;
    clearInterval(sweepTimer);
    sweepTimer = undefined;
    reset();
  }

  function snapshot() {
    if (stopped) return;
    attach();
    observer?.takeRecords();
    reset();
    const root = doc.documentElement;
    if (!root) return;
    const out: Op[] = [];
    const s = ser(root, false, out, new Set());
    if (!s || "x" in s) return;
    const x = win?.scrollX ?? 0;
    const y = win?.scrollY ?? 0;
    out.push({ o: "s", i: 0, x, y });
    lastWin = `${x},${y}`;
    const w = win?.innerWidth || 1;
    const h = win?.innerHeight || 1;
    lastSize = `${w}x${h}`;
    lastUrl = here();
    lastCanvasSweep = Date.now();
    emit({ t: "snap", w, h, u: lastUrl, root: s, ops: out });
  }

  const depth = (n: Node) => {
    let d = 0;
    for (let a = n.parentNode; a; a = a.parentNode) d++;
    return d;
  };

  function flush() {
    if (!attached) return;
    const recs = pending.concat(observer?.takeRecords() ?? []);
    pending = [];
    const b = base();

    // 1. what the records say: parents whose children changed, nodes that left the page at some
    //    point (they are sent whole if they are back), attributes, texts
    const dirty = new Set<Node>();
    const out = new Set<Node>();
    const attrs = new Map<Node, Set<string>>();
    const texts = new Set<Node>();
    let resnap = false;
    for (const r of recs) {
      const tg = r.target;
      if (r.type === "childList") {
        if (tg.nodeType === DOCUMENT) resnap = true;
        dirty.add(tg);
        for (const n of Array.from(r.removedNodes)) out.add(n);
      } else if (r.type === "attributes") {
        const name = r.attributeName ?? "";
        if (tg.nodeType !== ELEMENT) continue;
        if (structural(tagOf(tg as Element), name)) {
          if (tg === doc.documentElement) resnap = true;
          out.add(tg);
          if (tg.parentNode) dirty.add(tg.parentNode);
        }
        let s = attrs.get(tg);
        if (!s) attrs.set(tg, s = new Set());
        s.add(name);
      } else if (r.type === "characterData") {
        texts.add(tg);
      }
    }
    if (resnap) return snapshot();

    const ops: Op[] = [];
    const state: Op[] = [];
    const fresh = new Set<Node>();
    let left = false;

    // 2. the child lists, shallow first: a subtree sent whole covers every change inside it
    const parents = [...dirty]
      .filter((p) => p.nodeType === ELEMENT && mirrored(p))
      .map((p) => ({ p, d: depth(p) }))
      .sort((x, y) => x.d - y.d);
    for (const { p } of parents) {
      if (fresh.has(p) || !inPage(p)) continue;
      const pid = ids.get(p)!;
      const before = kids.get(pid) ?? [];
      const had = new Set(before);
      const m = maskedAt(p);
      const list: (number | SNode)[] = [];
      const now: number[] = [];
      let added = false;
      for (const c of Array.from(p.childNodes)) {
        const cid = ids.get(c);
        if (
          cid !== undefined && had.has(cid) && nodes.get(cid) === c &&
          !out.has(c)
        ) {
          list.push(cid);
          now.push(cid);
          continue;
        }
        const s = ser(c, m, state, fresh);
        if (!s) continue;
        list.push(s);
        now.push(s.i);
        added = true;
      }
      if (
        !added && now.length === before.length &&
        now.every((x, k) => x === before[k])
      ) {
        continue;
      }
      const kept = new Set(now);
      if (before.some((x) => !kept.has(x))) left = true;
      kids.set(pid, now);
      ops.push({ o: "k", i: pid, c: list });
    }

    // 3. what left the page for good: everything the stage has that its tree no longer reaches
    const gone: number[] = [];
    if (left || fresh.size > 0) {
      const root = doc.documentElement
        ? ids.get(doc.documentElement)
        : undefined;
      const live = new Set<number>();
      const stack = root === undefined ? [] : [root];
      while (stack.length) {
        const id = stack.pop()!;
        if (live.has(id)) continue;
        live.add(id);
        for (const k of kids.get(id) ?? []) stack.push(k);
      }
      for (const id of nodes.keys()) if (!live.has(id)) gone.push(id);
      for (const id of gone) forget(id);
    }
    ops.push(...state);

    // 4. attributes and texts of the nodes the stage keeps
    /** REQ-380 — canvases whose width/height was set: their bitmap goes again, after the ops */
    const resized: number[] = [];
    for (const [n, names] of attrs) {
      if (fresh.has(n) || !mirrored(n)) continue;
      const e = n as Element;
      const id = ids.get(e)!;
      const tag = tagOf(e);
      const m = maskedAt(e);
      for (const name of names) {
        if (!nameAllowed(tag, name)) continue;
        const raw = e.getAttribute(name);
        const v = raw === null ? null : attrValue(e, tag, name, raw, m, b);
        ops.push({ o: "a", i: id, n: name, v });
        if (
          tag === "canvas" && /^(width|height)$/i.test(name) &&
          !resized.includes(id)
        ) resized.push(id);
      }
    }
    for (const id of resized) {
      const cu = canvasUrl(nodes.get(id) as Element);
      if (cu) {
        lastCanvas.set(id, cu);
        ops.push({ o: "cv", i: id, u: cu });
      }
    }
    for (const n of texts) {
      if (fresh.has(n) || n.nodeType !== TEXT || !mirrored(n)) continue;
      ops.push({
        o: "x",
        i: ids.get(n)!,
        x: textValue(n as CharacterData, maskedAt(n.parentNode)),
      });
    }

    // 5. what changes without a record: values (typed, or set by code), checked boxes
    for (const id of formIds) {
      const e = nodes.get(id) as Element | undefined;
      if (!e || fresh.has(e)) continue;
      const tag = tagOf(e);
      if (lastChk.has(id)) {
        const c = Boolean((e as HTMLInputElement).checked);
        if (c !== lastChk.get(id)) {
          lastChk.set(id, c);
          ops.push({ o: "c", i: id, c });
        }
      } else {
        const v = valueOf(e, tag, maskedAt(e));
        if (v !== lastVal.get(id)) {
          lastVal.set(id, v);
          ops.push({ o: "v", i: id, v });
        }
      }
    }

    // 6. scrolls: the window's, and every scrolled element's
    for (const t of scrolled) {
      const n = t as Node;
      if (
        n.nodeType === DOCUMENT ||
        (n.nodeType === ELEMENT && isViewport(n as Element))
      ) {
        const x = win?.scrollX ?? 0;
        const y = win?.scrollY ?? 0;
        if (`${x},${y}` !== lastWin) {
          lastWin = `${x},${y}`;
          ops.push({ o: "s", i: 0, x, y });
        }
        continue;
      }
      if (n.nodeType !== ELEMENT || fresh.has(n) || !mirrored(n)) continue;
      const e = n as Element;
      const id = ids.get(e)!;
      const x = e.scrollLeft || 0;
      const y = e.scrollTop || 0;
      if (`${x},${y}` !== (lastScroll.get(id) ?? "0,0")) {
        lastScroll.set(id, `${x},${y}`);
        ops.push({ o: "s", i: id, x, y });
      }
    }
    scrolled.clear();

    // 7. the viewport, the page (pushState keeps the document), the canvases (now and then)
    const w = win?.innerWidth || 1;
    const h = win?.innerHeight || 1;
    if (`${w}x${h}` !== lastSize) {
      lastSize = `${w}x${h}`;
      ops.push({ o: "w", w, h });
    }
    const u = here();
    if (u !== lastUrl) {
      lastUrl = u;
      ops.push({ o: "u", u });
    }
    const sweep = !o.manual && Date.now() - lastCanvasSweep >= 1_000;
    if (sweep) lastCanvasSweep = Date.now();
    // REQ-534 — every canvas on the 1 s sweep; between sweeps, the ones a pointer drew on
    const ink = (inkDue || o.manual) && inked.size > 0;
    if (sweep || ink) {
      for (const id of sweep ? canvasIds : inked) {
        const e = nodes.get(id) as Element | undefined;
        if (!e || fresh.has(e)) continue;
        const cu = canvasUrl(e);
        if (cu && cu !== lastCanvas.get(id)) {
          lastCanvas.set(id, cu);
          ops.push({ o: "cv", i: id, u: cu });
        }
      }
      inked.clear();
    }

    if (gone.length) ops.push({ o: "g", i: gone });
    if (ops.length) emit({ t: "ops", ops });
  }

  return {
    snapshot,
    flush,
    beat,
    pause: detach,
    stop() {
      detach();
      stopped = true;
      observer = null;
    },
    idOf(n) {
      let a: Node | null = n && n.nodeType === ELEMENT
        ? n
        : n?.parentNode ?? null;
      for (; a && a.nodeType !== DOCUMENT; a = a.parentNode) {
        if (a.nodeType === ELEMENT && mirrored(a)) return ids.get(a)!;
      }
      return null;
    },
    nodeOf(id) {
      const n = nodes.get(id);
      return n && n.nodeType === ELEMENT ? n as Element : null;
    },
    stats: () => ({ cv: cvSent }),
  };
}
