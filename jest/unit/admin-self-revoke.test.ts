/**
 * REQ-731 — "fix every issue the demo found, loop until there are none." Demo-loop cycle 5,
 * issue m30 ("Owner can revoke their own admin"). The /admin users table rendered Grant/Revoke
 * on every row, including the signed-in admin's own (REQ-227 hid only Impersonate and Demo
 * there). The own row's Revoke is now disabled with a tooltip saying why; other rows unchanged.
 */
import * as fs from "fs";
import * as path from "path";
import { canToggleSuper } from "../../front-end/lib/admin-console";

const ROOT = path.resolve(__dirname, "../..");

describe("REQ-731 (demo cycle 5, m30): no Revoke on your own /admin row", () => {
  it("your own admin row cannot be revoked", () => {
    expect(canToggleSuper({ id: "me", superAdmin: true }, "me")).toBe(false);
  });

  it("other rows still grant and revoke", () => {
    expect(canToggleSuper({ id: "u2", superAdmin: true }, "me")).toBe(true);
    expect(canToggleSuper({ id: "u2", superAdmin: false }, "me")).toBe(true);
    expect(canToggleSuper({ id: "u2", superAdmin: true }, undefined)).toBe(
      true,
    );
  });

  it("AdminPage disables the toggle on the self row and explains why (en + es)", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "front-end/islands/AdminPage.tsx"),
      "utf8",
    );
    expect(src).toMatch(/canToggleSuper\(u, selfId\)/);
    expect(src).toContain('t("adminPage.revoke.selfTitle")');
    for (const lang of ["en", "es"]) {
      const dict = JSON.parse(
        fs.readFileSync(path.join(ROOT, `lang/${lang}.json`), "utf8"),
      );
      expect(typeof dict["adminPage.revoke.selfTitle"]).toBe("string");
      expect(dict["adminPage.revoke.selfTitle"].length).toBeGreaterThan(0);
    }
  });
});
