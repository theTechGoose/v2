/**
 * REQ-537 (demo-loop cycle 4, issue m36) — the stage has one exit.
 *
 * The presenter's browser on the stage is an impersonation session, so the global impersonation
 * banner ("Impersonating … · Return to your account") used to sit above the stage next to the
 * pill's End demo: two exits that, for a lone presenter, do the same thing. The banner is not drawn
 * on the stage (every other page keeps it); with more than one presenter the stage pill offers
 * "Leave the demo" as a secondary action (alone, leaving would end the demo — that is End).
 */
import { STAGE_PATH } from "./protocol.ts";

/** is the impersonation banner drawn on this page — everywhere but the stage */
export function impersonationBannerOn(pathname: string): boolean {
  return pathname.replace(/\/+$/, "") !== STAGE_PATH;
}

/** does the stage pill offer "Leave the demo" next to End — only when others present too */
export function stageLeaveShown(presenters: number): boolean {
  return presenters > 1;
}

/**
 * REQ-650 (demo-loop cycle 5, issue c4-m1) — the stage bar is a product bar. The mirror's counters
 * (REQ-309) used to show whenever the stage was served from localhost, so every demo run saw
 * "mirror f477 hb299 …", the bar wrapped and End dropped to a second line. They show only behind
 * an explicit flag: `?debug=1` in the address, or `localStorage[STAGE_DEBUG_KEY] = "1"` (which
 * survives the hop from /admin to the stage). `?debug=0` switches a stored flag off for one look.
 */
export const STAGE_DEBUG_KEY = "pm_demo_debug";
export function stageDebugOn(search: string, stored: string | null): boolean {
  const q = new URLSearchParams(search).get("debug");
  if (q !== null) return q === "1";
  return stored === "1";
}

/**
 * REQ-650 — the pill height the frame's bottom inset (REQ-228) is taken from. While End asks, the
 * inset keeps the resting pill's height: the question never moves or resizes the frame (and it
 * replaces the pill's spans, so the pill itself does not grow). Before anything was measured the
 * first measure counts.
 */
export function stagePillH(
  prev: number,
  measured: number,
  endAsking: boolean,
): number {
  return endAsking && prev > 0 ? prev : measured;
}
