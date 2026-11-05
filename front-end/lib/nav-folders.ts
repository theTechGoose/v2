/**
 * REQ-156 — sidebar folders, the pure part. The nav is a tree of links and folders; the sidebar
 * shows ONE level at a time: the root, or a folder's own entries behind a Back row. The path is
 * a list of folder ids; the active entry's path is derived here so a page inside a folder opens
 * the sidebar already inside it. No DOM, no i18n: the sidebar reads `nav.<id>` for every node.
 */
export interface NavLink<Icon = string> {
  id: string;
  icon: Icon;
  href: string;
  /** a sidebar entry whose badge is a derived count */
  countKey?: string;
}
export interface NavFolder<Icon = string> {
  id: string;
  icon: Icon;
  items: NavNode<Icon>[];
}
export type NavNode<Icon = string> = NavLink<Icon> | NavFolder<Icon>;

export function isFolder<Icon>(n: NavNode<Icon>): n is NavFolder<Icon> {
  return Array.isArray((n as NavFolder<Icon>).items);
}

/** the folder ids leading to `id`; the root (`[]`) for a top-level, unknown or missing id */
export function folderPathTo<Icon>(
  nodes: NavNode<Icon>[],
  id: string | undefined,
  path: string[] = [],
): string[] {
  if (!id) return [];
  for (const n of nodes) {
    if (n.id === id) return path;
    if (isFolder(n)) {
      const found = folderPathTo(n.items, id, [...path, n.id]);
      if (found.length > path.length) return found;
    }
  }
  return [];
}

export interface NavView<Icon = string> {
  /** the folder open, null at the root */
  folder: NavFolder<Icon> | null;
  items: NavNode<Icon>[];
  /** where Back goes; null at the root */
  parentPath: string[] | null;
}

/** what the sidebar shows at `path`; a path that is not a chain of folders shows the root */
export function viewAt<Icon>(
  nodes: NavNode<Icon>[],
  path: string[],
): NavView<Icon> {
  let items = nodes;
  let folder: NavFolder<Icon> | null = null;
  for (const id of path) {
    const next = items.find((n) => n.id === id);
    if (!next || !isFolder(next)) {
      return { folder: null, items: nodes, parentPath: null };
    }
    folder = next;
    items = next.items;
  }
  return { folder, items, parentPath: folder ? path.slice(0, -1) : null };
}
