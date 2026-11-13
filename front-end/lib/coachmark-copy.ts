/**
 * REQ-616 (demo cycle 4, p4-p8e): the dashboard coachmark's copy follows the
 * PRIMARY pointer. The coachmark only shows where the sidebar's /assistant
 * pill is on screen (desktop/tablet), so a mouse is the usual pointer there —
 * "Tap here…" read wrong. A coarse primary pointer (touch tablet) keeps the
 * tap wording; anything else gets click wording.
 */
export const COACHMARK_COARSE_QUERY = "(pointer: coarse)";

export interface CoachmarkCopyKeys {
  ariaLabel: string;
  body: string;
  dismissHint: string;
  heading: string;
}

const P = "assistantCoachmark.";

export function coachmarkCopyKeys(coarsePointer: boolean): CoachmarkCopyKeys {
  const suffix = coarsePointer ? "" : "Click";
  return {
    ariaLabel: `${P}ariaLabel${suffix}`,
    body: `${P}body${suffix}`,
    dismissHint: `${P}dismissHint${suffix}`,
    heading: `${P}heading${suffix}`,
  };
}
