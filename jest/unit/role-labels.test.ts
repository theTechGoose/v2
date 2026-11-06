/**
 * REQ-191 — role names a person reads: the super admin is "Admin", an account's invited admin is
 * an "editor" (EN) / "editor" (ES). Internal names (superAdmin, /admin, admins.* keys) are unchanged.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const dict = (rel: string) => JSON.parse(read(rel)) as Record<string, string>;
const ADMINS_KEYS = (d: Record<string, string>) =>
  Object.keys(d).filter((k) => k.startsWith("admins.")).concat(
    "sms.adminInvite",
  );

describe("REQ-191 role labels", () => {
  test("the sidebar's /admin tab reads Admin, not Super admin", () => {
    const src = read("front-end/islands/DashSidebar.tsx");
    expect(src).not.toContain("Super admin");
    expect(src).toMatch(/<span class="nav-item__label">Admin<\/span>/);
  });

  test("the /admin page says admin, not super-admin, and its column is Admin, not Super", () => {
    const src = read("front-end/islands/AdminPage.tsx");
    expect(src).toContain("grant or revoke admin,");
    // no string a person reads says super (code comments and the superAdmin flag are internal)
    expect(src).not.toMatch(/"[^"\n]*super[^"\n]*"/i);
    expect(src).not.toMatch(/>[^<{\n]*super[^<{\n]*</i);
    expect(src).not.toMatch(/>Super<\/th>/);
    expect(src).toMatch(/<th style="padding:8px 10px">Admin<\/th>/);
  });

  test("English: the Editors page and the invite SMS say editor, never admin", () => {
    const en = dict("lang/en.json");
    for (const k of ADMINS_KEYS(en)) {
      expect({ k, v: en[k] }).not.toMatchObject({
        v: expect.stringMatching(/\badmins?\b/i),
      });
    }
    expect(en["admins.docTitle"]).toBe("Editors · DocuMonster");
    expect(en["admins.new"]).toBe("Invite an editor");
    expect(en["admins.title"]).toContain("<em>editors</em>");
    expect(en["sms.adminInvite"]).toContain("as an editor");
  });

  test("Spanish: the Editors page and the invite SMS say editor/editores, never administrador", () => {
    const es = dict("lang/es.json");
    for (const k of ADMINS_KEYS(es)) {
      expect({ k, v: es[k] }).not.toMatchObject({
        v: expect.stringMatching(/administrador/i),
      });
    }
    expect(es["admins.docTitle"]).toBe("Editores · DocuMonster");
    expect(es["admins.new"]).toBe("Invitar a un editor");
    expect(es["admins.title"]).toContain("<em>editores</em>");
    expect(es["sms.adminInvite"]).toContain("como editor");
  });
});
