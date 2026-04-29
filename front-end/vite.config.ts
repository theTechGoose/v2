import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";

export default defineConfig({
  plugins: [
    fresh({
      islandSpecifiers: ["@/denostories/src/components/Menu.tsx"],
    }),
  ],
  assetsInclude: ["**/*.wasm"],
});
