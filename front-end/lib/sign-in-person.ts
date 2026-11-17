/**
 * REQ-405 (demo-loop cycle 2, m14): "Sign in person" turns the owner's
 * preview into the pad IN PLACE. The override query is laid onto the
 * location's CURRENT query at click time (so a ?lang= picked after the page
 * loaded stays) and written with history.replaceState — no navigation, so no
 * reload and no jump to the top. Returns the new query for the view's state.
 */
import { signOverrideSearch } from "../../shared/quote-flow/public-doc-state.ts";

interface WinLike {
  location: { href: string; search: string };
  history?: {
    replaceState: (data: unknown, unused: string, url: string) => void;
  };
}

export function enterSignInPerson(
  win: WinLike = globalThis as unknown as WinLike,
): string {
  const search = signOverrideSearch(win.location.search);
  try {
    const url = new URL(win.location.href);
    url.search = search;
    win.history?.replaceState(null, "", url.href);
  } catch {
    /* the pad still shows; the URL just doesn't carry the override */
  }
  return search;
}
