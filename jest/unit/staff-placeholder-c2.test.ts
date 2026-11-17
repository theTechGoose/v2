/**
 * REQ-423 — demo cycle 2, issues p3 + S3: a fresh, unnamed staff account read "Hola, hola 👋"
 * (and "Hey, hola 👋" after the EN switch) on /admin, the sidebar footer read "Nuevo usuario"
 * ("NU"), and the sidebar stayed stale after the name was saved.
 *
 *   - no route bakes the server-translated `common.thereFallback` in as the greeting NAME —
 *     a nameless user gets `dashTopbar.greetingNoName`, resolved in the LIVE language;
 *   - the sidebar identity treats the sign-in placeholder as no name (business name, else
 *     "Account"), never shows "NU" initials for it, and follows `pm:profile-updated`;
 *   - the dashboard checklist's "name" item follows the same event.
 */
import * as fs from "fs";
import * as path from "path";
import {
  sidebarIdentity,
  topbarGreeting,
  withSavedName,
} from "../../front-end/lib/greeting-identity";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const dicts: Record<"en" | "es", Record<string, string>> = {
  en: require("../../lang/en.json"),
  es: require("../../lang/es.json"),
};
const tIn =
  (lang: "en" | "es") => (key: string, vars?: Record<string, string>) =>
    Object.entries(vars ?? {}).reduce(
      (s, [k, v]) => s.replace(`{${k}}`, v),
      dicts[lang][key] ?? key,
    );

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

describe("REQ-423 a nameless user is greeted namelessly, in the live language", () => {
  test("REQ-423 no route passes common.thereFallback (or any translated word) as a greeting name", () => {
    const offenders = walk("front-end/routes").filter((f) =>
      /common\.thereFallback|greetingName\s*=[^;]*\?\?\s*tFor\(/.test(read(f))
    );
    expect(offenders).toEqual([]);
  });

  test("REQ-423 topbarGreeting: no name → greetingNoName in es, then en after the toggle (never 'hola')", () => {
    const es = topbarGreeting(tIn("es"), { greetingName: undefined });
    const en = topbarGreeting(tIn("en"), { greetingName: undefined });
    expect(es).toBe(dicts.es["dashTopbar.greetingNoName"]);
    expect(en).toBe(dicts.en["dashTopbar.greetingNoName"]);
    expect(es).not.toMatch(/hola,\s*hola/i);
    expect(en).not.toMatch(/hola/i);
  });

  test("REQ-423 topbarGreeting: a real name greets it; a saved name wins; a saved placeholder greets namelessly", () => {
    expect(topbarGreeting(tIn("en"), { greetingName: "Hans" })).toBe(
      tIn("en")("dashTopbar.greeting", { name: "Hans" }),
    );
    expect(
      topbarGreeting(tIn("en"), {
        greetingName: undefined,
        savedName: "Rafa Staff",
      }),
    ).toBe(tIn("en")("dashTopbar.greeting", { name: "Rafa" }));
    expect(
      topbarGreeting(tIn("es"), {
        greetingName: "Hans",
        savedName: "Nuevo usuario",
      }),
    ).toBe(dicts.es["dashTopbar.greetingNoName"]);
    expect(
      topbarGreeting(tIn("en"), {
        greetingName: undefined,
        greetingOverrideKey: "dashTopbar.greetingNoName",
      }),
    ).toBe(dicts.en["dashTopbar.greetingNoName"]);
  });

  test("REQ-423 DashTopbar renders through topbarGreeting and its name prop is optional", () => {
    const topbar = read("front-end/islands/DashTopbar.tsx");
    expect(topbar).toMatch(/topbarGreeting\(/);
    expect(topbar).toMatch(/greetingName\?:\s*string/);
  });
});

describe("REQ-423 the sidebar never shows the placeholder and follows a saved name", () => {
  const snap = (name: string, biz?: string, initials = "NU") => ({
    user: { name },
    identity: biz ? { businessName: biz } : null,
    initials,
  });

  test("REQ-423 a placeholder with a business shows the business, its initials (not 'NU')", () => {
    const id = sidebarIdentity(
      snap("Nuevo usuario", "Acme Roofing"),
      tIn("es"),
    );
    expect(id).toEqual({ display: "Acme Roofing", initials: "AR" });
  });

  test("REQ-423 a placeholder with no business shows 'Account' / 'Cuenta'", () => {
    for (const lang of ["en", "es"] as const) {
      const id = sidebarIdentity(
        snap(lang === "es" ? "Nuevo usuario" : "New user"),
        tIn(lang),
      );
      expect(id?.display).toBe(dicts[lang]["common.account"]);
      expect(id?.display).not.toMatch(/Nuevo|New user/);
      expect(id?.initials).not.toBe("NU");
    }
  });

  test("REQ-423 a real name shows the name, the business underneath, the server initials", () => {
    expect(sidebarIdentity(snap("Hans Weber", "Acme", "HW"), tIn("en")))
      .toEqual({
        display: "Hans Weber",
        biz: "Acme",
        initials: "HW",
      });
    expect(sidebarIdentity(null, tIn("en"))).toBeNull();
  });

  test("REQ-423 withSavedName patches the cached profile so the sidebar re-projects the new name", () => {
    const next = withSavedName(snap("Nuevo usuario"), "Rafa Staff");
    expect(sidebarIdentity(next, tIn("en"))).toEqual({
      display: "Rafa Staff",
      initials: "RS",
    });
  });

  test("REQ-423 DashSidebar projects through sidebarIdentity and listens for pm:profile-updated", () => {
    const sb = read("front-end/islands/DashSidebar.tsx");
    expect(sb).toMatch(/sidebarIdentity\(/);
    expect(sb).toMatch(/addEventListener\(\s*PROFILE_UPDATED/);
    expect(sb).toMatch(/refreshDash\(/);
  });

  test("REQ-423 the dashboard checklist follows pm:profile-updated", () => {
    expect(read("front-end/islands/SetupChecklist.tsx")).toMatch(
      /addEventListener\(\s*PROFILE_UPDATED/,
    );
  });
});
