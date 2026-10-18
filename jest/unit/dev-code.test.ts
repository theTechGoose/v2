/**
 * REQ-082 — Raphael, 2026-10-16: "for the fake you should have a pop up with the code."
 *
 * Every surface that sends a code takes part: /landing2's card shows the popup on its own code
 * step; "/" (landing-scripts.js), /landing (TrialSignup) and /login (LoginForm) hand the code to
 * /verify through the one stash (lib/dev-code.ts), where CodeInput shows it and the resend
 * refreshes it. The popup is one component, its copy in both dictionaries.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const en: Record<string, string> = require("../../lang/en.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const es: Record<string, string> = require("../../lang/es.json");

describe("REQ-082 the dev code pops up on every page that sends a code", () => {
  test("the backend's send-otp reply carries the code through devCodeFor, and the clients type it", () => {
    expect(exists("backend/src/users/domain/business/dev-code/mod.ts")).toBe(true);
    const ctrl = read("backend/src/users/entrypoints/auth-controller/mod.ts");
    expect(ctrl).toMatch(/devCodeFor\(/);
    expect(read("front-end/clients/landing.ts")).toMatch(/devCode\?: string/);
    expect(read("front-end/clients/verify.ts")).toMatch(/devCode\?: string/);
  });

  test("the popup is one component with its copy in both languages", () => {
    expect(exists("front-end/components/DevCodeCard.tsx")).toBe(true);
    const card = read("front-end/components/DevCodeCard.tsx");
    expect(card).toMatch(/data-cy="dev-code"/);
    expect(card).toMatch(/data-cy="dev-code-value"/);
    expect(card).toMatch(/data-cy="dev-code-use"/);
    for (const k of ["devCode.title", "devCode.body", "devCode.use", "devCode.close"]) {
      expect(card).toContain(`"${k}"`);
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
      expect(en[k]).not.toEqual(es[k]);
    }
  });

  test("/landing2 shows the popup on its own code step", () => {
    const island = read("front-end/islands/Landing2Signup.tsx");
    expect(island).toMatch(/DevCodeCard/);
    expect(island).toMatch(/devCode/);
  });

  test("the pages that hand off to /verify stash the code, and /verify shows it and refreshes it on resend", () => {
    expect(exists("front-end/lib/dev-code.ts")).toBe(true);
    const lib = read("front-end/lib/dev-code.ts");
    expect(lib).toMatch(/export function stashDevCode/);
    expect(lib).toMatch(/export function takeDevCode/);
    expect(lib).toMatch(/"pm:dev-code"/);
    expect(read("front-end/islands/TrialSignup.tsx")).toMatch(/stashDevCode\(/);
    expect(read("front-end/islands/LoginForm.tsx")).toMatch(/stashDevCode\(/);
    // the home page's form is a static script: it writes the same key the lib reads
    expect(read("front-end/static/landing-scripts.js")).toMatch(/"pm:dev-code"/);
    const code = read("front-end/islands/CodeInput.tsx");
    expect(code).toMatch(/takeDevCode\(/);
    expect(code).toMatch(/DevCodeCard/);
    expect(code).toMatch(/resendOtp[\s\S]*devCode/);
  });
});
