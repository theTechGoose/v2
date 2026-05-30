import { useEffect } from "preact/hooks";

/**
 * Mirrors the visual viewport height into `--app-vh` so the assistant shell
 * can pin the composer directly above the on-screen keyboard.
 *
 * iOS Safari overlays the keyboard *without* shrinking `100dvh`, so a
 * `height:100dvh` chat shell stayed full-screen and the composer floated
 * mid-screen with a dead gap below it (Hans's "new issue"). `visualViewport`
 * reports the height *above* the keyboard, so writing it to a CSS var and
 * sizing the shell to it keeps the composer glued to the keyboard.
 *
 * Renders nothing — it only manages the CSS custom property. Harmless on
 * desktop (the value just equals the window height).
 */
export default function MobileViewport() {
  useEffect(() => {
    const vv = globalThis.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const apply = () => {
      root.style.setProperty("--app-vh", `${vv.height}px`);
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      root.style.removeProperty("--app-vh");
    };
  }, []);
  return null;
}
