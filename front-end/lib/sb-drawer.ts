/**
 * REQ-358 — where the sidebar rests for a page: inside the active entry's folder (REQ-156),
 * Admin for the super-admin tab (which is not a NAV entry), the root otherwise. The sidebar
 * starts there, and the phone drawer goes back there every time it closes, so it never
 * re-opens on whatever folder was browsed last (demo issue m45).
 */
import { folderPathTo } from "./nav-folders.ts";
import { NAV } from "./nav-tree.ts";

export function restingPath(active: string | undefined): string[] {
  return active === "admin" ? ["manage"] : folderPathTo(NAV, active);
}

/** REQ-358 — the drawer's ✕ is phone-only and 44 px; these ride with the island so every
 *  page that mounts the sidebar (dashboard.css, assistant-page.css, …) gets them. */
export const SB_DRAWER_CSS = `.sb__close { display: none; }
@media (max-width: 640px) {
  .sb__head { display: flex; align-items: center; }
  .sb__close { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 44px; height: 44px; margin-left: auto; padding: 0; border: 0; border-radius: 10px; background: transparent; color: inherit; cursor: pointer; }
  .sb__close:hover { background: rgba(20, 72, 82, 0.08); }
  .sb__close:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
}`;
