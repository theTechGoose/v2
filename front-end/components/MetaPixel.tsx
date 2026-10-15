/**
 * REQ-080 — the Meta Pixel on the ad funnel (Raphael, 2026-10-15: "i want
 * to do facebook adverts here, need a tracking pixel to track conversions").
 *
 * `<MetaPixel>` is rendered once, in the app shell's <head>, and paints
 * nothing unless the page is one of the funnel's (shared/meta-pixel/pixel.ts
 * isPixelPage) and a loader is configured: Meta's on the real deploy with
 * META_PIXEL_ID set, the app's own fake when DENO_DEPLOY is unset, nothing
 * on the real deploy without an id.
 *
 * `<MetaPixelEvent>` is what a funnel page puts in its <Head> for the one
 * conversion that page is: Lead on the code page, CompleteRegistration on
 * the welcome wizard, Subscribe where the receipt lands.
 */
import {
  isPixelPage,
  pixelBootScript,
  pixelConfig,
  type PixelEvent,
  pixelEventScript,
  pixelNoscriptSrc,
} from "../../shared/meta-pixel/pixel.ts";

const CONFIG = typeof Deno !== "undefined"
  ? pixelConfig({
    META_PIXEL_ID: Deno.env.get("META_PIXEL_ID"),
    DENO_DEPLOY: Deno.env.get("DENO_DEPLOY"),
    DENO_DEPLOYMENT_ID: Deno.env.get("DENO_DEPLOYMENT_ID"),
  })
  : null;

export default function MetaPixel({ path }: { path: string }) {
  if (!CONFIG || !isPixelPage(path)) return null;
  return (
    <>
      <script
        data-meta-pixel-boot={CONFIG.mode}
        // Server-built snippet (the loader url and the id come from env, never from a request).
        // deno-lint-ignore react-no-danger
        dangerouslySetInnerHTML={{ __html: pixelBootScript(CONFIG) }}
      />
      {CONFIG.mode === "real"
        ? (
          <noscript>
            <img
              height="1"
              width="1"
              style="display:none"
              alt=""
              src={pixelNoscriptSrc(CONFIG.id)}
            />
          </noscript>
        )
        : null}
    </>
  );
}

export function MetaPixelEvent({ event }: { event: PixelEvent }) {
  return (
    <script
      data-meta-pixel-event={event.name}
      // Server-built from the event's name, id and numbers — no user text.
      // deno-lint-ignore react-no-danger
      dangerouslySetInnerHTML={{ __html: pixelEventScript(event) }}
    />
  );
}
