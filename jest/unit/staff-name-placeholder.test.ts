/**
 * REQ-355 — demo cycle 1, issues m1 + setup-m8: the staff account showed as "Nuevo usuario"
 * ("/admin Hey, Nuevo 👋", "Nuevo usuario is guiding you"), the app never asked a staff member
 * for a name, and the topbar greeting stayed stale after a rename in Settings.
 *
 * The seeded sign-in placeholder is "no name" everywhere it would be displayed:
 *   - every route's topbar greeting name goes through `greetingFirstName` (placeholder → none);
 *   - the topbar re-greets live on `pm:profile-updated`, which Settings' name save announces;
 *   - a super admin still on the placeholder is asked "What's your name?" on /dashboard and
 *     /admin (the customer wizard never asks staff — REQ-227).
 */
import * as fs from "fs";
import * as path from "path";
import { greetingFirstName } from "../../shared/quote-flow/outbound-identity";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const en: Record<string, string> = require("../../lang/en.json");
const es: Record<string, string> = require("../../lang/es.json");

function walk(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? walk(path.join(dir, e.name))
        : /\.tsx?$/.test(e.name)
        ? [path.join(dir, e.name)]
        : []
    );
}

describe("REQ-355 the sign-in placeholder is never shown as a name", () => {
  test("REQ-355 greetingFirstName: placeholder or empty → none; a real name → its first word", () => {
    expect(greetingFirstName("Nuevo usuario")).toBeUndefined();
    expect(greetingFirstName("New user")).toBeUndefined();
    expect(greetingFirstName("  ")).toBeUndefined();
    expect(greetingFirstName(undefined)).toBeUndefined();
    expect(greetingFirstName("  Hans Weber ")).toBe("Hans");
  });

  test("REQ-355 no route greets with the raw user name (it must pass greetingFirstName)", () => {
    const offenders = walk("front-end/routes").filter((f) =>
      /greetingName\s*=[\s\S]{0,40}user\??\.name\??\.trim\(\)/.test(read(f))
    );
    expect(offenders).toEqual([]);
  });

  test("REQ-355 /admin's greeting goes through greetingFirstName", () => {
    expect(read("front-end/routes/admin/index.tsx")).toMatch(
      /greetingName\s*=\s*greetingFirstName\(user\?\.name\)/,
    );
  });
});

describe("REQ-355 the topbar greeting follows a rename without a reload", () => {
  test("REQ-355 Settings announces a saved name on pm:profile-updated", () => {
    const settings = read("front-end/islands/SettingsPage.tsx");
    const save = settings.slice(settings.indexOf("async function saveUser("));
    expect(save.slice(0, 600)).toMatch(/announceProfile\(/);
    expect(read("front-end/lib/profile-events.ts")).toMatch(
      /"pm:profile-updated"/,
    );
  });

  test("REQ-355 DashTopbar listens for pm:profile-updated and re-greets through greetingFirstName", () => {
    const topbar = read("front-end/islands/DashTopbar.tsx");
    expect(topbar).toMatch(/PROFILE_UPDATED/);
    expect(topbar).toMatch(/addEventListener\(\s*PROFILE_UPDATED/);
    expect(topbar).toMatch(/greetingFirstName\(/);
  });
});

describe("REQ-355 a staff member still on the placeholder is asked for a name", () => {
  test.each([
    "front-end/routes/admin/index.tsx",
    "front-end/routes/dashboard/index.tsx",
  ])(
    "REQ-355 %s mounts StaffNamePrompt for a super admin without a real name",
    (route) => {
      const src = read(route);
      expect(src).toMatch(/<StaffNamePrompt/);
      expect(src).toMatch(/superAdmin === true && isPlaceholderName\(user/);
    },
  );

  test("REQ-355 the prompt saves the name and announces it", () => {
    const island = read("front-end/islands/StaffNamePrompt.tsx");
    expect(island).toMatch(/profileClient\.updateUser\(\{\s*name/);
    expect(island).toMatch(/announceProfile\(/);
  });

  test("REQ-355 the prompt's copy exists in en and es", () => {
    for (
      const k of [
        "staffNamePrompt.title",
        "staffNamePrompt.lead",
        "staffNamePrompt.label",
        "staffNamePrompt.save",
        "staffNamePrompt.later",
        "staffNamePrompt.error",
      ]
    ) {
      expect(en[k]).toBeTruthy();
      expect(es[k]).toBeTruthy();
    }
  });
});
