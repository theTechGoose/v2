/**
 * REQ-892 (demo-loop run 6, dm6, issue m3) — the session-less page's rejoin script. `_app.tsx` puts
 * it in the head of every page rendered WITHOUT a session as a module script of its own (the page
 * may have no island at all — the landing). When a sign-out dropped this browser tab's demo
 * (rejoin-mark.ts) it watches for the customer signing in again in another tab and brings this
 * one back into the demo; otherwise it does nothing.
 */
import { signedInNow } from "../login-rejoin.ts";
import { sessionStore } from "./cursor-handoff.ts";
import { startDemoRejoin } from "./rejoin-mark.ts";

try {
  startDemoRejoin({
    store: sessionStore(),
    loc: globalThis.location,
    win: globalThis,
    doc: document,
    signedIn: () => signedInNow(),
    go: (to) => globalThis.location.replace(to),
    reload: () => globalThis.location.reload(),
  });
} catch {
  // a page that cannot watch stays as it is (she can reload it herself)
}
