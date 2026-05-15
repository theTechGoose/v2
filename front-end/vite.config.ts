import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";

// Dev ports — match serve.ts's defaults but allow env override so anyone
// running vite directly (without serve.ts) can still pin them. PORT is
// the standard env vite/Node respects; BACKEND_URL/BACKEND_PORT drive
// the websocket proxy target.
const FRONTEND_PORT = Number(process.env.PORT ?? 5280);
const BACKEND_URL = process.env.BACKEND_URL
  ?? `http://localhost:${process.env.BACKEND_PORT ?? 4280}`;
const BACKEND_WS = BACKEND_URL.replace(/^http/, "ws");

export default defineConfig({
  plugins: [
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
    allowedHosts: [".ngrok.app", ".ngrok-free.app", ".trycloudflare.com"],
    // WebSocket proxy: AssemblyAI streaming runs through the backend
    // (Deno's `Deno.upgradeWebSocket` works there; Vite's Node http
    // server can't). Browser hits `/api/voice/stream` on Vite → Vite
    // forwards the upgrade to the backend's `/voice/stream`. Regular
    // `/api/...` HTTP traffic is still handled by the Fresh forward
    // proxy in routes/api/[...path].ts.
    proxy: {
      "/api/voice/stream": {
        target: BACKEND_WS,
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/voice/, "/voice"),
      },
    },
  },
});
