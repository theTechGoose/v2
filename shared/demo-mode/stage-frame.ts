/**
 * REQ-297 — how the staff stage shows the mirror frame for a link status (demo-loop cycle 1,
 * issue m27: the gone customer's page stayed at full brightness).
 *
 * The frame keeps the customer's last screen (REQ-242) and the transport waits PRESENCE_GRACE_MS
 * before saying "waiting" (REQ-232 — a page change never flashes it). Once it does, that screen is
 * stale: it is greyed and dimmed under a "Waiting for {name}'s app…" notice until the next
 * snapshot is applied — status alone is not enough, the link can be back before the first frame.
 *
 * REQ-391 (demo-loop cycle 2, M4 + m21) — what the pill says is the FRAME's truth, in time:
 * "Live" only when the frame shows the followed tab's screen and its frames come in within
 * LAG_BEHIND_MS; "Loading their next page…" while their page is gone and the next one may come
 * (the link's "between") or a newly followed tab's snapshot is not in yet; "Catching up…" while
 * a resync is asked and not in; "Behind N s" while the frames come late. The waiting notice is a
 * banner across the frame's top edge (the island draws it), never a card over their page.
 */

/** the transport's link status — mirrored here so this module stays free of the front-end.
 *  REQ-391 — "between": the followed tab's page went and its next page may still come (the
 *  presence grace is running) */
export type StageLinkStatus =
  | "connecting"
  | "waiting"
  | "between"
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
  /** the "Waiting for {name}'s app…" notice sits on the frame */
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
    (stale &&
      (status === "direct" || status === "relay" || status === "between"));
  return {
    visibility: "visible",
    filter: waiting ? WAITING_FILTER : "none",
    waiting,
  };
}

/** REQ-391 — frames arriving more than this behind the customer's screen: "Behind N s" */
export const LAG_BEHIND_MS = 1_500;
/** REQ-391 — …and "Live" again only once they arrive within this (no flicker at the edge) */
export const LAG_LIVE_MS = 1_000;

/** REQ-391 — how many whole seconds behind the pill says (0: not behind), from the last frame's
 *  lag (null: nothing measured) and what it said before */
export function behindSeconds(lagMs: number | null, was: number): number {
  if (lagMs === null) return 0;
  if (lagMs > LAG_BEHIND_MS) return Math.max(2, Math.round(lagMs / 1000));
  if (was > 0 && lagMs > LAG_LIVE_MS) return was;
  return 0;
}

export type StageStatusKey =
  | "ended"
  | "elsewhere"
  | "waiting"
  | "connecting"
  | "loadingNext"
  | "catchingUp"
  | "behind"
  | "live";

/** REQ-391 — the pill's words for the stage, most wrong first */
export function stageStatus(o: {
  ended: boolean;
  status: StageLinkStatus;
  /** REQ-309 — a snapshot is in the frame */
  mirrored: boolean;
  /** another tab (or page) is followed and its snapshot is not in the frame yet */
  awaiting: boolean;
  /** a fresh snapshot was asked for (a gap, a frame that did not fit) and is not in yet */
  resyncing: boolean;
  /** behindSeconds of the frames coming in */
  behind: number;
}): { key: StageStatusKey; n?: number } {
  if (o.ended || o.status === "ended") return { key: "ended" };
  if (o.status === "replaced") return { key: "elsewhere" };
  if (o.status === "waiting") return { key: "waiting" };
  if (o.status === "between") {
    return { key: o.mirrored ? "loadingNext" : "connecting" };
  }
  if (o.status !== "direct" && o.status !== "relay") {
    return { key: "connecting" };
  }
  if (!o.mirrored) return { key: "connecting" };
  if (o.awaiting) return { key: "loadingNext" };
  if (o.resyncing) return { key: "catchingUp" };
  if (o.behind > 0) return { key: "behind", n: o.behind };
  return { key: "live" };
}
