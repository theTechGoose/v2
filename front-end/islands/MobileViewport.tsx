import { useEffect } from "preact/hooks";

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
    const apply = () => {
      root.style.setProperty("--app-vh", `${vv.height}px`);
      // Keyboard height = layout viewport − (space above keyboard + any
      // offset the page was pushed up). Clamp at 0 so a closed keyboard /
      // desktop yields no inset. innerHeight stays at the layout height on
      // iOS when the keyboard is open, so the difference is the keyboard.
      const inset = Math.max(
        0,
        globalThis.innerHeight - vv.height - vv.offsetTop,
      );
      root.style.setProperty("--kb-inset", `${inset}px`);
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      root.style.removeProperty("--app-vh");
      root.style.removeProperty("--kb-inset");
    };
  }, []);
  return null;
}
