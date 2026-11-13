/**
 * REQ-176 — the sidebar's tree, as data. The root is four rows: Dashboard, Customers, the
 * Billing folder (Quotes, Invoices, Payments — the quote IS the contract since the Quote+Agreement
 * merge, so there is no Contracts entry; /contracts 302s into /quotes), the REQ-156 Field folder
 * with the field entries (REQ-361: named "Field", not "Recurring" — it holds one-off tasks too),
 * and the Roles folder (Workers, Admins, and the super-admin tab). REQ-604 (demo m18): Workers is
 * one shared node listed in BOTH Field and Roles, and the super-admin tab also shows on the root. The sidebar (islands/DashSidebar.tsx)
 * renders one level at a time through lib/nav-folders.ts; `countKey` names a derived count from
 * /analytics/dashboard for the badge. Counts are never seeded client-side — a failed fetch or a 0
 * omits the badge. Icon names are the sidebar's (lib/dash-icons.tsx).
 */
import type { IconName } from "./dash-icons.tsx";
import type { NavNode } from "./nav-folders.ts";

// REQ-178: the crew is managed from Roles; REQ-604 (demo m18): customers looked for it under Field,
// so the same node is listed there too. Field comes first in the tree, so /field/workers opens
// inside Field (folderPathTo takes the first match), where its URL says it lives.
// REQ-361: its "No zone yet" hint links across to Assignments.
const WORKERS: NavNode<IconName> = {
  id: "workers",
  icon: "hardhat",
  href: "/field/workers",
};

export const NAV: NavNode<IconName>[] = [
  { id: "home", icon: "home", href: "/dashboard" },
  // P-46: one EN term — the nav, URL, and page all say "customers"
  // (/clients stays live as an alias route). REQ-518: no countKey — a customers total is not
  // work waiting, so it never gets the pink pill.
  { id: "customers", icon: "user", href: "/customers" },
  {
    id: "billing",
    icon: "pay",
    items: [
      { id: "quotes", icon: "quote", href: "/quotes", countKey: "quotes" },
      {
        id: "invoices",
        icon: "invoice",
        href: "/invoices",
        countKey: "invoices",
      },
      { id: "payments", icon: "pay", href: "/payments" },
      // REQ-210 (A2Z): the numbered WO- documents, next to the quotes and
      // invoices they belong to.
      { id: "workOrders", icon: "wrench", href: "/work-orders" },
    ],
  },
  // REQ-143: the field module — recurring maintenance on the existing customers,
  // billed through the existing invoices; REQ-156: one folder, its five behind Back;
  // REQ-176 amendment: on the root, not nested. REQ-361 (demo M36): the folder is "Field" —
  // subscriptions AND one-off tasks (REQ-164) live here, so "Recurring" sent people elsewhere.
  {
    id: "field",
    icon: "map",
    items: [
      { id: "subscriptions", icon: "repeat", href: "/field/subscriptions" },
      { id: "assignments", icon: "map", href: "/field/assignments" },
      { id: "tasks", icon: "cal", href: "/field/tasks" },
      { id: "batches", icon: "batch", href: "/field/batches" },
      WORKERS,
    ],
  },
  {
    id: "manage",
    icon: "cog",
    items: [
      WORKERS,
      // REQ-192 — the timeclock: the week's hours, punch fixes
      { id: "timesheet", icon: "clock", href: "/field/timesheet" },
      // REQ-146: the numbers the owner lets into the account
      { id: "admins", icon: "shield", href: "/admins" },
    ],
  },
];

/**
 * REQ-604 (demo m18) — where the super-admin Admin tab (not a NAV node) renders: on the sidebar
 * root, so staff reach /admin without opening a folder, and still inside Roles (REQ-176).
 */
export function superAdminTabAt(
  superAdmin: boolean,
  folderId: string | null,
): boolean {
  return superAdmin && (folderId === null || folderId === "manage");
}
