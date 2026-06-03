import { define } from "../utils.ts";
import MobileViewport from "../islands/MobileViewport.tsx";

// Browser-side `lib/api.ts` reads window.__PUBLIC_BACKEND_URL to decide
// where to POST. Inline the SSR-side env so islands hit the standalone
// backend (api.aimonsters.com in prod, ngrok in dev) instead of bouncing
// through the Fresh /api/* proxy.
const PUBLIC_BACKEND_URL = typeof Deno !== "undefined"
  ? Deno.env.get("PUBLIC_BACKEND_URL") ?? ""
  : "";

export default define.page(function App({ Component }) {
  const bootScript = PUBLIC_BACKEND_URL
    ? `window.__PUBLIC_BACKEND_URL=${JSON.stringify(PUBLIC_BACKEND_URL)};`
    : "";
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
        <title>Paperwork Monster</title>
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
        <Component />
      </body>
    </html>
  );
});
