import { define } from "../utils.ts";
import MobileViewport from "../islands/MobileViewport.tsx";
import ImpersonationBanner from "../islands/ImpersonationBanner.tsx";
import { readSessionCookie } from "../lib/api.ts";
import { tFor } from "../lib/i18n.ts";

// Browser-side `lib/api.ts` reads window.__PUBLIC_BACKEND_URL to decide
// where to POST. Inline the SSR-side env so islands hit the standalone
// backend (api.aimonsters.com in prod, ngrok in dev) instead of bouncing
// through the Fresh /api/* proxy.
const PUBLIC_BACKEND_URL = typeof Deno !== "undefined"
  ? Deno.env.get("PUBLIC_BACKEND_URL") ?? ""
  : "";

export default define.page(function App(ctx) {
  const { Component } = ctx;
  const bootScript = PUBLIC_BACKEND_URL
    ? `window.__PUBLIC_BACKEND_URL=${JSON.stringify(PUBLIC_BACKEND_URL)};`
    : "";
  // P-67: only mount the impersonation banner when the request actually
  // carries a session cookie. pm_session is HttpOnly, so the island can't
  // gate itself client-side — without this SSR gate it probed
  // /api/admin/whoami on EVERY page for anonymous visitors too, spraying
  // transient 5xx/refused noise across login/logout transitions.
  const hasSession =
    readSessionCookie(ctx.req.headers.get("cookie")) !== undefined;
  return (
    <html>
      <head>
        <meta charset="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content"
        />
        <link rel="icon" type="image/png" href="/favicon.png" />
        <link rel="apple-touch-icon" href="/logo.png" />
        <title>{tFor("en", "brand.name")}</title>
        {bootScript
          ? (
            <script
              // Server-built boot script (no user input).
              // deno-lint-ignore react-no-danger
              dangerouslySetInnerHTML={{ __html: bootScript }}
            />
          )
          : null}
      </head>
      <body>
        {
          /* Global keyboard handling: mirrors visualViewport.height into
            --app-vh on every page. iOS Safari overlays the soft keyboard
            without shrinking 100dvh, so page shells anchored to --app-vh
            track the space above the keyboard (inputs/buttons never get
            trapped behind it). Android is covered by interactive-widget
            above; this makes iOS behave the same. Renders nothing. */
        }
        <MobileViewport />
        {
          /* Global super-admin impersonation banner. Mounted only for
            requests that carry a session cookie (SSR gate above); it then
            self-gates on /admin/whoami — renders nothing for ordinary
            sessions. */
        }
        {hasSession ? <ImpersonationBanner /> : null}
        <Component />
      </body>
    </html>
  );
});
