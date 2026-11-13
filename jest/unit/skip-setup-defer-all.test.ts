/**
 * REQ-504 — demo-loop cycle 3, issue M37: "Dashboard unreachable after 'Skip setup for now'".
 * The wizard's escape stamped only `onboardedAt`, so the dashboard's gate (REQ-091/227) kept
 * bouncing the account to /welcome and the sidebar's Dashboard link looped. The escape now asks
 * the server to defer every open deferrable question and lands on /dashboard, where the setup
 * checklist asks for the rest. The name cannot be deferred, so the escape shows only once the
 * name is answered.
 */
import * as fs from "fs";
import * as path from "path";
import {
  canSkipSetup,
  dashboardBlockers,
  type OnboardingAnswers,
  skipSetupDeferrals,
} from "../../shared/quote-flow/onboarding-questions";

const ROOT = path.resolve(__dirname, "../..");
const wizard = fs.readFileSync(
  path.join(ROOT, "front-end/islands/WelcomeWizard.tsx"),
  "utf8",
);

const NAMED: OnboardingAnswers = {
  user: { name: "Ana", email: "ana@roof.test" },
  identity: { businessName: "Ana Roofing" },
  address: null,
  insurance: null,
  plan: null,
};

describe("REQ-504 (demo M37, cycle 3) — Skip setup for now defers the open questions and opens the dashboard", () => {
  test("REQ-504 skipSetupDeferrals: every open deferrable question, never an answered one, never the name", () => {
    expect(skipSetupDeferrals(NAMED)).toEqual([
      "plan",
      "state",
      "address",
      "payment",
      "logo",
      "insurance",
    ]);
    const fresh: OnboardingAnswers = { user: { name: "New user" } };
    expect(skipSetupDeferrals(fresh)).not.toContain("name");
  });

  test("REQ-504 deferring those leaves no dashboard blocker once the name is answered", () => {
    const deferred = Object.fromEntries(
      skipSetupDeferrals(NAMED).map((q) => [q, "2026-11-12T00:00:00Z"]),
    );
    expect(
      dashboardBlockers({
        ...NAMED,
        user: { ...NAMED.user, onboardingDeferred: deferred },
      }),
    ).toEqual([]);
  });

  test("REQ-504 canSkipSetup: the escape is offered only once the name is answered", () => {
    expect(canSkipSetup({ user: { name: "New user" } })).toBe(false);
    expect(canSkipSetup({ user: { name: "" } })).toBe(false);
    expect(canSkipSetup(NAMED)).toBe(true);
  });

  test("REQ-504 + REQ-797 the wizard's escape posts deferAll and lands on /assistant (like finishing setup), shown only when canSkipSetup", () => {
    const body = wizard.slice(wizard.indexOf("async function skipSetup()"));
    const fn = body.slice(0, body.indexOf("\n  }\n"));
    expect(fn).toMatch(/skipped:\s*true,\s*deferAll:\s*true/);
    expect(fn).toMatch(/location\.href\s*=\s*"\/assistant"/);
    expect(fn).not.toMatch(/"\/dashboard"/);
    expect(wizard).toMatch(/canSkipSetup\(snap\)\s*&&/);
  });
});

describe("REQ-797 — after setup, people go to the assistant", () => {
  const progress = fs.readFileSync(
    path.join(ROOT, "front-end/islands/OnboardingProgress.tsx"),
    "utf8",
  );
  test("REQ-797 the assistant's setup bar's 'skip setup' lands on /assistant, never /dashboard", () => {
    const body = progress.slice(progress.indexOf("function skipSetup()"));
    const fn = body.slice(0, body.indexOf("\n  }\n"));
    expect(fn).toMatch(/location\.(assign\(|href\s*=\s*)"\/assistant"/);
    expect(fn).not.toMatch(/"\/dashboard"/);
  });
  test("REQ-797 finishing setup still lands on /assistant", () => {
    const body = wizard.slice(wizard.indexOf("async function finish()"));
    const fn = body.slice(0, body.indexOf("\n  }\n"));
    expect(fn).toMatch(/location\.href\s*=\s*"\/assistant"/);
  });
});
