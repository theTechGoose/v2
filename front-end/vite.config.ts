import { defineConfig, type Plugin } from "vite";
import { fresh } from "@fresh/plugin-vite";

/**
 * Force any resolution that lands on @opentelemetry/api's CJS entrypoint
 * (`build/src/index.js`) to load the ESM build (`build/esm/index.js`)
 * instead. Deno's npm cache resolves the package's `default` exports
 * condition to CJS, which Vite SSR cannot evaluate (you get
 * "exports is not defined" when the file does `Object.defineProperty(
 * exports, "__esModule", ...)`).
 *
 * Path-rewrite is the only reliable hammer because the resolution happens
 * inside Deno's loader before Vite's resolve hooks see it.
 */
function otelEsmFix(): Plugin {
  return {
    name: "otel-esm-fix",
    enforce: "pre",
    resolveId(id, _importer, _opts) {
      // Catch both bare specifier and the resolved CJS path.
      if (id === "@opentelemetry/api" || id.endsWith("/@opentelemetry/api")) {
        return id; // let other resolvers handle it; we patch via load below
      }
      return null;
    },
    load(id) {
      if (id.includes("/@opentelemetry/api/build/src/index.js")) {
        // Re-export from the ESM build that ships in the same package.
        const esm = id.replace("/build/src/index.js", "/build/esm/index.js");
        return `export * from ${JSON.stringify(esm)};`;
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [otelEsmFix(), fresh()],
  ssr: {
    noExternal: ["@opentelemetry/api"],
  },
});
