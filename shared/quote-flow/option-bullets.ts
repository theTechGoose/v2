/**
 * REQ-266 (demo issue ai-assistant-p7-options) — how many scope bullets one
 * job option keeps, and what its "wider scope" version is. Shared by the
 * options coordinator (model reply + heuristic fallback) and the island's
 * last-resort fallback, so no path quietly cuts a long job to four lines.
 */

/** Most bullets one option keeps. Matches the options prompt's "at most 12":
 *  a ten-item gut job (demo, curbless shower, slab cut, glass, vanity, hex
 *  mosaic, faucets, fan, lights, permit) survives whole. */
export const MAX_OPTION_BULLETS = 12;

/** The "· Wider scope" version: EVERY bullet plus jobsite cleanup (once) —
 *  never fewer items than the full version. */
export function widerBullets(bullets: string[], cleanup: string): string[] {
  const key = cleanup.toLowerCase();
  const has = bullets.some((b) => b.toLowerCase() === key);
  return has ? bullets.slice() : [...bullets, cleanup];
}
