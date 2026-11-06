/**
 * REQ-176 — the sidebar's tree, as data. The root is four rows: Dashboard, Customers, the
 * Billing folder (Quotes, Invoices, Payments — the quote IS the contract since the Quote+Agreement
 * merge, so there is no Contracts entry; /contracts 302s into /quotes), the REQ-156 Recurring folder
 * with the field entries, and the Admin folder (Admins, and the super-admin tab). The sidebar (islands/DashSidebar.tsx)
 * renders one level at a time through lib/nav-folders.ts; `countKey` names a derived count from
 * /analytics/dashboard for the badge. Counts are never seeded client-side — a failed fetch or a 0
 * omits the badge. Icon names are the sidebar's (lib/dash-icons.tsx).
 */
import type { IconName } from "./dash-icons.tsx";
import type { NavNode } from "./nav-folders.ts";

export const NAV: NavNode<IconName>[] = [
  { id: "home", icon: "home", href: "/dashboard" },
  // P-46: one EN term — the nav, URL, and page all say "customers"
  // (/clients stays live as an alias route; countKey is the store name).
  { id: "customers", icon: "user", href: "/customers", countKey: "clients" },
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
  // REQ-176 amendment: on the root, not nested.
  {
    id: "recurring",
    icon: "repeat",
    items: [
      { id: "subscriptions", icon: "repeat", href: "/field/subscriptions" },
      { id: "assignments", icon: "map", href: "/field/assignments" },
      { id: "tasks", icon: "cal", href: "/field/tasks" },
      { id: "batches", icon: "batch", href: "/field/batches" },
    ],
  },
  {
    id: "manage",
    icon: "cog",
    items: [
      // REQ-178 — the crew is managed from Admin, not Recurring
      { id: "workers", icon: "hardhat", href: "/field/workers" },
      // REQ-146: the numbers the owner lets into the account
      { id: "admins", icon: "shield", href: "/admins" },
    ],
  },
];
