/**
 * REQ-156 — sidebar folders: the pure tree walk (the path to an entry, the view at a path) and
 * the wiring — the five field entries sit in the `recurring` folder, the sidebar renders the
 * Back row, and both dictionaries carry the two strings.
 */
import * as fs from "fs";
import * as path from "path";
import {
  folderPathTo,
  type NavNode,
  viewAt,
} from "../../front-end/lib/nav-folders";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const tree: NavNode[] = [
  { id: "home", icon: "home", href: "/dashboard" },
  {
    id: "recurring",
    icon: "repeat",
    items: [
      { id: "tasks", icon: "cal", href: "/field/tasks" },
      {
        id: "deep",
        icon: "map",
        items: [{ id: "inner", icon: "cal", href: "/x" }],
      },
    ],
  },
  { id: "admins", icon: "shield", href: "/admins" },
];

describe("REQ-156 the tree walk", () => {
  test("the path to an entry runs through its folders; a top-level or unknown entry is the root", () => {
    expect(folderPathTo(tree, "tasks")).toEqual(["recurring"]);
    expect(folderPathTo(tree, "inner")).toEqual(["recurring", "deep"]);
    expect(folderPathTo(tree, "home")).toEqual([]);
    expect(folderPathTo(tree, "nope")).toEqual([]);
    expect(folderPathTo(tree, undefined)).toEqual([]);
  });

  test("the view at the root, inside a folder, and for a path that does not exist", () => {
    const root = viewAt(tree, []);
    expect(root.folder).toBeNull();
    expect(root.items.map((n) => n.id)).toEqual([
      "home",
      "recurring",
      "admins",
    ]);
    expect(root.parentPath).toBeNull();
    const inside = viewAt(tree, ["recurring"]);
    expect(inside.folder?.id).toBe("recurring");
    expect(inside.items.map((n) => n.id)).toEqual(["tasks", "deep"]);
    expect(inside.parentPath).toEqual([]);
    const deep = viewAt(tree, ["recurring", "deep"]);
    expect(deep.items.map((n) => n.id)).toEqual(["inner"]);
    expect(deep.parentPath).toEqual(["recurring"]);
    expect(viewAt(tree, ["nope"]).folder).toBeNull();
    expect(viewAt(tree, ["recurring", "tasks"]).folder).toBeNull();
  });
});

describe("REQ-156 the sidebar's folders", () => {
  test("the five field entries are the recurring folder's; the sidebar renders Back and the folder rows", () => {
    const src = read("front-end/islands/DashSidebar.tsx");
    // REQ-176 — the tree itself lives in lib/nav-tree.ts; the island renders it
    const tree = read("front-end/lib/nav-tree.ts");
    expect(tree).toMatch(/id: "recurring",[\s\S]*?items: \[/);
    const folder = tree.slice(
      tree.indexOf('id: "recurring"'),
      tree.indexOf("]", tree.indexOf('id: "recurring"')),
    );
    for (
      const id of [
        "subscriptions",
        "assignments",
        "tasks",
        "batches",
        "workers",
      ]
    ) expect(folder).toContain(`id: "${id}"`);
    expect(src).toContain('data-cy="nav-back"');
    expect(src).toContain("data-cy={`nav-folder-${item.id}`}");
    expect(src).toMatch(/tFor\(lang, "nav\.back"\)/);
    expect(src).toMatch(/folderPathTo\(NAV, active\)/);
  });

  test("both dictionaries carry the folder's name and Back", () => {
    const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
    const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
    expect(en["nav.recurring"]).toBe("Recurring");
    expect(es["nav.recurring"]).toBe("Recurrente");
    expect(en["nav.back"]).toBe("Back");
    expect(es["nav.back"]).toBe("Atrás");
  });
});
