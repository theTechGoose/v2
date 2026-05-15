import { defineConfig } from "cypress";

/**
 * Cypress harness for the v2 contractor app.
 *
 * The dev server (deno task serve at the repo root) brings up the
 * backend on :3000 and the frontend on :5173. Tests target the
 * frontend; the frontend proxies API calls to :3000 internally.
 *
 * Install + run:
 *   cd cypress && npm install && npm run open    # interactive
 *   cd cypress && npm run run                    # headless (CI)
 *
 * Override the base URL for staging/prod with CYPRESS_BASE_URL.
 */
export default defineConfig({
  e2e: {
    baseUrl: process.env.CYPRESS_BASE_URL ?? "http://localhost:5173",
    specPattern: "e2e/**/*.cy.{ts,tsx,js,jsx}",
    supportFile: "support/e2e.ts",
    fixturesFolder: "fixtures",
    video: false,
    screenshotOnRunFailure: true,
    // Most invoice flows hop between contractor + customer contexts via
    // cookies. Slightly longer timeouts because dev SSR + KV warm-up on
    // the first request can be slow.
    defaultCommandTimeout: 8_000,
    pageLoadTimeout: 30_000,
    retries: { runMode: 2, openMode: 0 },
  },
});
