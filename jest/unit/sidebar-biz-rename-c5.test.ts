/**
 * REQ-737 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 5 (run r37f88707), issue p12 "Sidebar keeps old
 * business name after rename until navigation".
 *
 * RCA (analyst CONFIRMED, skeptic UPHELD at 2444608a): Settings saves the
 * business name through saveIdentity (PUT identity) and fired no event;
 * ProfileUpdatedDetail carried only `name`, and DashSidebar's REQ-423 listener
 * returned early when `name` was undefined — so the sidebar footer kept the
 * cached business name until the next page load. The fix: the event carries
 * `businessName`, Settings announces it after a saved rename, and the sidebar
 * patches its cached identity and refetches.
 */
import * as fs from "fs";
import * as path from "path";
import {
  sidebarIdentity,
  withSavedProfile,
} from "../../front-end/lib/greeting-identity";
import type { ProfileUpdatedDetail } from "../../front-end/lib/profile-events";

const ROOT = path.resolve(__dirname, "../..");
const t = (k: string) => (k === "common.account" ? "Account" : k);
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const profile = {
  user: { name: "Carl Jensen" },
  identity: { businessName: "Old Electric", displayName: null },
  initials: "CJ",
};

describe("REQ-737 (demo cycle 5, p12): the sidebar follows a business rename without a reload", () => {
  it("withSavedProfile applies a saved businessName to the cached identity", () => {
    const detail: ProfileUpdatedDetail = { businessName: "New Electric" };
    const out = withSavedProfile(profile, detail);
    expect(sidebarIdentity(out, t)?.biz).toBe("New Electric");
    expect(profile.identity.businessName).toBe("Old Electric"); // no mutation
  });

  it("an unnamed user's sidebar shows the new business as the display name, with its initials", () => {
    const unnamed = {
      user: { name: "Nuevo usuario" },
      identity: { businessName: "Old Electric" },
      initials: "OE",
    };
    const id = sidebarIdentity(
      withSavedProfile(unnamed, { businessName: "Bright Plumbing" }),
      t,
    );
    expect(id?.display).toBe("Bright Plumbing");
    expect(id?.initials).toBe("BP");
  });

  it("a name and a business name in one detail both land; an empty detail changes nothing", () => {
    const out = withSavedProfile(profile, {
      name: "Rafa",
      businessName: "Castro Co",
    });
    const id = sidebarIdentity(out, t);
    expect(id?.display).toBe("Rafa");
    expect(id?.biz).toBe("Castro Co");
    expect(withSavedProfile(profile, {})).toBe(profile);
  });

  it("Settings announces the business name after a successful identity save", () => {
    const src = read("front-end/islands/SettingsPage.tsx");
    const fn = src.match(
      /async function saveIdentity\([\s\S]*?\n  \}\n/,
    )?.[0] ?? "";
    expect(fn).toMatch(/announceProfile\(\s*\{\s*businessName/);
    // only after the PUT succeeded: the announce sits before the catch
    expect(fn.indexOf("announceProfile")).toBeGreaterThan(
      fn.indexOf("updateIdentity"),
    );
    expect(fn.indexOf("announceProfile")).toBeLessThan(fn.indexOf("catch"));
  });

  it("DashSidebar's profile listener no longer drops a detail without a name", () => {
    const src = read("front-end/islands/DashSidebar.tsx");
    expect(src).not.toMatch(/if \(name === undefined \|\| !alive\) return;/);
    expect(src).toMatch(/withSavedProfile\(/);
  });
});
