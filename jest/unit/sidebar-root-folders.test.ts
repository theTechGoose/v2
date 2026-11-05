/**
 * REQ-176 — the sidebar's root: Dashboard, Customers, the Billing folder (Quotes, Invoices,
 * Payments) and the Admin folder (the Recurring folder, Admins); the tree is data in
 * front-end/lib/nav-tree.ts and the sidebar renders it.
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
  test("the root is Dashboard, Customers, Billing, Admin — nothing else", () => {
    expect(ids([])).toEqual(["home", "customers", "billing", "manage"]);
    expect(viewAt(NAV, []).items.filter(isFolder).map((n) => n.id)).toEqual([
      "billing",
      "manage",
    ]);
  });

  test("Billing holds Quotes, Invoices, Payments; Admin holds Recurring (the five) and Admins", () => {
    expect(ids(["billing"])).toEqual(["quotes", "invoices", "payments"]);
    expect(ids(["manage"])).toEqual(["recurring", "admins"]);
    expect(ids(["manage", "recurring"])).toEqual([
      "subscriptions",
      "assignments",
      "tasks",
      "batches",
      "workers",
    ]);
    expect(folderPathTo(NAV, "tasks")).toEqual(["manage", "recurring"]);
    expect(folderPathTo(NAV, "invoices")).toEqual(["billing"]);
    expect(folderPathTo(NAV, "admins")).toEqual(["manage"]);
    expect(folderPathTo(NAV, "customers")).toEqual([]);
  });

  test("the sidebar renders the tree module and keeps the super-admin tab inside Admin", () => {
    const src = read("front-end/islands/DashSidebar.tsx");
    expect(src).toMatch(/import \{ NAV \} from "\.\.\/lib\/nav-tree\.ts"/);
    expect(src).not.toMatch(/const NAV\b/);
    expect(src).toMatch(/view\.folder\?\.id === "manage"/);
    expect(src).toContain("Super admin");
  });

  test("both dictionaries carry the two folder names", () => {
    const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
    const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
    expect(en["nav.billing"]).toBe("Billing");
    expect(es["nav.billing"]).toBe("Facturación");
    expect(en["nav.manage"]).toBe("Admin");
    expect(es["nav.manage"]).toBe("Admin");
  });
});
