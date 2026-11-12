/**
 * REQ-297 — how the staff stage shows the mirror frame for a link status (demo-loop cycle 1,
 * issue m27: the gone customer's page stayed at full brightness).
 *
 * The frame keeps the customer's last screen (REQ-242) and the transport waits PRESENCE_GRACE_MS
 * before saying "waiting" (REQ-232 — a page change never flashes it). Once it does, that screen is
 * stale: it is greyed and dimmed under a "Waiting for {name}'s app…" overlay until the next
 * snapshot is applied — status alone is not enough, the link can be back before the first frame.
 *
 * REQ-370 — demo-loop cycle 2, issue m23: the first frame drew the customer's sidebar unstyled.
 * A snapshot rebuilds the page's <link rel=stylesheet> in a fresh document and the staff browser
 * fetches each sheet for the first time; until they land the page lays out with the UA's defaults.
 * So the frame is shown only once the replay is styled (`Replayer.styled()`, REQ-305) — or once
 * STYLE_WAIT_MS has passed since the first snapshot, so a sheet that never answers cannot hold the
 * stage dark. Until then the "Connecting to {name}…" overlay stays up.
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

/** REQ-370 — the longest the stage waits for the replay's stylesheets before it shows the frame */
export const STYLE_WAIT_MS = 1500;

/** REQ-370 — the frame may be shown: the replay is styled, or it has waited STYLE_WAIT_MS */
export function frameReady(
  { styled, waited }: {
    /** `Replayer.styled()`: every stylesheet the replay links has loaded (or failed) */
    styled: boolean;
    /** ms since the first snapshot was applied */
    waited: number;
  },
): boolean {
  return styled || waited >= STYLE_WAIT_MS;
}

export interface StageFrameLook {
  visibility: "visible" | "hidden";
  filter: string;
  /** the "Waiting for {name}'s app…" overlay sits on the frame */
  waiting: boolean;
}

export function stageFrameLook(
  { status, mirrored, stale, styled }: {
    status: StageLinkStatus;
    /** a snapshot has been in the frame */
    mirrored: boolean;
    /** the screen in the frame is from before the customer's app dropped */
    stale: boolean;
    /** REQ-370 — the replay's stylesheets are in (or STYLE_WAIT_MS passed): see frameReady */
    styled: boolean;
  },
): StageFrameLook {
  if (!mirrored || !styled) {
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
