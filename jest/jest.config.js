/**
 * Two projects:
 *  - unit:        pure logic against shared/quote-flow modules (no network)
 *  - integration: real HTTP against the dev stack (deno task serve → :5280/:4280)
 *
 * Diagnostics are off so a missing not-yet-implemented module fails as a
 * clean runtime "Cannot find module" (the intended TDD red), not a wall of
 * TS errors.
 */
const shared = {
  testEnvironment: "node",
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { diagnostics: false }],
  },
  moduleNameMapper: {
    // Allow Deno-style explicit .ts extensions in relative imports.
    "^(\\.{1,2}/.*)\\.ts$": "$1",
  },
};

module.exports = {
  projects: [
    {
      ...shared,
      displayName: "unit",
      testMatch: ["<rootDir>/unit/**/*.test.ts"],
    },
    {
      ...shared,
      displayName: "integration",
      testMatch: ["<rootDir>/integration/**/*.int.test.ts"],
      testTimeout: 30_000,
      maxWorkers: 2,
    },
  ],
};
