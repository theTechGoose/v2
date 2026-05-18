import { define } from "../utils.ts";

// Browser-side `lib/api.ts` reads window.__PUBLIC_BACKEND_URL to decide
// where to POST. Inline the SSR-side env so islands hit the standalone
// backend (api.aimonsters.com in prod, ngrok in dev) instead of bouncing
// through the Fresh /api/* proxy.
const PUBLIC_BACKEND_URL = (typeof Deno !== "undefined"
  ? Deno.env.get("PUBLIC_BACKEND_URL") ?? ""
  : "");

export default define.page(function App({ Component }) {
  const bootScript = PUBLIC_BACKEND_URL
    ? `window.__PUBLIC_BACKEND_URL=${JSON.stringify(PUBLIC_BACKEND_URL)};`
    : "";
  return (
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="icon" type="image/png" href="/favicon.png" />
        <link rel="apple-touch-icon" href="/logo.png" />
        <title>Paperwork Monster</title>
        {bootScript ? <script dangerouslySetInnerHTML={{ __html: bootScript }} /> : null}
      </head>
      <body>
        <Component />
      </body>
    </html>
  );
});
