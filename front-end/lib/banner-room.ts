/**
 * REQ-181 — the room a fixed top banner (the impersonation banner) takes from the page.
 *
 * The app shells are sized to the viewport and do not scroll (`.app` is `100dvh` with
 * `overflow: hidden`), so a banner laid over them hid the sidebar's brand, the top bar and
 * the first card with no way to reach them. The banner publishes its height as `--banner-h`
 * on <html> and pads the body by it; the shells' CSS subtracts the same variable so their
 * bottom still ends at the window.
 */
export const BANNER_VAR = "--banner-h";

/** the slice of CSSStyleDeclaration this needs — fakeable in a unit test */
export interface StyleLike {
  setProperty(name: string, value: string): void;
  removeProperty(name: string): void;
}

/** publish `height` (css px, rounded) — or release the room when there is none */
export function setBannerRoom(
  root: StyleLike,
  body: StyleLike,
  height: number,
): void {
  const h = Math.round(height);
  if (!(h > 0)) {
    clearBannerRoom(root, body);
    return;
  }
  root.setProperty(BANNER_VAR, `${h}px`);
  body.setProperty("padding-top", `var(${BANNER_VAR}, 0px)`);
}

/** the banner is gone: the page starts at the window's top again */
export function clearBannerRoom(root: StyleLike, body: StyleLike): void {
  root.removeProperty(BANNER_VAR);
  body.removeProperty("padding-top");
}
