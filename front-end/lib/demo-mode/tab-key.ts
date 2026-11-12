/**
 * REQ-436 (demo-loop cycle 3, M2/M2b) — this browser tab's key for demo mode: the same on every
 * page the tab loads (sessionStorage lives as long as the tab and is the tab's own), another in
 * every other tab. The overlay sends it on its claims so a stage follows the browser tab, not the
 * socket of one of its pages. Storage that is missing or refused (a private window) still gives a
 * key — for this page only.
 */
import { TAB_KEY } from "../../../shared/demo-mode/protocol.ts";

/** where the key is kept in the tab's sessionStorage */
export const TAB_KEY_STORAGE = "pm:demo-tab";

type KeyStore = Pick<Storage, "getItem" | "setItem">;

const fresh = () => {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, "");
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
};

export function demoTabKey(store: KeyStore | null | undefined): string {
  try {
    const had = store?.getItem(TAB_KEY_STORAGE);
    if (had && had.length >= 8 && TAB_KEY.test(had)) return had;
  } catch { /* refused: a key for this page */ }
  const key = fresh().slice(0, 32);
  try {
    store?.setItem(TAB_KEY_STORAGE, key);
  } catch { /* refused */ }
  return key;
}
