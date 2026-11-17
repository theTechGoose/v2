/**
 * REQ-518 (demo-loop cycle 3, demo issue p8-pair6-c) — the sidebar's pink count pill is for work
 * waiting on someone, never a running total, and it says what it counts.
 *
 * RCA: DashSidebar.pickCounts mapped `clients: stats.customers` (every customer the account has)
 * onto the pink `.nav-item__count` pill, with no title or aria-label — one customer showed a red
 * "1" on Customers that read as an unread alert.
 */
import * as fs from "fs";
import * as path from "path";
import {
  countLabelKey,
  pickSidebarCounts,
} from "../../front-end/lib/sidebar-counts";
import type { NavNode } from "../../front-end/lib/nav-folders";
import { isFolder } from "../../front-end/lib/nav-folders";
import { NAV } from "../../front-end/lib/nav-tree";

const ROOT = path.resolve(__dirname, "../..");
const FE = path.join(ROOT, "front-end");
const en = JSON.parse(fs.readFileSync(path.join(ROOT, "lang/en.json"), "utf8"));
const es = JSON.parse(fs.readFileSync(path.join(ROOT, "lang/es.json"), "utf8"));

// deno-lint-ignore no-explicit-any
const stats = (over: Record<string, any> = {}): any => ({
  customers: 1,
  quotes: { sent: 0 },
  invoices: { pending: 0 },
  ...over,
});

function leaves(nodes: NavNode<string>[]): NavNode<string>[] {
  return nodes.flatMap((n) => isFolder(n) ? leaves(n.items) : [n]);
}

describe("REQ-518 sidebar count pill: actionable counts only, labelled (demo p8-pair6-c, cycle 3)", () => {
  test("one customer and nothing pending → no count at all (the demo's red '1')", () => {
    expect(pickSidebarCounts(stats({ customers: 1 }))).toEqual({});
  });

  test("the customers total never becomes a count, however many there are", () => {
    const c = pickSidebarCounts(stats({ customers: 42 }));
    expect(c).not.toHaveProperty("clients");
    expect(c).not.toHaveProperty("customers");
  });

  test("quotes awaiting a reply and unpaid invoices still count", () => {
    expect(
      pickSidebarCounts(
        stats({ quotes: { sent: 2 }, invoices: { pending: 3 } }),
      ),
    )
      .toEqual({ quotes: 2, invoices: 3 });
  });

  test("the Customers nav row carries no countKey", () => {
    const customers = leaves(NAV).find((n) => n.id === "customers");
    expect(customers).toBeDefined();
    expect(customers?.countKey).toBeUndefined();
  });

  test("every countKey in the nav tree has a label in en and es", () => {
    for (const n of leaves(NAV)) {
      if (!n.countKey) continue;
      const key = countLabelKey(n.countKey);
      expect(typeof en[key]).toBe("string");
      expect(typeof es[key]).toBe("string");
      expect(en[key]).toContain("{count}");
      expect(es[key]).toContain("{count}");
    }
  });

  test("the island renders the pill through pickSidebarCounts with a title and aria-label", () => {
    const src = fs.readFileSync(
      path.join(FE, "islands/DashSidebar.tsx"),
      "utf8",
    );
    expect(src).toContain("pickSidebarCounts(stats)");
    expect(src).not.toMatch(/clients:\s*stats\.customers/);
    expect(src).toMatch(
      /countLabel\s*=[^;]*tFor\(lang, countLabelKey\(item\.countKey\), \{ count \}\)/,
    );
    const at = src.indexOf('class="nav-item__count"');
    const pill = src.slice(at, src.indexOf(">", at));
    expect(pill).toContain("title={countLabel}");
    expect(pill).toContain("aria-label={countLabel}");
  });
});
