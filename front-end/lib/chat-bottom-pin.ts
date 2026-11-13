/**
 * The assistant chat's pin-to-bottom (AsstChat.tsx). The chat sticks to its
 * newest message whenever the content grows AND the person was already near the
 * bottom (within STICK_THRESHOLD px) — a Review preview opening inline, the
 * customer picker expanding, a wizard row appending all grow the scroll height
 * without adding a message. Someone scrolled up reading history is never
 * yanked down.
 *
 * REQ-425 p13-b: the welcome state is never pinned — it stays where it opened
 * (its top) or wherever the person scrolled it. Leaving it for a step panel
 * pins once, so the panel's controls come into view.
 *
 * REQ-469 (demo m39, cycle 3): the scroller's OWN size is watched too. A demo
 * starting reserves the pill's band (REQ-379, --demo-pill-h), the shell gets
 * shorter and so does the scroller, with the content unchanged — the browser
 * keeps scrollTop and fires no scroll, so the last card's Lock it in / Edit
 * ended up under the composer. A scroller that shrinks while the person was at
 * the bottom is re-pinned to the bottom.
 */

/** the chat sticks to its bottom when it is at most this far from it */
export const STICK_THRESHOLD = 120;

interface ResizeObserverLike {
  observe(target: Element): void;
  disconnect(): void;
}

export interface BottomPinDeps {
  /** true while the chat shows its welcome (empty) state */
  isWelcome: () => boolean;
  /** injectable for tests; defaults to the browser's */
  ResizeObserver?: new (cb: () => void) => ResizeObserverLike;
  requestAnimationFrame?: (cb: () => void) => unknown;
}

/** Wire the pin onto `scroller` (its first child is the content). Returns the teardown. */
export function attachBottomPin(
  scroller: HTMLElement,
  deps: BottomPinDeps,
): () => void {
  const inner = scroller.firstElementChild as HTMLElement | null;
  if (!inner) return () => {};
  const RO = deps.ResizeObserver ?? globalThis.ResizeObserver;
  const raf = deps.requestAnimationFrame ??
    ((cb: () => void) => globalThis.requestAnimationFrame(cb));
  let nearBottom = true;
  function updateNearBottom() {
    const distFromBottom = scroller.scrollHeight - scroller.scrollTop -
      scroller.clientHeight;
    nearBottom = distFromBottom <= STICK_THRESHOLD;
  }
  function pin() {
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
  }
  updateNearBottom();
  scroller.addEventListener("scroll", updateNearBottom, { passive: true });
  let wasWelcome = deps.isWelcome();
  const ro = new RO(() => {
    if (deps.isWelcome()) {
      wasWelcome = true;
      return;
    }
    if (nearBottom || wasWelcome) raf(pin);
    wasWelcome = false;
  });
  ro.observe(inner);
  // REQ-469: the viewport of the chat shrinking (a demo's band, the impersonation
  // banner, a soft keyboard) is not a content change — re-pin if the person was
  // at the bottom. `nearBottom` still holds its pre-shrink value: a shrink moves
  // no scrollTop, so no scroll event has recomputed it.
  let lastHeight = scroller.clientHeight;
  const shrink = new RO(() => {
    const h = scroller.clientHeight;
    const shrank = h < lastHeight;
    lastHeight = h;
    if (shrank && nearBottom && !deps.isWelcome()) raf(pin);
  });
  shrink.observe(scroller);
  // First paint — drop straight to bottom (no smooth on initial load); the
  // welcome state opens at its top, so the mascot is in view.
  scroller.scrollTop = deps.isWelcome() ? 0 : scroller.scrollHeight;
  return () => {
    ro.disconnect();
    shrink.disconnect();
    scroller.removeEventListener("scroll", updateNearBottom);
  };
}
