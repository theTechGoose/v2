/**
 * REQ-724 (demo-loop cycle 5, issue M27) — the room the phone's Conversations dock takes from
 * the ☰ drawer.
 *
 * On /assistant at ≤880 px the conversation list (AsstThreads) docks into the bottom of the
 * drawer's 260 px column while the drawer is open (P-22b). The dock is its own island, fixed
 * over the drawer, so on its own it painted over the drawer's foot — Settings, "Worker view"
 * and "Log out". The dock publishes its measured height as `--threads-dock-h` on `.sb` and
 * flags it `sb--threads-docked`; the stylesheet pads the drawer's bottom by that height (and
 * lets its inside scroll), so the drawer's content ends where the dock begins.
 */
export const DOCK_VAR = "--threads-dock-h";
export const DOCK_CLASS = "sb--threads-docked";

/** the slice of an HTMLElement this needs — fakeable in a unit test */
export interface DrawerLike {
  style: {
    setProperty(name: string, value: string): void;
    removeProperty(name: string): void;
  };
  classList: { toggle(name: string, force?: boolean): boolean };
}

/** reserve `height` (css px, rounded up) at the drawer's bottom — or release it when 0 */
export function setDockRoom(sb: DrawerLike, height: number): void {
  const h = Math.ceil(height);
  if (!(h > 0)) {
    clearDockRoom(sb);
    return;
  }
  sb.style.setProperty(DOCK_VAR, `${h}px`);
  sb.classList.toggle(DOCK_CLASS, true);
}

/** the dock is gone: the drawer uses its whole height again */
export function clearDockRoom(sb: DrawerLike): void {
  sb.style.removeProperty(DOCK_VAR);
  sb.classList.toggle(DOCK_CLASS, false);
}
