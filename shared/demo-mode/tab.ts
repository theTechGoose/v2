/**
 * REQ-217 — which tab speaks for the customer in a demo.
 *
 * A customer may have the app open in several tabs on one cookie. The server keeps one "where"
 * per user and the stage shows one frame, so exactly one tab may ask, join and report: the one
 * the customer is looking at.
 *
 * REQ-793 (AMENDS REQ-217) — the worker view takes part like any page of the app: when the
 * customer switches to /worker (from the office sidebar, on their own session) the stage follows
 * them there. REQ-217 kept /worker out because a hidden /worker tab used to hijack the frame; the
 * visibility rule alone covers that now. A worker's own phone (cell + PIN, no owner session) never
 * mounts the overlay, so it is still never a viewer.
 */

/** whether a page may take part in a demo at all (REQ-793: every page of the app) */
export function demoEligible(_pathname: string): boolean {
  return true;
}

/** whether a tab with this `document.visibilityState` is the one the customer is looking at */
export function viewerTab(visibility: string | undefined): boolean {
  return visibility === "visible";
}
