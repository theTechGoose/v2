import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";
import process from "node:process";
import { RETIRED_HOSTS } from "../shared/site-host/retired.ts";
import { demoEarly } from "./vite-demo-early.ts";

// Dev ports — match serve.ts's defaults but allow env override so anyone
// running vite directly (without serve.ts) can still pin them. PORT is
// the standard env vite/Node respects; BACKEND_URL/BACKEND_PORT drive
// the websocket proxy target.
const FRONTEND_PORT = Number(process.env.PORT ?? 5280);
const BACKEND_URL = process.env.BACKEND_URL ??
  `http://localhost:${process.env.BACKEND_PORT ?? 4280}`;
const BACKEND_WS = BACKEND_URL.replace(/^http/, "ws");

/**
 * REQ-189 — dev modules are never cached. Vite answers every transformed module with
 * `Cache-Control: no-cache` + ETag and trusts the browser to revalidate; the staff's Safari did
 * not, kept an island from before an edit (importing a module since deleted) and the page never
 * hydrated. Vite's `send()` sets the header AFTER any middleware ran, so this wraps
 * `res.setHeader` and rewrites `no-cache` to `no-store` — pre-bundled deps (`immutable`) are
 * untouched.
 */
const devNoStore = () => ({
  name: "pm-dev-no-store",
  configureServer(server: {
    middlewares: {
      use(
        fn: (
          req: unknown,
          res: {
            setHeader(name: string, value: unknown): unknown;
          },
          next: () => void,
        ) => void,
      ): void;
    };
  }) {
    server.middlewares.use((_req, res, next) => {
      const set = res.setHeader.bind(res);
      res.setHeader = (name: string, value: unknown) =>
        set(
          name,
          name.toLowerCase() === "cache-control" && value === "no-cache"
            ? "no-store"
            : value,
        );
      next();
    });
  },
});

export default defineConfig({
  plugins: [
    devNoStore(),
    // REQ-648 — the customer's early demo script: its URL for _app.tsx, its own browser build
    demoEarly(),
    fresh({
      islandSpecifiers: ["@/denostories/src/components/Menu.tsx"],
    }),
  ],
  assetsInclude: ["**/*.wasm"],
  // Dev server: allow ngrok / *.trycloudflare.com / similar tunnels so we
  // can hit local dev from a public URL without Vite's host check
  // returning "Blocked request". Safe in dev only — vite respects this
  // setting just for the dev server.
  server: {
    port: FRONTEND_PORT,
    strictPort: true,
    allowedHosts: [
      ".ngrok.app",
      ".ngrok-free.app",
      ".trycloudflare.com",
      // REQ-219: the site's own name and the retired hosts, so a request
      // naming one reaches the app's redirect rule in dev as it does in prod
      "documonster.com",
      ...RETIRED_HOSTS,
    ],
    // Allow importing the shared string catalog from the repo root
    // (/lang/*.json), which sits one level above the front-end project root.
    fs: { allow: [".."] },
    // WebSocket proxy: AssemblyAI streaming runs through the backend
    // (Deno's `Deno.upgradeWebSocket` works there; Vite's Node http
    // server can't). Browser hits `/api/voice/stream` on Vite → Vite
    // forwards the upgrade to the backend's `/voice/stream`. Regular
    // `/api/...` HTTP traffic is still handled by the Fresh forward
    // proxy in routes/api/[...path].ts.
    proxy: {
      // REQ-153 — demo mode's signaling socket. Forwarded UNCHANGED: the backend serves it at
      // /api/demo-mode/ws on purpose, because on the deploy the root router hands an upgrade to
      // the backend with the original request and path (compose-router.ts).
      "/api/demo-mode/ws": {
        target: BACKEND_WS,
        ws: true,
        changeOrigin: true,
      },
      "/api/voice/stream": {
        target: BACKEND_WS,
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/voice/, "/voice"),
      },
    },
  },
});
