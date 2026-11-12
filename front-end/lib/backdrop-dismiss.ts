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
