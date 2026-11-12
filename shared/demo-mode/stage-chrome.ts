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
