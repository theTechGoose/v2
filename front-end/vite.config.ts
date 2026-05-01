import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";

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
    allowedHosts: [".ngrok.app", ".ngrok-free.app", ".trycloudflare.com"],
    // WebSocket proxy: AssemblyAI streaming runs through the backend
    // (Deno's `Deno.upgradeWebSocket` works there; Vite's Node http
    // server can't). Browser hits `/api/voice/stream` on Vite → Vite
    // forwards the upgrade to the backend's `/voice/stream`. Regular
    // `/api/...` HTTP traffic is still handled by the Fresh forward
    // proxy in routes/api/[...path].ts.
    proxy: {
      "/api/voice/stream": {
        target: "ws://localhost:3000",
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/voice/, "/voice"),
      },
    },
  },
});
