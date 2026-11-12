/**
 * REQ-242 — the stage's side of the demo mirror: the customer's frames, replayed into the stage's
 * one frame — a srcdoc document, sandboxed with `allow-same-origin` and never `allow-scripts`,
 * whose CSP forbids scripts, frames, objects, media, connections, form posts and a <base>. The
 * stage page (same origin) builds the customer's tree into it with the frame's own document;
 * nothing in it runs, and the only things it fetches are the customer's styles, fonts and images.
 *
 * A snapshot replaces the frame's whole `<html>` (the CSP stays: it was set when the shell was
 * parsed); ops after it must name nodes the replay has, or `apply` says no — a desync is never
 * papered over, the stage asks for a fresh snapshot instead.
 *
 * REQ-309 (demo M19) — but a desync is no longer fatal: an op that does not fit is skipped (best
 * effort — a kept child the replay has elsewhere is moved here, a missing one left out, a node
 * said gone but still here is taken out) and the rest of the frame, and the frames after it, still
 * apply; `apply` still says no, so the stage asks for a snapshot, but the mirror does not freeze
 * until it lands. A snapshot that throws, or ops before any snapshot, still fail hard.
 *
 * Pointers: `anchorAt` says which mirrored element is under a point of the frame and where in its
 * box; `pointOf` turns such an anchor back into a point — the same element on both screens.
 *
 * Scrolls: a scroll is applied as it comes, but an element is a scroller only once its stylesheet
 * is in (and a page is only as long as its images let it be), so the latest scroll of every node is
 * kept and `settle()` applies them again once the replay's styles have loaded.
 */
import type {
  MirrorFrame,
  Op,
  SNode,
} from "../../../shared/demo-mode/mirror.ts";
import type { NodeAnchor } from "../../../shared/demo-mode/protocol.ts";

/** the frame's shell: nothing but the policy; the first snapshot replaces the rest */
export const MIRROR_SRCDOC =
  `<!doctype html><html><head><meta charset="utf-8">` +
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ` +
  `img-src * data: blob:; style-src * 'unsafe-inline'; font-src * data:; ` +
  `script-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; ` +
  `object-src 'none'; media-src 'none'; connect-src 'none'; manifest-src 'none'; ` +
  `form-action 'none'; base-uri 'none'">` +
  `</head><body></body></html>`;

export interface ReplayerOptions {
  /** paint a canvas with a bitmap (a data URL); the default draws it with an Image */
  paintCanvas?(c: HTMLCanvasElement, url: string): void;
}

export interface Replayer {
  /** a frame applied; false when it does not fit the replay (the stage asks for a snapshot) */
  apply(f: MirrorFrame): boolean;
  /** the customer's viewport, CSS px (null before the first snapshot) */
  size(): { w: number; h: number } | null;
  /** the customer's page (pathname + search) */
  path(): string | null;
  nodeOf(id: number): Node | null;
  /** the mirrored element under a point of the frame, and the point's fraction of its box */
  anchorAt(x: number, y: number): NodeAnchor | null;
  /** the point an anchor names in the frame; null when the element is gone or has no box */
  pointOf(a: NodeAnchor): { x: number; y: number } | null;
  /** every node's latest scroll, applied again where the replay lost it */
  settle(): void;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const MATH_NS = "http://www.w3.org/1998/Math/MathML";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const XML_NS = "http://www.w3.org/XML/1998/namespace";

/** never built as themselves, whatever a frame says (the sender never sends them) */
const DENY = new Set(["script", "noscript", "base", "template"]);
const EMBED = new Set(["iframe", "frame", "object", "embed"]);
const URLISH = new Set(["href", "src", "xlink:href", "action", "formaction"]);

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function defaultPaint(c: HTMLCanvasElement, url: string): void {
  const img = new Image();
  img.onload = () => {
    try {
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
    } catch {
      // the canvas went away
    }
  };
  img.src = url;
}

export function createReplayer(
  doc: Document,
  opts: ReplayerOptions = {},
): Replayer {
  const paint = opts.paintCanvas ?? defaultPaint;
  let byId = new Map<number, Node>();
  let idOf = new WeakMap<Node, number>();
  /** the latest scroll of every node (0: the window) */
  const scrolls = new Map<number, { x: number; y: number }>();
  let view: { w: number; h: number } | null = null;
  let at: string | null = null;
  /** a snapshot has been applied and nothing has failed since */
  let ok = false;

  const reg = (i: number, n: Node) => {
    byId.set(i, n);
    idOf.set(n, i);
  };

  function setAttr(e: Element, tag: string, k: string, v: string) {
    const lk = k.toLowerCase();
    if (lk.startsWith("on") || lk === "srcdoc" || lk === "http-equiv") return;
    if (EMBED.has(tag) && (lk === "src" || lk === "data")) return;
    if (URLISH.has(lk) && /^\s*(javascript|vbscript):/i.test(v)) return;
    try {
      if (lk.startsWith("xlink:")) e.setAttributeNS(XLINK_NS, k, v);
      else if (lk.startsWith("xml:")) e.setAttributeNS(XML_NS, k, v);
      else e.setAttribute(k, v);
    } catch {
      // a name this DOM refuses: the attribute is left out
    }
  }

  function build(s: SNode): Node {
    if ("x" in s) {
      const t = doc.createTextNode(s.x);
      reg(s.i, t);
      return t;
    }
    const tag = DENY.has(s.t.toLowerCase()) ? "template" : s.t;
    const e = s.ns === "svg"
      ? doc.createElementNS(SVG_NS, tag)
      : s.ns === "math"
      ? doc.createElementNS(MATH_NS, tag)
      : doc.createElement(tag);
    const lt = tag.toLowerCase();
    if (s.a) { for (const [k, v] of Object.entries(s.a)) setAttr(e, lt, k, v); }
    if (s.c) { for (const c of s.c) e.appendChild(build(c)); }
    reg(s.i, e);
    return e;
  }

  /** `p`'s children become exactly `list`, in order (nodes not in it leave) */
  function setChildren(p: Node, list: Node[]) {
    const want = new Set(list);
    for (const c of Array.from(p.childNodes)) {
      if (!want.has(c)) p.removeChild(c);
    }
    for (let k = 0; k < list.length; k++) {
      const cur = p.childNodes[k] ?? null;
      if (cur !== list[k]) p.insertBefore(list[k], cur);
    }
  }

  const el = (i: number): Element | null => {
    const n = byId.get(i);
    return n && n.nodeType === 1 ? n as Element : null;
  };
  const scroller = (i: number): Element | null =>
    i === 0 ? doc.scrollingElement ?? doc.documentElement : el(i);

  function run(op: Op): boolean {
    switch (op.o) {
      case "k": {
        const p = el(op.i);
        if (!p) return false;
        const list: Node[] = [];
        let fit = true;
        for (const c of op.c) {
          if (typeof c === "number") {
            // a child by id is one the replay has, where it was
            const n = byId.get(c);
            if (!n) {
              fit = false; // REQ-309 — left out; the snapshot asked for brings it
              continue;
            }
            if (n.parentNode !== p) fit = false; // REQ-309 — moved here: the customer has it here
            list.push(n);
          } else list.push(build(c));
        }
        setChildren(p, list);
        return fit;
      }
      case "a": {
        const e = el(op.i);
        if (!e) return false;
        if (op.v === null) e.removeAttribute(op.n);
        else setAttr(e, e.localName.toLowerCase(), op.n, op.v);
        return true;
      }
      case "x": {
        const t = byId.get(op.i);
        if (!t || t.nodeType !== 3) return false;
        (t as CharacterData).data = op.x;
        return true;
      }
      case "v": {
        const e = el(op.i);
        if (!e) return false;
        (e as HTMLInputElement).value = op.v;
        return true;
      }
      case "c": {
        const e = el(op.i);
        if (!e) return false;
        (e as HTMLInputElement).checked = op.c;
        return true;
      }
      case "s": {
        const e = scroller(op.i);
        if (!e) return op.i === 0;
        e.scrollLeft = op.x;
        e.scrollTop = op.y;
        scrolls.set(op.i, { x: op.x, y: op.y });
        return true;
      }
      case "w":
        view = { w: op.w, h: op.h };
        return true;
      case "u":
        at = op.u;
        return true;
      case "g": {
        let fit = true;
        for (const id of op.i) {
          const n = byId.get(id);
          if (!n) continue;
          // gone from the customer's page, still on this one: the two have drifted apart —
          // REQ-309: taken out here too (the customer has no such node), and reported
          if (doc.contains(n)) {
            fit = false;
            n.parentNode?.removeChild(n);
          }
          byId.delete(id);
          scrolls.delete(id);
        }
        return fit;
      }
      case "cv": {
        const e = el(op.i);
        if (!e) return false;
        paint(e as HTMLCanvasElement, op.u);
        return true;
      }
    }
  }

  return {
    apply(f) {
      if (f.t === "snap") {
        try {
          byId = new Map();
          idOf = new WeakMap();
          scrolls.clear();
          const root = build(f.root);
          const old = doc.documentElement;
          if (old) doc.replaceChild(root, old);
          else doc.appendChild(root);
          view = { w: f.w, h: f.h };
          at = f.u;
          ok = true;
        } catch {
          ok = false;
          return false;
        }
      } else if (!ok) return false;
      // REQ-309 — an op that does not fit is skipped and the rest still applies: the frame is
      // reported (the stage asks for a snapshot) but the mirror no longer freezes until it lands
      let fit = true;
      for (const op of f.ops) {
        try {
          if (!run(op)) fit = false;
        } catch {
          fit = false;
        }
      }
      return fit;
    },
    size: () => view,
    path: () => at,
    nodeOf: (id) => byId.get(id) ?? null,
    anchorAt(x, y) {
      let n: Node | null = null;
      try {
        n = doc.elementFromPoint(x, y);
      } catch {
        return null;
      }
      for (; n && n.nodeType !== 9; n = n.parentNode) {
        const id = idOf.get(n);
        if (id === undefined || n.nodeType !== 1 || byId.get(id) !== n) {
          continue;
        }
        const r = (n as Element).getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        return {
          id,
          x: clamp01((x - r.left) / r.width),
          y: clamp01((y - r.top) / r.height),
        };
      }
      return null;
    },
    pointOf(a) {
      const n = byId.get(a.id);
      if (!n || n.nodeType !== 1 || !doc.contains(n)) return null;
      const r = (n as Element).getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return null;
      return { x: r.left + r.width * a.x, y: r.top + r.height * a.y };
    },
    settle() {
      for (const [i, s] of scrolls) {
        const e = scroller(i);
        if (!e) continue;
        try {
          if (e.scrollLeft !== s.x) e.scrollLeft = s.x;
          if (e.scrollTop !== s.y) e.scrollTop = s.y;
        } catch {
          // gone mid-way
        }
      }
    },
  };
}
