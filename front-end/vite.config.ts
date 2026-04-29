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
  },
});
