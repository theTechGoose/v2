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
      // How much the keyboard overlaps the layout viewport.
      const overlap = globalThis.innerHeight - vv.height;
      if (overlap > 2) {
        // iOS-style overlay: the keyboard covers content WITHOUT shrinking the
        // layout viewport / 100dvh, so we must pin the shell to the visual
        // viewport height ourselves.
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
      // Keyboard inset for bottom scroll-room on body-scroll pages: the
      // keyboard height, minus any offset the page was pushed up. 0 on Android
      // (layout already resized) and on desktop.
      root.style.setProperty(
        "--kb-inset",
        `${Math.max(0, overlap - vv.offsetTop)}px`,
      );
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
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
      root.style.removeProperty("--app-vh");
      root.style.removeProperty("--kb-inset");
    };
  }, []);
  return null;
}
