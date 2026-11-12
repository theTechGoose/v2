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
 *
 * REQ-305 — and not only on the stage's timers: the replay settles its scrolls again, and tells
 * the stage its layout may have moved (`onLayout` — the pointers anchored to its nodes are placed
 * again), after every applied frame (on the next animation frame), when a stylesheet, an image or
 * a font of the frame loads, and when the page grows (a ResizeObserver on its html and body); a
 * scroll of the frame tells the stage too. A scroll is put on at once, never animated by the
 * page's own `scroll-behavior: smooth` (the quote page's): the customer's smooth scroll arrives as
 * its steps, and a pointer placed after a scroll op is placed against the position it names, not
 * one halfway there. `styled()` says whether every stylesheet the replay links is in: until then
 * the browser lays the frame out without them (the page's links stacked top-left, a drawer in the
 * flow), so the stage looks for no node under its presenter's pointer in it.
 *
 * REQ-451 (demo-loop cycle 3, M1 + M14) — nor is a styled replay's layout the customer's yet while
 * its web fonts and the images it fetches are still coming in (a logo with no height pulls the
 * whole page up): `settled()` says it is — no font loading, every stylesheet's and image's load
 * (or error) event in, never its `sheet` or `complete` alone (the frame was still laid out without
 * them) —
 * or SETTLE_CAP_MS after the snapshot (one that never comes holds nothing for good, and the stage
 * is told then); once settled a snapshot stays so (a later change moves both screens alike). The
 * stage takes the node under its presenter's still mouse only from a settled replay: his pointer
 * is what he pointed at, so a node taken from a half-built page would stay the wrong one.
 *
 * REQ-380 (demo-loop cycle 2, M10) — a canvas keeps its picture: setting a canvas's width or
 * height, even to the value it had, clears its bitmap, and the customer's page does exactly that
 * (the /q signature pad's setupCanvas, on mount and on every resize) before redrawing the same
 * strokes — so the customer's bitmap reads as before and nothing new is sent. The replay keeps
 * every canvas's last bitmap and paints it again after any width/height op on it; a bitmap still
 * decoding never paints over a newer one. `stats()` counts the bitmaps applied and the repaints
 * (the stage's dev pill shows them).
 *
 * REQ-547 (demo-loop cycle 4, M21 + m32) — a snapshot never animates from its unstyled look. Its
 * page is built at once and its stylesheets come in a moment later; when they do, every element
 * whose look they change ran its CSS transition FROM the unstyled look (measured in Chromium: the
 * customers board's closed back panel faded 1 → 0 over 240 ms, its "No subscriptions" text a
 * ghost over the card) — a state the customer never had. So every transition and animation in the
 * frame is held still (STILL_CSS, an adopted sheet of the stage's own: no op of the customer's can
 * remove it) from a snapshot until it has settled, and again while a stylesheet an op added is
 * loading; it is let go only after the frame's styles were computed with it on (else the browser
 * computes both at once and runs the transitions anyway — measured). And a later snapshot (a
 * rejoin, another page) whose sheets this frame has not loaded yet keeps the previous page on show
 * while they load — preloaded into it as `media="not all"` sheets, never applied to it — and goes
 * in once they are (from the cache: styled at once), or HOLD_CAP_MS after it came. Its ops apply
 * to it meanwhile; `styled()` and `settled()` say false until it is in. The first snapshot is
 * never held: there is nothing to keep, and the stage hides the frame until it is styled (REQ-370).
 *
 * REQ-638 (demo-loop cycle 5, M11) — a native select's open list is drawn by the customer's
 * browser outside the DOM; the recorder marks the select `data-mirror-open` while it is open.
 * The replay draws a static listbox of that select's mirrored options right under it (above it
 * when there is no room below), the chosen one highlighted — the stage's own element, never a
 * mirrored node: no id, no pointer anchor (`pointer-events: none`), redrawn after every frame and
 * every layout pass, gone once the mark is.
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
  // REQ-290 (demo m17): a backdrop-filter mirrored into this CSS-scaled frame paints
  // reflected edge samples (a mirrored "ghost" of the page under an overlay); the stage is
  // non-interactive, so the blur is cosmetic and nothing in it may use one.
  `<style>* { backdrop-filter: none !important; -webkit-backdrop-filter: none !important }</style>` +
  `</head><body></body></html>`;

/** REQ-451 — how long after a snapshot its fonts and images are waited for, at most, before its
 *  layout counts as the customer's anyway */
export const SETTLE_CAP_MS = 2_500;

/** REQ-547 — every transition and animation of the frame, held still while a snapshot settles */
export const STILL_CSS = "*,*::before,*::after{transition:none!important;" +
  "animation-duration:0s!important;animation-delay:0s!important}";

/** REQ-547 — the longest a later snapshot waits for its stylesheets before it replaces the page on
 *  show anyway (under the stage's STYLE_WAIT_MS, which reveals a new demo's frame regardless) */
export const HOLD_CAP_MS = 1_200;

export interface ReplayerOptions {
  /** paint a canvas with a bitmap (a data URL); the default draws it with an Image */
  paintCanvas?(c: HTMLCanvasElement, url: string): void;
  /** REQ-305 — the replay's layout may have changed and its scrolls were settled: the pointers
   *  anchored to its nodes are to be placed again */
  onLayout?(): void;
  /** REQ-305 — how a settle pass is scheduled (the default: the next animation frame; jest hands
   *  in its own) */
  schedule?(fn: () => void): void;
  /** REQ-305 — the ResizeObserver that watches the page's size (the frame window's by default;
   *  null for none; jest hands in its own) */
  Resize?: typeof ResizeObserver | null;
  /** REQ-451 — the clock `settled()` measures SETTLE_CAP_MS with (jest hands in its own) */
  now?(): number;
  /** REQ-451 — run `fn` once after `ms` (the cap's layout pass); says how to cancel it */
  later?(fn: () => void, ms: number): () => void;
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
  /** REQ-437 — the box of the element an anchor names, in the frame; null when gone or boxless */
  rectOf(
    a: NodeAnchor,
  ): { left: number; top: number; width: number; height: number } | null;
  /** every node's latest scroll, applied again where the replay lost it */
  settle(): void;
  /** REQ-305 — every stylesheet the replay links has loaded (or failed): its layout is the customer's */
  styled(): boolean;
  /** REQ-451 — styled, and its web fonts and images are in too (or SETTLE_CAP_MS has passed since
   *  the snapshot): the node under a point is the one under it on the customer's screen. Stays
   *  true until the next snapshot */
  settled(): boolean;
  /** REQ-547 — the frame's transitions and animations are held still (a snapshot, or a stylesheet
   *  an op added, is not settled yet) */
  still(): boolean;
  /** REQ-305 — stop watching the frame's document */
  dispose(): void;
  /** REQ-380 — canvas bitmaps that arrived (`cv` ops), were applied to a canvas, and were
   *  repainted after a width/height op */
  stats(): { seen: number; cv: number; repaints: number };
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

/** REQ-638 — the recorder's mark of a select whose list is open, and the stage's drawn list */
export const OPEN_ATTR = "data-mirror-open";
export const LISTBOX_ATTR = "data-mirror-listbox";

const LIST_CSS = "position:fixed;z-index:2147483647;pointer-events:none;" +
  "box-sizing:border-box;margin:0;padding:4px 0;display:block;visibility:visible;" +
  "opacity:1;transform:none;overflow:hidden;background:#fff;color:#1f1f1f;" +
  "border:1px solid #8f8f8f;border-radius:4px;" +
  "box-shadow:0 6px 16px rgba(0,0,0,.22);text-align:left;white-space:nowrap;" +
  "line-height:1.4;";
const ROW_CSS = "display:block;padding:3px 12px;margin:0;";
const ROW_ON_CSS = "background:#1a73e8;color:#fff;";
const ROW_OFF_CSS = "color:#9a9a9a;";
const GROUP_CSS = "display:block;padding:3px 8px;margin:0;font-weight:bold;";
/** the most rows the drawn list shows (Chrome's popup shows about 20 before it scrolls) */
const LIST_ROWS = 20;

const squash = (t: string) => t.replace(/\s+/g, " ").trim();

/** REQ-638 — an option's label as a select shows it, and its value */
function optLabel(o: Element): string {
  const l = o.getAttribute("label");
  return l !== null && l !== "" ? l : squash(o.textContent ?? "");
}
function optValue(o: Element): string {
  const v = o.getAttribute("value");
  return v !== null ? v : squash(o.textContent ?? "");
}

/** REQ-305 — a scroll put on at once: `behavior: "instant"` overrides the page's own
 *  `scroll-behavior: smooth` (an assignment to scrollTop would start an animation) */
function scrollNow(e: Element, x: number, y: number): void {
  if (typeof e.scrollTo === "function") {
    e.scrollTo({ left: x, top: y, behavior: "instant" });
  } else {
    e.scrollLeft = x;
    e.scrollTop = y;
  }
}

/** REQ-305 — a linked stylesheet the browser will load: one with an address, neither disabled nor
 *  an alternate (those never load, and must not hold the replay "unstyled" for good) */
function awaited(l: Element): boolean {
  const rel = (l.getAttribute("rel") ?? "").toLowerCase().split(/\s+/);
  return rel.includes("stylesheet") && !rel.includes("alternate") &&
    !l.hasAttribute("disabled") && (l.getAttribute("href") ?? "").trim() !== "";
}

/** REQ-451 — an image the browser fetches now: one with an address, and not one it holds back
 *  until it is scrolled near (`loading="lazy"`: mostly below the fold, never waited for) */
function fetched(e: Element): boolean {
  const src = (e.getAttribute("src") ?? "").trim() ||
    (e.getAttribute("srcset") ?? "").trim();
  return src !== "" &&
    (e.getAttribute("loading") ?? "").trim().toLowerCase() !== "lazy";
}

/** REQ-380 — the bitmap each canvas should show, and its decoded image once it has loaded */
const wanted = new WeakMap<
  HTMLCanvasElement,
  { url: string; img: HTMLImageElement | null }
>();

function draw(c: HTMLCanvasElement, img: HTMLImageElement): void {
  try {
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
  } catch {
    // the canvas went away
  }
}

function defaultPaint(c: HTMLCanvasElement, url: string): void {
  const had = wanted.get(c);
  // REQ-380 — the same bitmap again (a repaint after a width/height set): drawn at once
  if (had && had.url === url && had.img) return draw(c, had.img);
  const w = { url, img: null as HTMLImageElement | null };
  wanted.set(c, w);
  const img = new Image();
  img.onload = () => {
    // REQ-380 — a newer bitmap was asked for meanwhile: this one never paints over it
    if (wanted.get(c) !== w) return;
    w.img = img;
    draw(c, img);
  };
  img.src = url;
}

export function createReplayer(
  doc: Document,
  opts: ReplayerOptions = {},
): Replayer {
  const paint = opts.paintCanvas ?? defaultPaint;
  /** REQ-380 — every canvas's last bitmap, by id: painted again after a width/height op */
  const bitmaps = new Map<number, string>();
  const counts = { seen: 0, cv: 0, repaints: 0 };
  let byId = new Map<number, Node>();
  let idOf = new WeakMap<Node, number>();
  /** the latest scroll of every node (0: the window) */
  const scrolls = new Map<number, { x: number; y: number }>();
  let view: { w: number; h: number } | null = null;
  let at: string | null = null;
  /** a snapshot has been applied and nothing has failed since */
  let ok = false;
  /** REQ-305 — the stylesheets the replay links, and the nodes whose load (or error) has fired */
  let sheets = new Set<Element>();
  const loaded = new WeakSet<Node>();
  /** REQ-451 — the images the replay fetches, when its snapshot was applied, whether it has
   *  settled since, and the cap's pending pass */
  let images = new Set<Element>();
  let snapAt = 0;
  let isSettled = false;
  let cancelCap: (() => void) | null = null;
  const now = opts.now ??
    (() => typeof performance !== "undefined" ? performance.now() : Date.now());
  const later = opts.later ??
    ((fn: () => void, ms: number) => {
      const t = setTimeout(fn, ms);
      // never what keeps a process (jest) alive
      (t as unknown as { unref?: () => void }).unref?.();
      return () => clearTimeout(t);
    });
  const schedule = opts.schedule ??
    ((fn: () => void) =>
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(() => fn())
        : setTimeout(fn, 0));
  let due: { settle: boolean } | null = null;
  let disposed = false;
  /** REQ-547 — the still rule is on, the sheet (or, with no adoptedStyleSheets, the <style>) that
   *  carries it, and the hrefs of the stylesheets this frame has loaded (or failed) */
  let stillOn = false;
  let stillSheet: CSSStyleSheet | null = null;
  let stillEl: Element | null = null;
  const readyHrefs = new Set<string>();
  /** REQ-547 — the rules of every same-origin stylesheet this frame has loaded, by href; and the
   *  constructed copies of them a page just put in the frame is styled by until its own links
   *  are in (a fresh <link> is never styled at once, even with its file in the cache — measured) */
  const copies = new Map<string, string>();
  let bridge: CSSStyleSheet[] = [];
  /** REQ-547 — a later snapshot, built and kept out of the frame while its sheets preload; and
   *  whether an op just added a stylesheet the frame has to wait for */
  let pending:
    | { root: Node; preloads: Set<Element>; cancel: () => void }
    | null = null;
  let newSheet = false;
  /** REQ-638 — the selects marked open, and the lists drawn for them (with what they show) */
  let opened = new Set<Element>();
  let drawn: { box: Element; key: string }[] = [];

  const kidEls = (e: Element) =>
    Array.from(e.childNodes).filter((c) => c.nodeType === 1) as Element[];

  /** REQ-638 — a list under every open select (above it when there is no room below) */
  function drawLists() {
    if (pending) return; // a held snapshot: its lists are drawn once it is in
    const want: { sel: Element; key: string }[] = [];
    for (const sel of opened) {
      if (!sel.hasAttribute(OPEN_ATTR) || !doc.contains(sel)) {
        opened.delete(sel);
        continue;
      }
      const r = sel.getBoundingClientRect();
      const rows: string[] = [];
      for (const k of kidEls(sel)) {
        const t = k.localName.toLowerCase();
        if (t === "option") rows.push(`o${optLabel(k)}`);
        else if (t === "optgroup") {
          rows.push(`g${k.getAttribute("label") ?? ""}`);
          for (const o of kidEls(k)) {
            if (o.localName.toLowerCase() === "option") {
              rows.push(`o${optLabel(o)}`);
            }
          }
        }
      }
      const v = String((sel as HTMLSelectElement).value ?? "");
      want.push({
        sel,
        key: [r.left, r.top, r.width, r.height, v, ...rows].join("\u0001"),
      });
    }
    // nothing changed (the same lists, still in the page): nothing to do
    if (
      want.length === drawn.length &&
      want.every((w, k) => drawn[k].key === w.key && doc.contains(drawn[k].box))
    ) return;
    for (const d of drawn) d.box.parentNode?.removeChild(d.box);
    drawn = [];
    const at = doc.documentElement;
    if (!at) return;
    for (const { sel, key } of want) {
      const box = drawList(sel);
      at.appendChild(box);
      place(box, sel);
      drawn.push({ box, key });
    }
  }

  /** REQ-638 — the static list of `sel`'s options: its chosen one highlighted */
  function drawList(sel: Element): Element {
    const box = doc.createElement("div");
    box.setAttribute(LISTBOX_ATTR, "");
    box.setAttribute("role", "listbox");
    box.setAttribute("aria-hidden", "true");
    let font = "font-size:15px;";
    try {
      const cs = doc.defaultView?.getComputedStyle?.(sel);
      if (cs?.fontSize) {
        font = `font-family:${cs.fontFamily};font-size:${cs.fontSize};`;
      }
    } catch {
      // no styles here
    }
    const v = String((sel as HTMLSelectElement).value ?? "");
    let chosen = false;
    const row = (o: Element, indent: boolean) => {
      if (o.hasAttribute("hidden")) return;
      const d = doc.createElement("div");
      d.setAttribute("role", "option");
      const on = !chosen && optValue(o) === v;
      if (on) chosen = true;
      d.setAttribute("aria-selected", on ? "true" : "false");
      d.setAttribute(
        "style",
        ROW_CSS + (indent ? "padding-left:24px;" : "") +
          (on ? ROW_ON_CSS : o.hasAttribute("disabled") ? ROW_OFF_CSS : ""),
      );
      d.appendChild(doc.createTextNode(optLabel(o)));
      box.appendChild(d);
    };
    for (const k of kidEls(sel)) {
      const t = k.localName.toLowerCase();
      if (t === "option") row(k, false);
      else if (t === "optgroup") {
        const g = doc.createElement("div");
        g.setAttribute("data-mirror-group", "");
        g.setAttribute("style", GROUP_CSS);
        g.appendChild(doc.createTextNode(k.getAttribute("label") ?? ""));
        box.appendChild(g);
        for (const o of kidEls(k)) {
          if (o.localName.toLowerCase() === "option") row(o, true);
        }
      }
    }
    const r = sel.getBoundingClientRect();
    box.setAttribute(
      "style",
      LIST_CSS + font + `min-width:${Math.max(0, r.width)}px;` +
        `max-height:calc(${LIST_ROWS} * 1.4em + 10px);`,
    );
    return box;
  }

  /** REQ-638 — the list right under its select, or above it when it would run off the bottom */
  function place(box: Element, sel: Element) {
    const r = sel.getBoundingClientRect();
    const base = box.getAttribute("style") ?? "";
    let top = r.top + r.height;
    try {
      const h = box.getBoundingClientRect().height;
      const vh = doc.defaultView?.innerHeight ?? 0;
      if (vh && top + h > vh && r.top - h >= 0) top = r.top - h;
    } catch {
      // no layout here
    }
    box.setAttribute("style", base + `left:${r.left}px;top:${top}px;`);
  }

  /** REQ-547 — the still rule into the frame (again: a snapshot replaced the page, an op its head) */
  function putStill() {
    const W = doc.defaultView as
      | (Window & { CSSStyleSheet?: typeof CSSStyleSheet })
      | null;
    const adopted = (doc as Document & { adoptedStyleSheets?: CSSStyleSheet[] })
      .adoptedStyleSheets;
    if (W?.CSSStyleSheet && Array.isArray(adopted)) {
      try {
        if (!stillSheet) {
          stillSheet = new W.CSSStyleSheet();
          stillSheet.replaceSync(STILL_CSS);
        }
        if (!adopted.includes(stillSheet)) {
          doc.adoptedStyleSheets = [...adopted, stillSheet];
        }
        return;
      } catch {
        stillSheet = null; // no constructed sheets here: a <style> instead
      }
    }
    if (!stillEl) {
      stillEl = doc.createElement("style");
      stillEl.setAttribute("data-mirror-still", "");
      stillEl.appendChild(doc.createTextNode(STILL_CSS));
    }
    const at = doc.head ?? doc.documentElement;
    if (at && stillEl.parentNode !== at) at.appendChild(stillEl);
  }
  function holdStill(on: boolean) {
    if (on) {
      stillOn = true;
      putStill();
      return;
    }
    if (!stillOn) return;
    stillOn = false;
    // the sheets' styles are computed with the rule on first, and only then is it let go: both in
    // one style pass, and the browser would run the transitions from the unstyled look anyway
    try {
      doc.documentElement?.getBoundingClientRect();
    } catch {
      // no layout here
    }
    if (stillSheet) {
      try {
        doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((x) =>
          x !== stillSheet
        );
      } catch {
        // gone with its document
      }
    }
    stillEl?.parentNode?.removeChild(stillEl);
  }
  /** REQ-547 — let the still rule go once the page in the frame has settled and every stylesheet
   *  it links is in (a sheet that never answers keeps it: no page transition is worth a ghost) */
  function review() {
    if (pending) return;
    // its own links are in: the copies go (the same rules, under the still rule: nothing moves)
    if (bridge.length && styled()) dropBridge();
    if (stillOn && settledNow() && styled()) holdStill(false);
  }

  /** REQ-547 — the rules of a stylesheet that just loaded, kept (a cross-origin one has none to
   *  read: it is only known to be in the cache) */
  function keepCopy(l: Element, href: string) {
    if (copies.has(href)) return;
    try {
      const rules = (l as HTMLLinkElement).sheet?.cssRules;
      if (!rules) return;
      let text = "";
      for (let k = 0; k < rules.length; k++) text += rules[k].cssText + "\n";
      copies.set(href, text);
    } catch {
      // another origin's sheet
    }
  }

  /** REQ-547 — a page just put in the frame is styled at once by copies of the sheets it links
   *  that this frame has already loaded, until its own links are in */
  function putBridge() {
    dropBridge();
    const W = doc.defaultView as
      | (Window & { CSSStyleSheet?: typeof CSSStyleSheet })
      | null;
    const adopted = (doc as Document & { adoptedStyleSheets?: CSSStyleSheet[] })
      .adoptedStyleSheets;
    if (!W?.CSSStyleSheet || !Array.isArray(adopted)) return;
    const made: CSSStyleSheet[] = [];
    for (const l of sheets) {
      if (!awaited(l) || !doc.contains(l)) continue;
      const href = (l.getAttribute("href") ?? "").trim();
      const text = copies.get(href);
      if (text === undefined) continue;
      try {
        const c = new W.CSSStyleSheet({ baseURL: href } as CSSStyleSheetInit);
        c.replaceSync(text);
        made.push(c);
      } catch {
        // a copy this browser will not take: that link is waited for as it is
      }
    }
    if (!made.length) return;
    bridge = made;
    // under the still rule (it stays last), in the order the page links them
    const rest = adopted.filter((x) => x !== stillSheet);
    doc.adoptedStyleSheets = [
      ...rest,
      ...made,
      ...(stillSheet && adopted.includes(stillSheet) ? [stillSheet] : []),
    ];
  }
  function dropBridge() {
    if (!bridge.length) return;
    const gone = new Set(bridge);
    bridge = [];
    try {
      doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((x) =>
        !gone.has(x)
      );
    } catch {
      // gone with its document
    }
  }

  const reg = (i: number, n: Node) => {
    byId.set(i, n);
    idOf.set(n, i);
  };

  /** every node's latest scroll, applied again where the replay lost it */
  function settle() {
    for (const [i, s] of scrolls) {
      const e = scroller(i);
      if (!e) continue;
      try {
        if (e.scrollLeft !== s.x || e.scrollTop !== s.y) scrollNow(e, s.x, s.y);
      } catch {
        // gone mid-way
      }
    }
  }

  /** REQ-305 — a pass on the next frame: the scrolls settled (when asked), then the stage told;
   *  several asks before it runs are one pass */
  const pass = (withSettle: boolean) => {
    if (disposed) return;
    if (due) {
      due.settle ||= withSettle;
      return;
    }
    due = { settle: withSettle };
    schedule(() => {
      const d = due;
      due = null;
      if (disposed || !d) return;
      if (d.settle) settle();
      review(); // REQ-547
      drawLists(); // REQ-638 — placed again: the layout moved
      opts.onLayout?.();
    });
  };
  const settleSoon = () => pass(true);
  /** the frame scrolled (an op, a settle, the browser keeping its place as content above grew):
   *  the stage is told — no settle, which would fight a scroll it made itself */
  const onScroll = () => pass(false);
  doc.addEventListener("scroll", onScroll, true);
  /** a stylesheet or an image of the frame is in (or failed): the layout moved */
  const onLoad = (e: Event) => {
    const t = e.target as Element | null;
    if (t) loaded.add(t);
    // REQ-547 — a stylesheet this frame has: a later snapshot that links it is not held for it
    if (t?.nodeType === 1 && t.localName?.toLowerCase() === "link") {
      const href = (t.getAttribute("href") ?? "").trim();
      if (href) {
        readyHrefs.add(href);
        keepCopy(t, href);
      }
    }
    // REQ-547 — a held snapshot's last preload is in: it replaces the page on show
    if (pending?.preloads.has(t as Element)) {
      pending.preloads.delete(t as Element);
      if (pending.preloads.size === 0) swapIn();
    }
    settleSoon();
  };
  doc.addEventListener("load", onLoad, true);
  doc.addEventListener("error", onLoad, true);
  /** its web fonts are in: the text, and what follows it, moved */
  const fonts = (doc as Document & { fonts?: EventTarget }).fonts;
  try {
    fonts?.addEventListener?.("loadingdone", settleSoon);
  } catch {
    // no font set here
  }
  const RO = opts.Resize === undefined
    ? (doc.defaultView?.ResizeObserver ??
      (typeof ResizeObserver === "function" ? ResizeObserver : null))
    : opts.Resize;
  let ro: ResizeObserver | null = null;
  /** the page's html and body: the frame grows as its styles and images come in */
  function watchSize() {
    ro?.disconnect();
    ro = null;
    if (!RO) return;
    try {
      ro = new RO(() => settleSoon());
      const html = doc.documentElement;
      if (html) ro.observe(html);
      const body = doc.body;
      if (body) ro.observe(body);
    } catch {
      ro = null;
    }
  }

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
    if (lt === "link" && /(^|\s)stylesheet(\s|$)/i.test(s.a?.rel ?? "")) {
      sheets.add(e); // REQ-305 — styled() waits for it
      if (awaited(e)) newSheet = true; // REQ-547 — held still until it is in
    }
    if (lt === "img" && fetched(e)) images.add(e); // REQ-451 — settled() waits for it
    if (s.a && OPEN_ATTR in s.a) opened.add(e); // REQ-638 — its list is drawn
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
        if (op.n === OPEN_ATTR && op.v !== null) opened.add(e); // REQ-638
        // REQ-380 — a width or height set (or removed) cleared the canvas: its picture again
        const u = bitmaps.get(op.i);
        if (
          u && e.localName.toLowerCase() === "canvas" &&
          /^(width|height)$/i.test(op.n)
        ) {
          paint(e as HTMLCanvasElement, u);
          counts.repaints++;
        }
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
        scrollNow(e, op.x, op.y); // REQ-305 — at once, never animated
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
          bitmaps.delete(id);
        }
        return fit;
      }
      case "cv": {
        counts.seen++;
        const e = el(op.i);
        if (!e) return false;
        bitmaps.set(op.i, op.u);
        paint(e as HTMLCanvasElement, op.u);
        counts.cv++;
        return true;
      }
    }
  }

  /** REQ-305 — every stylesheet the replay links has loaded (or failed) */
  function styled(): boolean {
    if (pending) return false; // REQ-547 — its page is not in the frame yet
    for (const l of sheets) {
      if (!doc.contains(l)) {
        sheets.delete(l);
        continue;
      }
      if (loaded.has(l) || (l as HTMLLinkElement).sheet || !awaited(l)) {
        continue;
      }
      return false;
    }
    return true;
  }

  /** REQ-547 — the snapshot's page is in the frame: watched, its fonts and images waited for
   *  (REQ-451, SETTLE_CAP_MS at most: then the stage is told — a layout pass — settled or not),
   *  and held still until it has settled */
  function shown() {
    watchSize();
    snapAt = now();
    isSettled = false;
    cancelCap?.();
    cancelCap = later(() => {
      cancelCap = null;
      settleSoon();
    }, SETTLE_CAP_MS);
    holdStill(true);
    putBridge();
  }

  /** REQ-547 — the stylesheet hrefs the new page links that this frame neither has loaded (or
   *  failed) nor is loading for the page on show (that page is no better styled than the new one
   *  would be: nothing is gained by keeping it) */
  function unloaded(prev: Set<Element>): string[] {
    const have = new Set([...readyHrefs, ...copies.keys()]);
    for (const l of prev) {
      const href = (l.getAttribute("href") ?? "").trim();
      if (href && doc.contains(l)) have.add(href);
    }
    const out: string[] = [];
    for (const l of sheets) {
      if (!awaited(l)) continue;
      const href = (l.getAttribute("href") ?? "").trim();
      if (!have.has(href) && !out.includes(href)) out.push(href);
    }
    return out;
  }

  /** REQ-547 — the new page is kept out of the frame while its sheets load into the page on show
   *  (`media="not all"`: fetched, never applied to it); HOLD_CAP_MS at most */
  function hold(root: Node, hrefs: string[]) {
    const at = doc.head ?? doc.documentElement;
    const preloads = new Set<Element>();
    for (const href of hrefs) {
      const l = doc.createElement("link");
      l.setAttribute("rel", "stylesheet");
      l.setAttribute("media", "not all");
      l.setAttribute("data-mirror-preload", "");
      l.setAttribute("href", href);
      preloads.add(l);
      at?.appendChild(l);
    }
    const cancel = later(() => swapIn(), HOLD_CAP_MS);
    pending = { root, preloads, cancel };
  }

  /** REQ-547 — the held page replaces the one on show */
  function swapIn() {
    const p = pending;
    if (!p || disposed) return;
    dropPending();
    const old = doc.documentElement;
    if (old) doc.replaceChild(p.root, old);
    else doc.appendChild(p.root);
    shown();
    drawLists(); // REQ-638
    settleSoon();
  }

  /** REQ-547 — a held page given up (a newer snapshot came, or the replay is done): its preloads
   *  out of the page on show */
  function dropPending() {
    const p = pending;
    if (!p) return;
    pending = null;
    p.cancel();
    for (const l of p.preloads) l.parentNode?.removeChild(l);
  }

  /** REQ-451 — see Replayer.settled */
  function settledNow(): boolean {
    if (isSettled) return true;
    if (pending || !view || !styled()) return false; // REQ-547 — nor while held
    // a web font starts loading when a layout first needs it: lay the frame out, then ask
    try {
      doc.documentElement?.getBoundingClientRect();
    } catch {
      // no layout here
    }
    const fonts = (doc as Document & { fonts?: { status?: string } }).fonts;
    let busy = fonts?.status === "loading";
    // a stylesheet's load (or error) event, never its `sheet` alone (what styled() counts, for
    // the reveal): measured, both links had their sheets from the memory cache and the frame was
    // still laid out without them (the wizard stacked at full width)
    for (const l of sheets) {
      if (busy) break;
      if (doc.contains(l) && awaited(l) && !loaded.has(l)) busy = true;
    }
    for (const i of images) {
      if (busy) break;
      if (!doc.contains(i)) {
        images.delete(i);
        continue;
      }
      // its load (or error) event, never `complete` alone: measured, an image already
      // `complete` had not given the frame its height yet (the logo: everything under it sat
      // higher, the Continue button under the middle of the phone)
      if (loaded.has(i)) continue;
      busy = true;
    }
    if (busy && now() - snapAt < SETTLE_CAP_MS) return false;
    isSettled = true;
    cancelCap?.();
    cancelCap = null;
    return true;
  }

  return {
    apply(f) {
      if (f.t === "snap") {
        try {
          // REQ-547 — a page is on show (an earlier snapshot): it stays while this one's sheets load
          const had = ok && !!doc.documentElement;
          const prev = sheets;
          dropPending();
          byId = new Map();
          idOf = new WeakMap();
          scrolls.clear();
          bitmaps.clear();
          sheets = new Set();
          images = new Set();
          opened = new Set();
          const root = build(f.root);
          newSheet = false;
          view = { w: f.w, h: f.h };
          at = f.u;
          ok = true;
          isSettled = false;
          const missing = had ? unloaded(prev) : [];
          if (missing.length) hold(root, missing);
          else {
            const old = doc.documentElement;
            if (old) doc.replaceChild(root, old);
            else doc.appendChild(root);
            shown();
          }
        } catch {
          ok = false;
          dropPending();
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
      // REQ-547 — an op added a stylesheet: held still until it is in; and the still rule back in
      // the frame should an op have taken the <head> it was in
      if (newSheet && !pending) holdStill(true);
      else if (stillOn) putStill();
      newSheet = false;
      drawLists(); // REQ-638
      // REQ-305 — the layout changes once the browser has laid the frame out, not now
      settleSoon();
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
    rectOf(a) {
      const n = byId.get(a.id);
      if (!n || n.nodeType !== 1 || !doc.contains(n)) return null;
      const r = (n as Element).getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return null;
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    },
    settle,
    styled,
    settled: settledNow,
    stats: () => ({ ...counts }),
    still: () => stillOn,
    dispose() {
      disposed = true;
      dropPending();
      cancelCap?.();
      cancelCap = null;
      doc.removeEventListener("load", onLoad, true);
      doc.removeEventListener("error", onLoad, true);
      doc.removeEventListener("scroll", onScroll, true);
      try {
        fonts?.removeEventListener?.("loadingdone", settleSoon);
      } catch {
        // no font set here
      }
      ro?.disconnect();
      ro = null;
    },
  };
}
