/**
 * REQ-894 (demo-loop run 6, dm6, issue p11) — /admin's search query, kept in the tab's
 * sessionStorage: a demo's end hops the stage to /admin (a fresh page), and the box came back
 * empty — the staff had to type the customer's phone again to find the row they had just demoed.
 * AdminPage writes the query as the staff types and seeds its box and its first search from it.
 */
export const ADMIN_QUERY_KEY = "pm:admin-q";
/** a pasted essay is cut: the box is a name, business or phone */
export const ADMIN_QUERY_MAX = 200;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readAdminQuery(store: Store | null | undefined): string {
  try {
    return (store?.getItem(ADMIN_QUERY_KEY) ?? "").slice(0, ADMIN_QUERY_MAX);
  } catch {
    return "";
  }
}

export function keepAdminQuery(
  store: Store | null | undefined,
  q: string,
): void {
  try {
    if (q === "") store?.removeItem(ADMIN_QUERY_KEY);
    else store?.setItem(ADMIN_QUERY_KEY, q.slice(0, ADMIN_QUERY_MAX));
  } catch { /* refused or full: the next /admin starts empty, as before */ }
}

/** the tab's storage, when the runtime has one */
export function adminQueryStore(): Store | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}
