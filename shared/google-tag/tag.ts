/**
 * REQ-124 — the Google tag (gtag.js) on every page: Raphael, 2026-10-28,
 * "i need to add this" — Google's snippet for the property G-RN3H6L5263 —
 * "and make sure google analytics works".
 *
 * The pure half, shared by the app shell (front-end) and the tests:
 *
 *  - WHICH id: the one property, pinned here — the measurement id is public
 *    (every visitor's browser sees it) and no env var has a say.
 *  - WHICH loader: Google's on the real deploy (DENO_DEPLOY / the platform's
 *    DENO_DEPLOYMENT_ID set); the app's own fake (`/google-tag-fake.js`,
 *    which only marks the document) when neither is — REQ-318: the gate, a
 *    dev box and a pin run on fakes, so test traffic never lands in the
 *    property's reports.
 *  - WHICH pages: every page. Site analytics, unlike the Meta Pixel's ad
 *    funnel (REQ-080) — the shell renders it with no path gate.
 *  - The inline snippet, exactly as Google prescribes it: the dataLayer, the
 *    gtag() function, `js` with the time, then `config` with the id.
 */
export const GA_MEASUREMENT_ID = "G-RN3H6L5263";
export const REAL_GTAG_LOADER = "https://www.googletagmanager.com/gtag/js";
export const FAKE_GTAG_LOADER = "/google-tag-fake.js";

export interface GoogleTagConfig {
  mode: "real" | "fake";
  id: string;
  loader: string;
}

export interface GoogleTagEnv {
  /** REQ-318's switch (env/prod) … */
  DENO_DEPLOY?: string;
  /** … and the platform's own mark on a Deno Deploy isolate (REQ-001) */
  DENO_DEPLOYMENT_ID?: string;
}

/** Google's loader on the real deploy; the fake elsewhere — the tag always loads */
export function googleTagConfig(env: GoogleTagEnv): GoogleTagConfig {
  const realDeploy = Boolean(env.DENO_DEPLOY?.trim()) ||
    Boolean(env.DENO_DEPLOYMENT_ID?.trim());
  return realDeploy
    ? { mode: "real", id: GA_MEASUREMENT_ID, loader: REAL_GTAG_LOADER }
    : { mode: "fake", id: GA_MEASUREMENT_ID, loader: FAKE_GTAG_LOADER };
}

/** the async loader's url — the id rides it, as in Google's snippet */
export function googleTagLoaderSrc(cfg: GoogleTagConfig): string {
  return `${cfg.loader}?id=${encodeURIComponent(cfg.id)}`;
}

/** Google's inline snippet, verbatim: dataLayer, gtag(), js, config */
export function googleTagBootScript(id: string): string {
  return "window.dataLayer = window.dataLayer || [];\n" +
    "function gtag(){dataLayer.push(arguments);}\n" +
    "gtag('js', new Date());\n" +
    `gtag('config', '${id}');`;
}
