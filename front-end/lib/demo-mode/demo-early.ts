/**
 * REQ-648 (demo-loop cycle 5, M3 + c4-m28) — the customer's early demo script. `_app.tsx` puts it
 * in the head of every signed-in page as a module script of its own (async: it runs as soon as it
 * is in, never waiting for the page's islands). When this browser tab was in a demo a moment ago it
 * opens that demo's link at once (early-link.ts); the overlay island takes it over as it hydrates.
 */
import { type EarlyHost, startEarlyLink } from "./early-link.ts";
import { sessionStore } from "./cursor-handoff.ts";

try {
  startEarlyLink({
    host: globalThis as unknown as EarlyHost,
    doc: document,
    store: sessionStore(),
  });
} catch {
  // the overlay opens the page's link itself, as before
}
