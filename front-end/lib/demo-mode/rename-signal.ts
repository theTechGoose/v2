/**
 * REQ-836 (demo-loop cycle dm2, m1) — the customer saved their name on this page (Settings, the
 * staff name prompt, /welcome's name step: each announces it as `pm:profile-updated` with a
 * `name`). The overlay relays it on its open demo link as a `renamed` frame; the stage asks
 * GET /demo-mode/active at once, which names the customer by the saved name. Before, the stage
 * waited for its next ACTIVE_NAME_REFRESH_MS (15 s) ask or the customer's next page — and
 * /welcome's steps are one page.
 */
import type { PeerMessage } from "../../../shared/demo-mode/protocol.ts";
import {
  PROFILE_UPDATED,
  type ProfileUpdatedDetail,
} from "../profile-events.ts";

interface WinLike {
  addEventListener(type: string, fn: (e: Event) => void): void;
  removeEventListener(type: string, fn: (e: Event) => void): void;
}

/** send `renamed` on every name saved on this page (a business rename alone is not one);
 *  returns unsubscribe */
export function relayRenames(
  send: (m: PeerMessage) => void,
  win: WinLike = globalThis as unknown as WinLike,
): () => void {
  const heard = (e: Event) => {
    const name = (e as CustomEvent<ProfileUpdatedDetail>).detail?.name;
    if (typeof name === "string") send({ k: "renamed" });
  };
  win.addEventListener(PROFILE_UPDATED, heard);
  return () => win.removeEventListener(PROFILE_UPDATED, heard);
}
