/**
 * REQ-297 — how the staff stage shows the mirror frame for a link status (demo-loop cycle 1,
 * issue m27: the gone customer's page stayed at full brightness).
 *
 * The frame keeps the customer's last screen (REQ-242) and the transport waits PRESENCE_GRACE_MS
 * before saying "waiting" (REQ-232 — a page change never flashes it). Once it does, that screen is
 * stale: it is greyed and dimmed under a "Waiting for {name}'s app…" overlay until the next
 * snapshot is applied — status alone is not enough, the link can be back before the first frame.
 */

/** the transport's link status — mirrored here so this module stays free of the front-end */
export type StageLinkStatus =
  | "connecting"
  | "waiting"
  | "relay"
  | "direct"
  | "ended"
  | "closed"
  | "replaced";

/** the stale screen's look: no colour, well under full brightness */
export const WAITING_FILTER = "grayscale(1) brightness(.6)";

export interface StageFrameLook {
  visibility: "visible" | "hidden";
  filter: string;
  /** the "Waiting for {name}'s app…" overlay sits on the frame */
  waiting: boolean;
}

export function stageFrameLook(
  { status, mirrored, stale }: {
    status: StageLinkStatus;
    /** a snapshot has been in the frame */
    mirrored: boolean;
    /** the screen in the frame is from before the customer's app dropped */
    stale: boolean;
  },
): StageFrameLook {
  if (!mirrored) {
    return { visibility: "hidden", filter: "none", waiting: false };
  }
  const waiting = status === "waiting" ||
    (stale && (status === "direct" || status === "relay"));
  return {
    visibility: "visible",
    filter: waiting ? WAITING_FILTER : "none",
    waiting,
  };
}
