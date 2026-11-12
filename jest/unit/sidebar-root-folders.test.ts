/**
 * REQ-176 — the sidebar's root: Dashboard, Customers, the Billing folder (Quotes, Invoices,
 * Payments), the Field folder (REQ-361, was Recurring) and the Admin folder (Workers, Admins);
 * the tree is data in front-end/lib/nav-tree.ts and the sidebar renders it.
 */
import * as fs from "fs";
import * as path from "path";
import {
  folderPathTo,
  isFolder,
  viewAt,
} from "../../front-end/lib/nav-folders";
import { NAV } from "../../front-end/lib/nav-tree";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const ids = (p: string[]) => viewAt(NAV, p).items.map((n) => n.id);

describe("REQ-176 the sidebar's root folders", () => {
  test("the root is Dashboard, Customers, Billing, Field, Admin — nothing else (REQ-176 amendment: the field folder is not nested; REQ-361: Field, was Recurring)", () => {
    expect(ids([])).toEqual([
      "home",
      "customers",
      "billing",
      "field",
      "manage",
    ]);
    expect(viewAt(NAV, []).items.filter(isFolder).map((n) => n.id)).toEqual([
      "billing",
      "field",
      "manage",
    ]);
  });

  test("Billing holds Quotes, Invoices, Payments, Work orders; Field the four (REQ-361); Admin holds Workers and Admins (REQ-178)", () => {
    // REQ-210: Work orders joined Billing next to the documents they belong to
    expect(ids(["billing"])).toEqual(["quotes", "invoices", "payments", "workOrders"]);
    expect(ids(["manage"])).toEqual(["workers", "admins"]); // REQ-178 — Workers is Admin's
    expect(ids(["field"])).toEqual([
      "subscriptions",
      "assignments",
      "tasks",
      "batches",
    ]);
    expect(folderPathTo(NAV, "workers")).toEqual(["manage"]);
    expect(folderPathTo(NAV, "tasks")).toEqual(["field"]);
    expect(folderPathTo(NAV, "invoices")).toEqual(["billing"]);
    expect(folderPathTo(NAV, "admins")).toEqual(["manage"]);
    expect(folderPathTo(NAV, "customers")).toEqual([]);
  });

  test("the sidebar renders the tree module and keeps the super-admin tab inside the Roles folder — labelled Admin (REQ-191)", () => {
    const src = read("front-end/islands/DashSidebar.tsx");
    expect(src).toMatch(/import \{ NAV \} from "\.\.\/lib\/nav-tree\.ts"/);
    expect(src).not.toMatch(/const NAV\b/);
    expect(src).toMatch(/view\.folder\?\.id === "manage"/);
    expect(src).toMatch(/<span class="nav-item__label">Admin<\/span>/); // REQ-191
    expect(src).not.toContain("Super admin");
  });

  test("both dictionaries carry the two folder names", () => {
    const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
    const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
    expect(en["nav.billing"]).toBe("Billing");
    expect(es["nav.billing"]).toBe("Facturación");
    // REQ-190 — the folder is Roles, its people are Workers and Editors
    expect(en["nav.manage"]).toBe("Roles");
    expect(en["nav.admins"]).toBe("Editors");
    expect(es["nav.manage"]).toBe("Roles");
    expect(es["nav.admins"]).toBe("Editores");
  });
});
