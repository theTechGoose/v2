import { defineConfig } from "cypress";

/**
 * Cypress harness for the v2 contractor app.
 *
 * The dev server (deno task serve at the repo root) brings up the
 * backend on :4280 and the frontend on :5280. Tests target the
 * frontend; the frontend proxies API calls to :4280 internally.
 *
 * Install + run:
 *   cd cypress && npm install && npm run open    # interactive
 *   cd cypress && npm run run                    # headless (CI)
 *
 * Override the base URL for staging/prod with CYPRESS_BASE_URL.
 */
export default defineConfig({
  e2e: {
    baseUrl: process.env.CYPRESS_BASE_URL ?? "http://localhost:5280",
    specPattern: "e2e/**/*.cy.{ts,tsx,js,jsx}",
    supportFile: "support/e2e.ts",
    fixturesFolder: "fixtures",
    video: false,
    screenshotOnRunFailure: true,
    // Audit-2 default viewport (1440×900). Override per-spec for
    // responsive tests (390px mobile, 1024×1366 tablet).
    viewportWidth: 1440,
    viewportHeight: 900,
    // Most flows hop between contractor + customer contexts via cookies.
    // Slightly longer timeouts because dev SSR + KV warm-up on the first
    // request can be slow.
    defaultCommandTimeout: 8_000,
    pageLoadTimeout: 30_000,
    retries: { runMode: 2, openMode: 0 },
  },
});
