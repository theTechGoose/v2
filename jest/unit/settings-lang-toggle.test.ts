/**
 * REQ-254 — demo issue onboarding-dashboard-settings-m2: "/settings half translated after EN/ES
 * toggle until reload". The topbar EN/ES toggle flips `langSignal`; every part of /settings must
 * take its language from that one signal, never from the profile copy the island fetched at mount
 * (`p.user.language` / `snapshot.user.language`), which the toggle never updates.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const page = fs.readFileSync(
  path.join(ROOT, "front-end/islands/SettingsPage.tsx"),
  "utf8",
);

/** The body of a top-level function, from its declaration to the next top-level declaration. */
function body(decl: string): string {
  const start = page.indexOf(decl);
  if (start < 0) throw new Error(`${decl} not found`);
  const rest = page.slice(start + decl.length);
  const end = rest.search(
    /\n(?:export )?(?:default )?(?:function|const|type|interface) /,
  );
  return end < 0 ? rest : rest.slice(0, end);
}

describe("REQ-254 /settings follows the EN/ES toggle without a reload", () => {
  test("REQ-254 the page root (hero, tabs, Account and Business cards) reads langSignal, not the fetched profile", () => {
    const root = body("export default function SettingsPage(");
    expect(root).toMatch(/langSignal\.value/);
    expect(root).not.toMatch(/p\.user\.language/);
  });

  test("REQ-254 the Billing tab reads langSignal, not the snapshot's language", () => {
    const billing = body("function BillingTab(");
    expect(billing).toMatch(/langSignal\.value/);
    expect(billing).not.toMatch(/snapshot\.user\.language/);
  });

  test("REQ-254 no part of the island takes its UI language from the fetched profile", () => {
    expect(page).not.toMatch(
      /(?:p|snapshot|profile)\.user\.language\s*===\s*"es"/,
    );
  });
});
