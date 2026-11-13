/**
 * REQ-217 — which tab speaks for the customer in a demo.
 *
 * A customer may have the app open in several tabs on one cookie. The server keeps one "where"
 * per user and the stage shows one frame, so exactly one tab may ask, join and report: the one
 * the customer is looking at. The worker portal is a worker's cell-and-PIN session, not the
 * customer's app, and never takes part.
 */

/** the worker portal's root path */
export const WORKER_PORTAL = "/worker";

/** whether a page may take part in a demo at all */
export function demoEligible(pathname: string): boolean {
  return pathname !== WORKER_PORTAL &&
    !pathname.startsWith(`${WORKER_PORTAL}/`);
}

/** whether a tab with this `document.visibilityState` is the one the customer is looking at */
export function viewerTab(visibility: string | undefined): boolean {
  return visibility === "visible";
}
