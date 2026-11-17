/**
 * REQ-354 (demo issue M39): when may a click on a dialog's backdrop close it?
 *
 * A full-screen backdrop is painted over the button that opened its dialog,
 * so the second click of a double-click on that button lands on the
 * backdrop. "Close on any backdrop click" therefore opened and closed the
 * dialog in one gesture. A backdrop click closes only when:
 *  - it is a single click (`detail` ≤ 1 — 0 for a programmatic click),
 *  - the dialog has been open at least BACKDROP_OPEN_GRACE_MS,
 *  - the click's target is the backdrop itself (not bubbled from the card),
 *  - and the pointer went DOWN on the backdrop too (a press inside the card
 *    dragged out — e.g. selecting text in an input — is not a dismissal).
 *
 * Use it through `components/Backdrop.tsx`; lib/backdrop-overlays.test.ts
 * fails on any full-screen overlay with a raw onClick.
 */

export const BACKDROP_OPEN_GRACE_MS = 300;

interface TargetEvent {
  target: unknown;
  currentTarget: unknown;
}

export interface BackdropGuard {
  onPointerDown(e: TargetEvent): void;
  onClick(e: TargetEvent & { detail?: number }): void;
}

/** one guard per opening of the dialog: `now()` at creation is the open time */
export function createBackdropGuard(
  close: () => void,
  now: () => number = Date.now,
  graceMs: number = BACKDROP_OPEN_GRACE_MS,
): BackdropGuard {
  const openedAt = now();
  // null: no pointerdown seen since the last click (keyboard/programmatic)
  let downOnBackdrop: boolean | null = null;
  return {
    onPointerDown(e) {
      downOnBackdrop = e.target === e.currentTarget;
    },
    onClick(e) {
      const down = downOnBackdrop;
      downOnBackdrop = null;
      if (e.target !== e.currentTarget) return;
      if (down === false) return;
      if ((e.detail ?? 0) > 1) return;
      if (now() - openedAt < graceMs) return;
      close();
    },
  };
}

/**
 * REQ-432 (demo-loop cycle 3, issues m29 + m40): a document-level
 * "click outside closes it" listener must not treat the app's own chrome as
 * "outside". Tapping End demo on the demo pill, or EN/ES in the topbar,
 * collapsed an open customer card. The chrome: the topbar, the sidebar, the
 * demo overlay, and anything marked `data-keep-open`.
 */
export const CHROME_SELECTOR =
  "[data-demo-overlay], .topbar, .sidebar, [data-keep-open]";

/** is this click's target part of the app chrome (never an "outside" click)? */
export function isChromeClick(target: unknown): boolean {
  const el = target as { closest?: (sel: string) => unknown } | null;
  if (!el || typeof el.closest !== "function") return false;
  return el.closest(CHROME_SELECTOR) != null;
}

const fenced = new WeakSet<object>();

/**
 * REQ-432 — a callback ref for the demo overlay's root: its click,
 * pointerdown and mousedown stop at the root in the BUBBLE phase, so the
 * overlay's own buttons still get them, capture-phase document listeners
 * (presence, the End question's cancel) still hear them, and no bubbling
 * outside-click handler on the page underneath acts on them.
 */
export function fenceClicks(el: HTMLElement | null): void {
  if (!el || fenced.has(el)) return;
  fenced.add(el);
  const stop = (e: Event) => e.stopPropagation();
  for (const type of ["click", "pointerdown", "mousedown"]) {
    el.addEventListener(type, stop);
  }
}

/**
 * REQ-732 (demo-loop cycle 5, issue m26): every dialog on `<Backdrop>` closes
 * on Escape — before, Escape was per-dialog and opt-in, so New invoice and
 * Nueva suscripción ignored it. Open dialogs form a stack: one document
 * `keydown` listener (bubble phase, so a field's own handler runs first)
 * closes only the TOPMOST one. An Escape a nested list already handled
 * (`defaultPrevented`, or stopped before the document), one that ends an IME
 * composition, and any other key close nothing. A handled Escape is marked
 * `preventDefault()` so other document listeners can tell.
 */
export interface EscapeKeyEvent {
  key: string;
  defaultPrevented: boolean;
  isComposing?: boolean;
  preventDefault(): void;
}

interface KeyTarget {
  addEventListener(type: "keydown", f: (e: EscapeKeyEvent) => void): void;
  removeEventListener(type: "keydown", f: (e: EscapeKeyEvent) => void): void;
}

export interface EscapeLayers {
  /** a dialog opened: its close runs on Escape while it is on top; call the result when it closes */
  push(close: () => void): () => void;
}

export function createEscapeLayers(target: KeyTarget): EscapeLayers {
  const stack: { close: () => void }[] = [];
  const onKey = (e: EscapeKeyEvent) => {
    if (e.key !== "Escape" || e.defaultPrevented || e.isComposing) return;
    const top = stack[stack.length - 1];
    if (!top) return;
    e.preventDefault();
    top.close();
  };
  return {
    push(close) {
      const layer = { close };
      if (stack.length === 0) target.addEventListener("keydown", onKey);
      stack.push(layer);
      return () => {
        const i = stack.indexOf(layer);
        if (i < 0) return;
        stack.splice(i, 1);
        if (stack.length === 0) target.removeEventListener("keydown", onKey);
      };
    },
  };
}

let docLayers: { doc: unknown; layers: EscapeLayers } | null = null;

/** the page's one Escape stack, on the current `document` */
export function documentEscapeLayers(): EscapeLayers | null {
  const doc = (globalThis as { document?: KeyTarget }).document;
  if (!doc) return null;
  if (docLayers?.doc !== doc) {
    docLayers = { doc, layers: createEscapeLayers(doc) };
  }
  return docLayers.layers;
}
