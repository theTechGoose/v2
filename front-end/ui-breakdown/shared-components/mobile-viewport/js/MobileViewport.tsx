import { useEffect } from "preact/hooks";

/** Nearest scrollable ancestor (overflow-y auto/scroll with real overflow),
 *  e.g. the chat thread's `.chat__scroll`. Returns null for plain body-scroll
 *  pages so the caller falls back to scrolling the window. */
function scrollableAncestor(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const oy = getComputedStyle(node).overflowY;
    if (
      (oy === "auto" || oy === "scroll") &&
      node.scrollHeight > node.clientHeight + 1
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/**
 * Mirrors the visual viewport into two CSS custom properties so every page
 * can stay clear of the on-screen keyboard. Mounted once globally (routes/
 * _app.tsx). Renders nothing; harmless on desktop (keyboard inset is 0).
 *
 *   --app-vh   = visualViewport.height — the height ABOVE the keyboard.
 *   --kb-inset = keyboard overlap height (layout height − visual height).
 *
 * iOS Safari overlays the keyboard *without* shrinking `100dvh` or the
 * layout viewport, so two distinct problems arise:
 *
 *   1. Full-height shells (login card, chat shell) sized to `100dvh` stay
 *      full-screen, pushing inputs/buttons behind the keyboard. Sizing them
 *      to `--app-vh` keeps them in the space above it.
 *   2. Tall *scrollable* pages (the public agreement, quote, invoice) can
 *      only scroll until the bottom content reaches the bottom of the layout
 *      viewport — which the keyboard covers — so the last ~keyboard-height of
 *      content (e.g. the sign-your-name field + Sign button) can't be
 *      scrolled into view. Adding `--kb-inset` of bottom padding to the body
 *      (see _app.tsx) extends the scroll range by exactly the keyboard height
 *      so that content can clear it.
 */
export default function MobileViewport() {
  useEffect(() => {
    const vv = globalThis.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    // Set while a field is focused so viewport-resize events (keyboard settling)
    // re-run the reveal; cleared on blur / after the settle window.
    let activeCorrect: (() => void) | null = null;
    let focusUntil = 0;
    const apply = () => {
      // How much the keyboard overlaps the layout viewport.
      const overlap = globalThis.innerHeight - vv.height;
      // Visual-viewport overlay vars. Keyboard-sensitive shells (login/verify
      // card, chat) position themselves as `position:fixed; top:0; left:0;
      // right:0; height:var(--vvh); transform:translateY(var(--vvt))` so they
      // overlay EXACTLY the region the user can see above the keyboard.
      //
      // Measured on real iOS 18 WebKit: opening the keyboard leaves `100dvh`
      // unchanged AND scrolls the page down by `visualViewport.offsetTop`
      // (e.g. height 410, offsetTop 124). A normal-flow shell anchored at
      // layout y=0 therefore can't line up with the visible band no matter
      // what height we give it — a centered card ends up jammed high with a
      // dead gap below (the "weird gap"). Pinning a fixed overlay to
      // (offsetTop, offsetTop+height) lines it up exactly: centered cards
      // center in the visible band, bottom-anchored composers hug the keyboard.
      root.style.setProperty("--vvh", `${vv.height}px`);
      root.style.setProperty("--vvt", `${vv.offsetTop}px`);
      if (overlap > 2) {
        // Back-compat for any remaining `min-height:var(--app-vh)` consumers
        // (scrollable public doc pages): track the visual viewport height.
        root.style.setProperty("--app-vh", `${vv.height}px`);
      } else {
        // No keyboard, OR Android where interactive-widget=resizes-content has
        // already shrunk the layout viewport. Defer to native 100dvh (the CSS
        // fallback): it tracks the keyboard animation smoothly in lockstep,
        // whereas writing a JS pixel height only lands at the *end* of the
        // animation — which made the chat shell jump and briefly stranded the
        // composer behind the keyboard. Removing the override lets the shell
        // follow dvh frame-for-frame.
        root.style.removeProperty("--app-vh");
      }
      // Keyboard inset = bottom scroll-room added to body-scroll pages so the
      // last screenful of content (the focused field + its submit button) can be
      // scrolled clear of the keyboard. It must be the FULL keyboard overlap:
      // iOS often offsets the visual viewport (vv.offsetTop large) so the
      // previous `overlap - offsetTop` collapsed to a few px, starving the page
      // of the room needed to lift the trailing button. 0 on Android (layout
      // already resized) and on desktop.
      root.style.setProperty(
        "--kb-inset",
        `${Math.max(0, overlap)}px`,
      );
      // While a field is focused and the keyboard is still settling, re-run the
      // reveal on every viewport change. The keyboard animation can outlast any
      // fixed timeout (notably in the simulator), so a one-shot scroll measured
      // mid-animation under-scrolls; reacting to the resize that ACTUALLY lands
      // the smaller viewport is what makes the trailing submit reliably clear.
      if (activeCorrect && Date.now() < focusUntil) activeCorrect();
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);

    // Keep the focused field clear of the keyboard. iOS's native
    // scroll-into-view is unreliable inside our nested scroll containers (the
    // chat thread) and under the fixed/translated shells — it left wizard
    // inputs (e.g. the customer Phone Number field) and their action buttons
    // clipped behind the keyboard. After focus + the keyboard settling, we
    // explicitly center the field in its scroll container, which sits entirely
    // above the keyboard, so it (and the row/buttons around it) is always
    // visible. Covers every input on every page from one place.
    let focusTimer = 0;
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        !t ||
        typeof t.matches !== "function" ||
        !t.matches("input, textarea, select, [contenteditable='true']")
      ) {
        return;
      }
      globalThis.clearTimeout(focusTimer);
      try {
          // Reveal the field — and, if a submit/primary button trails it in the
          // same form (the contract "sign" button, the wizard "Next"), keep the
          // BUTTON clear of the keyboard too. Centering alone clamps at the page
          // bottom (the button is the last element) and iOS's layout viewport
          // doesn't fully exclude the keyboard, so scrollIntoView can't lift it.
          // Compute the exact overshoot past the visible band (visualViewport)
          // and scroll precisely that much.
          const group = t.closest("form, [data-kbd-group]");
          let target: Element = t;
          if (group) {
            // The primary action (sign / "I sent it" / Next) is the last button
            // that FOLLOWS the field in the group. Revealing it keeps the field
            // (just above it) visible too. Method-picker buttons precede the
            // field, so they're correctly ignored.
            const after = Array.from(group.querySelectorAll("button")).filter(
              (b) =>
                (t.compareDocumentPosition(b) &
                  Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
            );
            if (after.length) target = after[after.length - 1];
          }
          const sc = scrollableAncestor(target as HTMLElement);
          // Lift the target clear of the keyboard. Runs repeatedly while the
          // keyboard settles (see the resize-driven re-run in `apply()`), so each
          // pass just measures the current layout and nudges toward the goal.
          const correct = () => {
            const r = target.getBoundingClientRect();
            if (sc) {
              // Nested scroll container (the chat thread): coords are relative
              // to the container, so the overshoot nudge applies as-is.
              const overshoot = r.bottom - (vv.height - 16);
              if (overshoot > 1) sc.scrollBy({ top: overshoot, behavior: "auto" });
              else if (r.top < 8) sc.scrollBy({ top: r.top - 8, behavior: "auto" });
              return;
            }
            // Body-scroll page (public quote/contract/invoice). getBoundingClient-
            // Rect is relative to the LAYOUT viewport (top = 0), but the band the
            // user can actually see is [vv.offsetTop, vv.offsetTop + vv.height] —
            // iOS offsets (and sometimes shrinks) the visual viewport when the
            // keyboard opens. Convert into band coordinates by subtracting
            // vv.offsetTop; the old code omitted this and so mis-measured every
            // keyboard-open by exactly vv.offsetTop, leaving the field clipped
            // off the top and the submit button stranded.
            const topBand = vv.offsetTop;
            const fieldTop = t.getBoundingClientRect().top - topBand;
            const btnBot = r.bottom - topBand;
            let delta = 0;
            // 1) Lift the trailing submit if it sits below the visible band
            //    (behind the keyboard).
            if (btnBot > vv.height - 24) delta = btnBot - (vv.height - 24);
            // 2) But never at the cost of clipping the focused field off the top —
            //    if that scroll (or the current position) pushes the field above
            //    the band, pull back so the field stays in view. This also lowers
            //    content when iOS has over-scrolled the field above the fold.
            if (fieldTop - delta < 8) delta = fieldTop - 8;
            if (Math.abs(delta) > 1) {
              globalThis.scrollBy({ top: delta, behavior: "auto" });
            }
          };
          // Register so `apply()` re-runs the reveal on every viewport change
          // until the keyboard has settled, and add fixed fallbacks in case the
          // resize event doesn't fire (desktop, or engines that don't shrink the
          // visual viewport).
          activeCorrect = correct;
          // Long enough to catch the keyboard settling in stages — the predictive-
          // text bar appears a beat after the keyboard, shrinking the viewport a
          // second time; a short window would close before that lands.
          focusUntil = Date.now() + 2600;
          for (const ms of [60, 250, 500, 800, 1200, 1800, 2400]) {
            globalThis.setTimeout(() => {
              if (activeCorrect === correct) correct();
            }, ms);
          }
      } catch {
        /* older engines: best-effort, native behavior still applies */
      }
    };
    const onFocusOut = () => {
      // Stop re-correcting once the field is blurred (keyboard closing).
      activeCorrect = null;
      focusUntil = 0;
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    // Android (interactive-widget=resizes-content) resizes the *layout*
    // viewport when the keyboard opens, which fires window.resize but NOT
    // always visualViewport.resize — so without this --app-vh went stale and
    // the chat shell stayed full-height, dropping the composer behind the
    // keyboard with a dead gap. iOS only changes the visual viewport, caught
    // above. Listening to both covers every platform.
    globalThis.addEventListener("resize", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      globalThis.removeEventListener("resize", apply);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      globalThis.clearTimeout(focusTimer);
      root.style.removeProperty("--app-vh");
      root.style.removeProperty("--kb-inset");
      root.style.removeProperty("--vvh");
      root.style.removeProperty("--vvt");
    };
  }, []);
  return null;
}
