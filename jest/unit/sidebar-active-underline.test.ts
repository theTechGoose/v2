/**
 * REQ-359 (demo-loop cycle 1, demo issue p15-4) — the sidebar highlights the page you are on and
 * its links read like its folder buttons.
 *
 * 1. Every route's `<DashSidebar active="…">` names an id the sidebar can match: a NAV leaf
 *    (lib/nav-tree.ts) or one of the sidebar's own off-tree entries. /customers rendered
 *    `active="clients"` after the nav id was renamed to "customers", so no row was ever active.
 * 2. The sidebar's anchors (`.nav-item` rows, `.sb__textus` "My assistant") carry
 *    `text-decoration: none` in every stylesheet that styles them, so the UA underline never
 *    shows on links while the `<button>` folders stay plain.
 */
import * as fs from "fs";
import * as path from "path";
import { isFolder } from "../../front-end/lib/nav-folders";
import type { NavNode } from "../../front-end/lib/nav-folders";
import { NAV } from "../../front-end/lib/nav-tree";

const ROOT = path.resolve(__dirname, "../..");
const FE = path.join(ROOT, "front-end");

function leafIds(nodes: NavNode<string>[]): string[] {
  return nodes.flatMap((n) => isFolder(n) ? leafIds(n.items) : [n.id]);
}

// Entries DashSidebar renders outside the NAV tree, or pages that have no row to highlight:
//  - "admin": the super-admin tab (DashSidebar.tsx, `active === "admin"`)
//  - "messages": /assistant — its "My assistant" button is not a nav row
//  - "settings": /settings — reached from the identity block, no nav row (Roadmap p.4)
const OFF_TREE = new Set(["admin", "messages", "settings"]);

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe("REQ-359 sidebar: the active row matches, links are not underlined (demo p15-4)", () => {
  test("every route's DashSidebar `active` is a NAV leaf id or a known off-tree entry", () => {
    const valid = new Set([...leafIds(NAV as NavNode<string>[]), ...OFF_TREE]);
    const uses: { file: string; active: string }[] = [];
    for (const file of walk(path.join(FE, "routes"))) {
      const src = fs.readFileSync(file, "utf8");
      for (
        const m of src.matchAll(
          /<DashSidebar\b[^>]*\bactive=["{]\s*["']?([\w-]+)/g,
        )
      ) {
        uses.push({ file: path.relative(ROOT, file), active: m[1] });
      }
    }
    expect(uses.length).toBeGreaterThan(10); // the scan found the routes
    const bad = uses.filter((u) => !valid.has(u.active));
    expect(bad).toEqual([]);
  });

  test("/customers (and its /clients alias) highlights the Customers row", () => {
    const src = fs.readFileSync(
      path.join(FE, "routes/clients/index.tsx"),
      "utf8",
    );
    expect(src).toMatch(/<DashSidebar\s+active="customers"/);
    expect(leafIds(NAV as NavNode<string>[])).toContain("customers");
  });

  // Base rules for the sidebar's anchors — every stylesheet a sidebar page links.
  const SHEETS = ["static/dashboard.css", "static/assistant-page.css"];
  const SELECTORS = [".nav-item", ".sb__textus"];
  for (const sheet of SHEETS) {
    for (const sel of SELECTORS) {
      test(`${sheet}: every base \`${sel} { }\` rule sets text-decoration: none`, () => {
        const css = fs.readFileSync(path.join(FE, sheet), "utf8");
        const esc = sel.replace(/[.]/g, "\\.");
        const rules = [
          ...css.matchAll(
            new RegExp(`(?:^|\\n)\\s*${esc}\\s*\\{([^}]*)\\}`, "g"),
          ),
        ]
          .map((m) => m[1]);
        expect(rules.length).toBeGreaterThan(0);
        for (const body of rules) {
          expect(body).toMatch(/text-decoration:\s*none/);
        }
      });
    }
  }
});
