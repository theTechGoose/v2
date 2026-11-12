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
 *
 * REQ-370 — demo-loop cycle 2, issue m23: the first frame drew the customer's sidebar unstyled.
 * A snapshot rebuilds the page's <link rel=stylesheet> in a fresh document and the staff browser
 * fetches each sheet for the first time; until they land the page lays out with the UA's defaults.
 * So the frame is shown only once the replay is styled (`Replayer.styled()`, REQ-305) — or once
 * STYLE_WAIT_MS has passed since the first snapshot, so a sheet that never answers cannot hold the
 * stage dark. Until then the "Connecting to {name}…" overlay stays up.
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
  /** the "Waiting for {name}'s app…" notice sits on the frame */
  waiting: boolean;
  /** REQ-541 (cycle 4, M22) — another window of this account has the demo: the frame is greyed
   *  under "This demo moved to another window · Use this window" (set only then) */
  elsewhere?: boolean;
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
  if (status === "replaced") {
    // REQ-541 (M22) — the frame is no longer followed here: never looks live, and the banner
    // (not the connecting spinner) says why, mirrored yet or not
    return {
      visibility: mirrored && styled ? "visible" : "hidden",
      filter: WAITING_FILTER,
      waiting: false,
      elsewhere: true,
    };
  }
  if (!mirrored || !styled) {
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

/** REQ-541 (cycle 4, M22) — what the stage does with an /active answer. A stage that showed a
 *  demo and now finds none (ended from another window of this account, which this one — replaced
 *  — never heard) hands the presenter their own account back; it is never left impersonating
 *  the customer behind "No demo is open". A stage that never had one shows the empty screen. */
export function afterActiveCheck(
  { found, shown }: {
    /** /active returned this presenter's session */
    found: boolean;
    /** a demo was shown on this stage before */
    shown: boolean;
  },
): "show" | "handBack" | "empty" {
  if (found) return "show";
  return shown ? "handBack" : "empty";
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
