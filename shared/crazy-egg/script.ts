/**
 * REQ-125 — Crazy Egg's tracking script on /landing2: JL Neilsen
 * (support@crazyegg.com), forwarded by Raphael 2026-10-28 — "install the
 * Crazy Egg tracking script on https://documonster.com/landing2 … Paste the
 * JavaScript tag into the <head> of the website".
 *
 * The pure half, shared by the app shell (front-end) and the tests:
 *
 *  - WHICH page: /landing2 alone — the page Crazy Egg was asked to track.
 *  - WHICH script: Crazy Egg's on the real deploy (DENO_DEPLOY / the
 *    platform's DENO_DEPLOYMENT_ID set), verbatim from the request; the app's
 *    own fake (`/crazy-egg-fake.js`, which only marks the document) when
 *    neither is — REQ-318: the gate, a dev box and a pin run on fakes, so a
 *    test run never records a session in the account.
 */
export const CRAZY_EGG_SCRIPT =
  "//script.crazyegg.com/pages/scripts/0110/3101.js";
export const FAKE_CRAZY_EGG_SCRIPT = "/crazy-egg-fake.js";

export interface CrazyEggConfig {
  mode: "real" | "fake";
  src: string;
}

export interface CrazyEggEnv {
  /** REQ-318's switch (env/prod) … */
  DENO_DEPLOY?: string;
  /** … and the platform's own mark on a Deno Deploy isolate (REQ-001) */
  DENO_DEPLOYMENT_ID?: string;
}

/** Crazy Egg's script on the real deploy; the fake elsewhere */
export function crazyEggConfig(env: CrazyEggEnv): CrazyEggConfig {
  const realDeploy = Boolean(env.DENO_DEPLOY?.trim()) ||
    Boolean(env.DENO_DEPLOYMENT_ID?.trim());
  return realDeploy
    ? { mode: "real", src: CRAZY_EGG_SCRIPT }
    : { mode: "fake", src: FAKE_CRAZY_EGG_SCRIPT };
}

/** the one page Crazy Egg tracks */
export function isCrazyEggPage(pathname: string): boolean {
  const p = pathname.length > 1 && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;
  return p === "/landing2";
}
