/**
 * REQ-624 — "When his daughter logs in she still sees Alexander's name." The signed-in person is
 * named everywhere a person is named (greeting, sidebar user block + initials, welcome toast,
 * AppNav, Settings "your name"); the business stays the owner's. The shared helper picks the
 * actor's name over the account's, and every surface reads through it.
 */
import * as fs from "fs";
import * as path from "path";
import { editableName, greetingFirstName, personName } from "../../shared/person-name/mod";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-624 personName — the actor over the account", () => {
  test("acting: the actor's name, never the owner's", () => {
    expect(personName({ name: "Alexander Jerez", actor: { name: "Daughter Test" } })).toBe("Daughter Test");
  });
  test("acting with a blank actor name: still not the owner's", () => {
    expect(personName({ name: "Alexander Jerez", actor: { name: "  " } })).toBeUndefined();
  });
  test("own session: the user's name", () => {
    expect(personName({ name: " Alexander Jerez " })).toBe("Alexander Jerez");
    expect(personName({ name: "Alexander Jerez", actor: null })).toBe("Alexander Jerez");
    expect(personName(undefined)).toBeUndefined();
  });
  test("the actor can ride separately (the /profile snapshot carries it next to the user)", () => {
    expect(personName({ name: "Alexander Jerez" }, { name: "Daughter Test", needsName: false })).toBe("Daughter Test");
  });
  test("editableName — Settings' name field: hers while acting, blank while she has none (never her phone)", () => {
    expect(editableName({ name: "Alexander Jerez" }, { name: "Daughter Test", needsName: false })).toBe("Daughter Test");
    expect(editableName({ name: "Alexander Jerez" }, { name: "(843) 555-0101", needsName: true })).toBe("");
    expect(editableName({ name: "Alexander Jerez" }, null)).toBe("Alexander Jerez");
    expect(editableName({}, undefined)).toBe("");
  });
  test("greetingFirstName — the first word; the sign-up placeholder is no name", () => {
    expect(greetingFirstName({ name: "Alexander Jerez", actor: { name: "Daughter Test" } })).toBe("Daughter");
    expect(greetingFirstName({ name: "Alexander Jerez" })).toBe("Alexander");
    expect(greetingFirstName({ name: "Nuevo usuario" })).toBeUndefined();
    expect(greetingFirstName({ name: "Alexander", actor: { name: "New user" } })).toBeUndefined();
    expect(greetingFirstName({ name: "Alexander", actor: { name: "(843) 555-0101", needsName: true } })).toBeUndefined();
  });
});

describe("REQ-624 every person-named surface reads through the helper", () => {
  const greetingRoutes = [
    "routes/dashboard/index.tsx",
    "routes/assistant/index.tsx",
    "routes/assistant/[threadId].tsx",
    "routes/work-orders/index.tsx",
    "routes/invoices/index.tsx",
    "routes/quotes/index.tsx",
    "routes/clients/index.tsx",
    "routes/payments/index.tsx",
    "routes/settings/index.tsx",
    "routes/admins/index.tsx",
    "routes/admin/index.tsx",
    "routes/accounts-manager/index.tsx",
    "routes/wo/[id].tsx",
    "routes/field/tasks.tsx",
    "routes/field/assignments.tsx",
    "routes/field/workers.tsx",
    "routes/field/batches.tsx",
    "routes/field/subscriptions.tsx",
  ];
  test.each(greetingRoutes)("%s greets the person (greetingFirstName), not user.name", (rel) => {
    const src = read(`front-end/${rel}`);
    expect(src).toMatch(/greetingFirstName\(/);
    expect(src).not.toMatch(/user\?\.name\?\.trim\(\)/);
  });

  test("the /me the SSR loads carries the actor", () => {
    expect(read("front-end/lib/auth.ts")).toMatch(/actor\?:\s*\{[^}]*name/);
  });

  test("the sidebar user block + initials name the person; the business line stays the business", () => {
    const src = read("front-end/islands/DashSidebar.tsx");
    expect(src).toMatch(/personName\(/);
    expect(src).not.toMatch(/profile\?\.user\.name/);
    expect(src).toMatch(/<ActorNamePrompt/);
  });

  test("a new person in the same tab never opens on the last one's cached name: sign-out, a switch and a sign-in drop the snapshot", () => {
    const sb = read("front-end/islands/DashSidebar.tsx");
    const logout = sb.slice(sb.indexOf("async function logout()"));
    expect(logout.slice(0, logout.indexOf("location.href"))).toMatch(/clearDashCache\(\)/);
    const sw = sb.slice(sb.indexOf("async function switchAccount("));
    expect(sw.slice(0, sw.indexOf("location.href"))).toMatch(/clearDashCache\(\)/);
    expect(read("front-end/lib/dash-cache.ts")).toMatch(/export function clearDashCache\(\)[\s\S]{0,200}removeItem\(STORAGE_KEY\)/);
    const verify = read("front-end/clients/verify.ts");
    expect(verify.match(/forgetPreviousSession\(\);/g)?.length).toBe(2);
    expect(verify).toContain('removeItem("pm:dash-cache:v1")');
    expect(read("front-end/lib/dash-cache.ts")).toContain('"pm:dash-cache:v1"');
  });

  test("the welcome toast and AppNav name the person", () => {
    expect(read("front-end/islands/WelcomeBackToast.tsx")).toMatch(/greetingFirstName\(/);
    const nav = read("front-end/components/AppNav.tsx");
    expect(nav).toMatch(/personName\(/);
    expect(nav).not.toMatch(/user\?\.name \?\?/);
  });

  test("Settings: the name field and the account card are hers while acting; the onboarding steps read the person", () => {
    const s = read("front-end/islands/SettingsPage.tsx");
    expect(s).toMatch(/useState\(\s*editableName\(/);
    expect(s).toMatch(/editableName\(snapshot\.user, snapshot\.actor\)/);
    expect(s).toMatch(/\[t\.name, personName\(/);
    expect(s).toMatch(/fmtPhone\(p\.actor\?\.phoneNumber \?\? p\.user\.phoneNumber\)/);
    expect(read("front-end/islands/SetupChecklist.tsx")).toMatch(/editableName\(snap\.user, snap\.actor\)/);
    expect(read("front-end/islands/OnboardingProgress.tsx")).toMatch(/editableName\(j\.user, j\.actor\)/);
  });

  test("the snapshot types carry the actor", () => {
    const client = read("front-end/clients/profile.ts");
    expect(client).toMatch(/interface ActorView[\s\S]{0,300}needsName/);
    expect(client).toMatch(/actor\?: ActorView/);
  });
});

describe("REQ-624 the name prompt and the invite form", () => {
  const prompt = read("front-end/components/ActorNamePrompt.tsx");
  test("asked once, only when she has no name, saved to her own record through PUT /me", () => {
    expect(prompt).toMatch(/needsName/);
    expect(prompt).toMatch(/profileClient\.updateUser\(\{ name/);
    expect(prompt).toMatch(/localStorage/);
    for (const cy of ["actor-name-prompt", "actor-name-input", "actor-name-save", "actor-name-later"]) {
      expect(prompt).toContain(`data-cy="${cy}"`);
    }
    expect(prompt).toMatch(/role="dialog"/);
  });
  test("one solid primary, a ghost 'not now' (the action-row rule)", () => {
    expect(prompt).not.toMatch(/gradient/);
    expect(prompt).toMatch(/background:transparent/);
  });
  test("the invite form encourages the name: no '(optional)', a label, a hint and a placeholder", () => {
    const page = read("front-end/islands/AdminsPage.tsx");
    expect(page).not.toContain("admins.nameOptional");
    for (const k of ["admins.nameLabel", "admins.nameHint", "admins.namePlaceholder"]) expect(page).toContain(`"${k}"`);
  });
  test("both languages carry every key, and the old one is gone", () => {
    const keys = [
      ...new Set([...prompt.matchAll(/"(actorName\.[a-zA-Z_.]+)"/g)].map((m) => m[1])),
      "admins.nameLabel",
      "admins.nameHint",
      "admins.namePlaceholder",
    ];
    expect(keys.length).toBeGreaterThan(6);
    for (const file of ["lang/en.json", "lang/es.json"]) {
      const dict = JSON.parse(read(file));
      for (const k of keys) {
        expect(typeof dict[k]).toBe("string");
        expect(dict[k].length).toBeGreaterThan(0);
      }
      expect(dict["admins.nameOptional"]).toBeUndefined();
    }
  });
});
