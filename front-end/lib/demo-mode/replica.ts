/**
 * REQ-187 — the replica: the glue between the customer's app (which REPORTS its view), the stage
 * (which APPLIES it to the frame) and the app inside the frame (which TAKES page-local state —
 * sidebar flags, map centre/zoom — from the stage instead of its own storage or fit).
 *
 *   customer's page islands ──reportView()──▶ document event ──▶ overlay ──link──▶ stage
 *   stage ──pushViewTo(frame)──▶ postMessage ──▶ onReplicaView() in the frame's islands
 *
 * The frame is told apart by its window name (`pm-demo-replica`), which survives every
 * navigation inside it; an app there never polls `active`, never joins the link, shows no banner.
 */
import {
  type ElLike,
  parseSelector,
  type ScrollPos,
  selectorFor,
  type View,
  type ViewPatch,
  walkSelector,
} from "../../../shared/demo-mode/protocol.ts";

export const REPLICA_FRAME_NAME = "pm-demo-replica";
const VIEW_EVENT = "pm:demo-view";
const VIEW_REQUEST_EVENT = "pm:demo-view-request";
const VIEW_MESSAGE = "pm:demo-view";

/** this window is the stage's frame */
export function isReplicaFrame(): boolean {
  try {
    const w = globalThis as unknown as { name?: unknown; parent?: unknown };
    return w.name === REPLICA_FRAME_NAME && w.parent !== globalThis;
  } catch {
    return false;
  }
}

/** a page island on the CUSTOMER's side says part of its view changed (the overlay forwards it) */
export function reportView(patch: ViewPatch): void {
  if (isReplicaFrame()) return;
  document.dispatchEvent(new CustomEvent(VIEW_EVENT, { detail: patch }));
}

/** the overlay listens for the page islands' reports */
export function onReportedView(cb: (patch: ViewPatch) => void): () => void {
  const h = (e: Event) => {
    const d = (e as CustomEvent).detail;
    if (d && typeof d === "object") cb(d as ViewPatch);
  };
  document.addEventListener(VIEW_EVENT, h);
  return () => document.removeEventListener(VIEW_EVENT, h);
}

/** the overlay asks every page island to report its state now (on join) */
export function requestViews(): void {
  document.dispatchEvent(new Event(VIEW_REQUEST_EVENT));
}

export function onViewRequest(cb: () => void): () => void {
  document.addEventListener(VIEW_REQUEST_EVENT, cb);
  return () => document.removeEventListener(VIEW_REQUEST_EVENT, cb);
}

/** the stage hands the view into the frame (same origin, so the origin is pinned) */
export function pushViewTo(frame: HTMLIFrameElement, v: View): void {
  frame.contentWindow?.postMessage(
    { t: VIEW_MESSAGE, v },
    globalThis.location.origin,
  );
}

/** an island INSIDE the frame takes the view the stage hands in; parent and origin are checked */
export function onReplicaView(cb: (v: View) => void): () => void {
  const h = (e: MessageEvent) => {
    if (e.source !== globalThis.parent) return;
    if (e.origin !== globalThis.location.origin) return;
    const d = e.data;
    if (d && typeof d === "object" && d.t === VIEW_MESSAGE && d.v) {
      cb(d.v as View);
    }
  };
  globalThis.addEventListener("message", h);
  return () => globalThis.removeEventListener("message", h);
}

/** the element a selector names in a document: the path walked with the protocol's own counting
 *  (overlay and skip-marked siblings never count), querySelector only for a selector that is not
 *  ours; null when it leads nowhere */
export function findBySelector(doc: Document, sel: string): Element | null {
  const parsed = parseSelector(sel);
  if (parsed) {
    const root = parsed.root === "body"
      ? doc.body
      : parsed.root === "html"
      ? doc.documentElement
      : doc.querySelector(parsed.root);
    if (!root) return null;
    const el = walkSelector(root as unknown as ElLike, parsed.segs);
    return (el as unknown as Element | null) ?? null;
  }
  try {
    return doc.querySelector(sel);
  } catch {
    return null;
  }
}

/** the scroll position of a scroll event's target, as the wire names it */
export function scrollPosOf(target: EventTarget | null): ScrollPos | null {
  if (!target) return null;
  if (target === document || target === globalThis) {
    return { sel: null, x: globalThis.scrollX, y: globalThis.scrollY };
  }
  const el = target as Element;
  if (typeof el.getAttribute !== "function") return null;
  return {
    sel: selectorFor(el as unknown as ElLike),
    x: el.scrollLeft,
    y: el.scrollTop,
  };
}

/** every scrolled element of a document (the window first), for the whole view on join */
export function collectScroll(doc: Document): ScrollPos[] {
  const out: ScrollPos[] = [{
    sel: null,
    x: globalThis.scrollX,
    y: globalThis.scrollY,
  }];
  doc.querySelectorAll("*").forEach((el) => {
    if (el.scrollTop > 0 || el.scrollLeft > 0) {
      if (el.closest("[data-demo-overlay],[data-demo-skip]")) return;
      out.push({
        sel: selectorFor(el as unknown as ElLike),
        x: el.scrollLeft,
        y: el.scrollTop,
      });
    }
  });
  return out;
}

/** the stage scrolls the frame's window and elements to the customer's positions */
export function applyScroll(win: Window, scroll: ScrollPos[]): void {
  for (const s of scroll) {
    if (s.sel === null) {
      win.scrollTo(s.x, s.y);
      continue;
    }
    const el = findBySelector(win.document, s.sel);
    if (!el) continue;
    if (el.scrollLeft !== s.x) el.scrollLeft = s.x;
    if (el.scrollTop !== s.y) el.scrollTop = s.y;
  }
}
