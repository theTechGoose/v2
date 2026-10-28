/**
 * REQ-124 — the Google tag (gtag.js) in the app shell's <head>, on every
 * page (Raphael, 2026-10-28: "i need to add this" — Google's snippet for
 * G-RN3H6L5263). Google's loader on the real deploy, the app's own fake on
 * the gate and a dev box (shared/google-tag/tag.ts); the inline snippet is
 * Google's, verbatim.
 */
import {
  googleTagBootScript,
  googleTagConfig,
  googleTagLoaderSrc,
} from "../../shared/google-tag/tag.ts";

const CONFIG = typeof Deno !== "undefined"
  ? googleTagConfig({
    DENO_DEPLOY: Deno.env.get("DENO_DEPLOY"),
    DENO_DEPLOYMENT_ID: Deno.env.get("DENO_DEPLOYMENT_ID"),
  })
  : null;

export default function GoogleTag() {
  if (!CONFIG) return null;
  return (
    <>
      <script
        async
        src={googleTagLoaderSrc(CONFIG)}
        data-google-tag={CONFIG.mode}
      />
      <script
        data-google-tag-boot=""
        // Server-built snippet (the id is a constant, never from a request).
        // deno-lint-ignore react-no-danger
        dangerouslySetInnerHTML={{ __html: googleTagBootScript(CONFIG.id) }}
      />
    </>
  );
}
