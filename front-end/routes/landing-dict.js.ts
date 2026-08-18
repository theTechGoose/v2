/**
 * GET /landing-dict.js — ships the ONE landing dictionary
 * (lib/landing-dict.ts) to the browser as `window.__PM_LANDING_DICT`.
 *
 * `routes/index.tsx` renders the active language from the same module at SSR
 * time (P-19: Spanish paints Spanish, no EN-first flash) and loads this script
 * before /landing-scripts.js, which uses it for the client-side language
 * toggle. Serving it from its own URL — instead of inlining the object in the
 * page — keeps the other language's copy OUT of the HTML, so the Spanish page
 * never carries English social proof (P-08) and vice versa.
 */
import { define } from "../utils.ts";
import { LANDING_DICT } from "../lib/landing-dict.ts";

const BODY = `window.__PM_LANDING_DICT=${JSON.stringify(LANDING_DICT)};`;

export const handler = define.handlers({
  GET() {
    return new Response(BODY, {
      headers: {
        "content-type": "text/javascript; charset=utf-8",
        // Immutable per deploy; the dict only changes when the bundle does.
        "cache-control": "public, max-age=300",
      },
    });
  },
});
