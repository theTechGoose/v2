/**
 * REQ-183 — Google Tag Manager on every page: Raphael, 2026-11-05, "install
 * this" — Emily Keck's install instructions (the container snippet "as high
 * as possible inside <head>, on every page", the noscript iframe "right after
 * the opening <body> tag, on every page").
 *
 * The pure half, shared by the app shell (front-end) and the tests:
 *
 *  - WHICH id: the thread carries the placeholder GTM-XXXXXXX, so the
 *    container id comes from the env (`GTM_ID`), validated as `GTM-` plus
 *    letters/digits — it is interpolated into an inline script, and anything
 *    else counts as unset.
 *  - WHICH loader: Google's on the real deploy (DENO_DEPLOY / the platform's
 *    DENO_DEPLOYMENT_ID set) with an id; NOTHING on the real deploy without
 *    one — tag management never takes the site down; the app's own fake
 *    (`/gtm-fake.js`, which only marks the document) when neither is set —
 *    REQ-318: the gate, a dev box and a pin run on fakes, so test traffic
 *    never lands in the container's reports. On fakes the id is GTM_ID when
 *    set, the placeholder container otherwise.
 *  - WHICH pages: every page, no path gate (as REQ-124's Google tag).
 *  - The inline snippet, exactly as Google prescribes it; on fakes only the
 *    loader's origin differs.
 */
export const REAL_GTM_LOADER = "https://www.googletagmanager.com/gtm.js";
export const FAKE_GTM_LOADER = "/gtm-fake.js";
export const REAL_GTM_NOSCRIPT = "https://www.googletagmanager.com/ns.html";
export const FAKE_GTM_ID = "GTM-FAKE000";

export interface GtmConfig {
  mode: "real" | "fake";
  id: string;
  loader: string;
}

export interface GtmEnv {
  /** the container id (GTM-XXXXXXX in the thread was a placeholder) */
  GTM_ID?: string;
  /** REQ-318's switch (env/prod) … */
  DENO_DEPLOY?: string;
  /** … and the platform's own mark on a Deno Deploy isolate (REQ-001) */
  DENO_DEPLOYMENT_ID?: string;
}

/** a container id Google would issue: GTM- then upper-case letters/digits — never the placeholder */
export function isGtmId(id: string): boolean {
  return /^GTM-[A-Z0-9]+$/.test(id) && id !== "GTM-XXXXXXX";
}

/** Google's loader on the real deploy with an id, nothing there without one; the fake elsewhere */
export function gtmConfig(env: GtmEnv): GtmConfig | null {
  const realDeploy = Boolean(env.DENO_DEPLOY?.trim()) ||
    Boolean(env.DENO_DEPLOYMENT_ID?.trim());
  const raw = env.GTM_ID?.trim() ?? "";
  const id = isGtmId(raw) ? raw : "";
  if (!realDeploy) {
    return { mode: "fake", id: id || FAKE_GTM_ID, loader: FAKE_GTM_LOADER };
  }
  return id ? { mode: "real", id, loader: REAL_GTM_LOADER } : null;
}

/** Google's container snippet, verbatim — only the loader's url and the id are the config's */
export function gtmHeadScript(cfg: GtmConfig): string {
  return "(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':\n" +
    "new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],\n" +
    "j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=\n" +
    `'${cfg.loader}?id='+i+dl;f.parentNode.insertBefore(j,f);\n` +
    `})(window,document,'script','dataLayer','${cfg.id}');`;
}

/** the noscript iframe's url, as Google prescribes it */
export function gtmNoscriptSrc(id: string): string {
  return `${REAL_GTM_NOSCRIPT}?id=${encodeURIComponent(id)}`;
}
