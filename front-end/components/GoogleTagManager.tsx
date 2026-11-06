/**
 * REQ-183 — Google Tag Manager in the app shell, on every page (Raphael,
 * 2026-11-05: "install this" — Emily Keck's install instructions). Two
 * halves: `<GoogleTagManager>` is the container snippet, first in <head>;
 * `<GoogleTagManagerNoscript>` is the iframe for browsers without scripts,
 * first in <body>. Google's loader on the real deploy with GTM_ID set, nothing
 * on the real deploy without it, the app's own fake on the gate and a dev box
 * (shared/google-tag-manager/gtm.ts); the inline snippet is Google's, verbatim.
 */
import {
  gtmConfig,
  gtmHeadScript,
  gtmNoscriptSrc,
} from "../../shared/google-tag-manager/gtm.ts";

const CONFIG = typeof Deno !== "undefined"
  ? gtmConfig({
    GTM_ID: Deno.env.get("GTM_ID"),
    DENO_DEPLOY: Deno.env.get("DENO_DEPLOY"),
    DENO_DEPLOYMENT_ID: Deno.env.get("DENO_DEPLOYMENT_ID"),
  })
  : null;

export default function GoogleTagManager() {
  if (!CONFIG) return null;
  return (
    <script
      data-gtm={CONFIG.mode}
      // Server-built snippet (the id comes from env, validated, never from a request).
      // deno-lint-ignore react-no-danger
      dangerouslySetInnerHTML={{ __html: gtmHeadScript(CONFIG) }}
    />
  );
}

export function GoogleTagManagerNoscript() {
  if (!CONFIG || CONFIG.mode !== "real") return null;
  return (
    <noscript>
      <iframe
        src={gtmNoscriptSrc(CONFIG.id)}
        height="0"
        width="0"
        style="display:none;visibility:hidden"
      />
    </noscript>
  );
}
