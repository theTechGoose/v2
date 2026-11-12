/**
 * REQ-632 — the editor's name is required on invite, in the UI (AdminsPage: a required field, an
 * inline error, the Invite button disabled until it is filled, both languages) and in the API
 * (400 `name_required`, one shared rule). The ActorNamePrompt (REQ-624) stays for legacy invites.
 */
import * as fs from "fs";
import * as path from "path";
import { inviteName } from "../../shared/person-name/mod";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-632 inviteName — the one rule the form and the API share", () => {
  test("a real name, trimmed", () => {
    expect(inviteName("  Sofia Jerez ")).toBe("Sofia Jerez");
    expect(inviteName("x".repeat(130))).toHaveLength(120);
  });
  test.each([undefined, null, 3, "", "   ", "\t", "New user", "Nuevo usuario"])("refused: %p", (v) => {
    expect(inviteName(v)).toBeNull();
  });
  test("the backend's invite uses the shared rule and answers name_required", () => {
    const biz = read("backend/src/users/domain/business/account-admins/mod.ts");
    expect(biz).toMatch(/export \{ inviteName, personLanguage \} from "#person-name\/mod\.ts"/);
    const coord = read("backend/src/users/domain/coordinators/account-admins/mod.ts");
    expect(coord).toMatch(/inviteName\(input\.name\)/);
    expect(coord).toMatch(/AccountAdminError\("name_required", 400\)/);
  });
});

describe("REQ-632 the invite form requires the name", () => {
  const page = read("front-end/islands/AdminsPage.tsx");
  const nameInput = page.slice(page.indexOf('data-cy="adm-name"') - 400, page.indexOf('data-cy="adm-name"') + 900);
  test("the name input is required and flags itself invalid", () => {
    expect(nameInput).toMatch(/\brequired\b/);
    expect(nameInput).toMatch(/aria-invalid=/);
    expect(nameInput).toMatch(/aria-describedby=/);
  });
  test("the Invite button is disabled until the phone AND a valid name are in", () => {
    expect(page).toMatch(/const nameOk = inviteName\(form\.name\) !== null;/);
    expect(page).toMatch(/const canInvite = phoneOk && nameOk && !inviting;/);
    expect(page).toMatch(/disabled=\{!canInvite\}/);
  });
  test("an inline error under the field once it was left empty; the request carries the name", () => {
    expect(page).toMatch(/data-cy="adm-name-error"/);
    expect(page).toMatch(/t\("admins\.err\.name_required"\)/);
    expect(page).toMatch(/name: inviteName\(form\.name\)!/);
  });
  test("the hint no longer says the name can be left blank, and the label marks it required", () => {
    for (const file of ["lang/en.json", "lang/es.json"]) {
      const dict = JSON.parse(read(file));
      expect(dict["admins.nameHint"]).not.toMatch(/blank|vac[ií]o/i);
    }
    expect(page).toMatch(/data-cy="adm-name-required"/);
  });
  test("both languages carry the new error and the required mark", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    for (const k of ["admins.err.name_required", "admins.nameRequired"]) {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
      expect(en[k]).not.toBe(es[k]);
    }
  });
  test("the legacy fallback stays: the sidebar still mounts the name prompt", () => {
    expect(read("front-end/islands/DashSidebar.tsx")).toMatch(/<ActorNamePrompt/);
  });
});
