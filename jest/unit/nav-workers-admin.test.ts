/**
 * REQ-604 (demo-loop cycle 4, issue m18) — Workers and the super-admin Admin tab were hard to find:
 * Workers sat only in the Roles folder (customers looked under Field), and the Admin tab rendered
 * only inside Roles. Workers is now one shared nav node listed in BOTH Field and Roles, and the
 * super-admin Admin tab shows on the sidebar root (and still inside Roles).
 */
import { folderPathTo, viewAt } from "../../front-end/lib/nav-folders";
import { NAV, superAdminTabAt } from "../../front-end/lib/nav-tree";

const ids = (p: string[]) => viewAt(NAV, p).items.map((n) => n.id);

describe("REQ-604 (demo m18) Workers under Field, Admin on the root", () => {
  test("Field lists Workers, and Roles still does — the same node (one href, one icon)", () => {
    expect(ids(["field"])).toContain("workers");
    expect(ids(["manage"])).toContain("workers");
    const inField = viewAt(NAV, ["field"]).items.find((n) =>
      n.id === "workers"
    );
    const inRoles = viewAt(NAV, ["manage"]).items.find((n) =>
      n.id === "workers"
    );
    expect(inField).toBe(inRoles);
    expect(inField).toMatchObject({ href: "/field/workers" });
  });

  test("/field/workers opens the sidebar inside Field, where its URL says it lives", () => {
    expect(folderPathTo(NAV, "workers")).toEqual(["field"]);
  });

  test("the super-admin Admin tab shows on the root and in Roles, for super-admins only", () => {
    expect(superAdminTabAt(true, null)).toBe(true);
    expect(superAdminTabAt(true, "manage")).toBe(true);
    expect(superAdminTabAt(true, "billing")).toBe(false);
    expect(superAdminTabAt(true, "field")).toBe(false);
    expect(superAdminTabAt(false, null)).toBe(false);
    expect(superAdminTabAt(false, "manage")).toBe(false);
  });
});
