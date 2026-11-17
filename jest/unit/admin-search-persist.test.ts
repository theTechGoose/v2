/**
 * REQ-894 — demo-loop run 6 (dm6), issue p11: /admin's search box came back empty after a demo
 * ended (the end hops the stage to /admin?demo=ended…, a fresh page: AdminPage kept the query only
 * in state). The query now lives in the tab's sessionStorage too (`pm:admin-q`), written as the
 * staff types and searches, and a mounting AdminPage seeds its box and its first search from it.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// deno-lint-ignore no-explicit-any
type Any = any;

const mod = () =>
  require("../../front-end/lib/admin-query") as {
    ADMIN_QUERY_KEY: string;
    ADMIN_QUERY_MAX: number;
    readAdminQuery(store: Any): string;
    keepAdminQuery(store: Any, q: string): void;
  };

function store(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    has: (k: string) => m.has(k),
  };
}

describe("REQ-894 (dm6, p11) /admin keeps its search across the demo's end", () => {
  test("REQ-894 the query is kept and read back; an empty query clears it; a refused or missing store is no error", () => {
    const { ADMIN_QUERY_KEY, ADMIN_QUERY_MAX, readAdminQuery, keepAdminQuery } =
      mod();
    const s = store();
    expect(readAdminQuery(s)).toBe("");
    keepAdminQuery(s, "512 555");
    expect(s.getItem(ADMIN_QUERY_KEY)).toBe("512 555");
    expect(readAdminQuery(s)).toBe("512 555");
    keepAdminQuery(s, "");
    expect(s.has(ADMIN_QUERY_KEY)).toBe(false);
    expect(readAdminQuery(s)).toBe("");
    // bounded: a pasted essay is cut
    keepAdminQuery(s, "x".repeat(ADMIN_QUERY_MAX + 50));
    expect(readAdminQuery(s).length).toBe(ADMIN_QUERY_MAX);
    expect(readAdminQuery(null)).toBe("");
    expect(readAdminQuery(undefined)).toBe("");
    const refused = {
      getItem: () => {
        throw new Error("refused");
      },
      setItem: () => {
        throw new Error("refused");
      },
      removeItem: () => {
        throw new Error("refused");
      },
    };
    expect(() => keepAdminQuery(refused, "a")).not.toThrow();
    expect(readAdminQuery(refused)).toBe("");
  });

  test("REQ-894 wiring: AdminPage seeds the box and the first search from the stored query and keeps it as the staff types", () => {
    const page = read("front-end/islands/AdminPage.tsx");
    expect(page).toMatch(
      /import \{[^}]*keepAdminQuery[^}]*readAdminQuery[^}]*\} from "\.\.\/lib\/admin-query\.ts"/,
    );
    // the first effect: the stored query into the box and the ref BEFORE the first search
    const effect = page.slice(
      page.indexOf("const kept = readAdminQuery("),
      page.indexOf("search();", page.indexOf("const kept = readAdminQuery(")),
    );
    expect(effect).toMatch(/setQ\(kept\)/);
    expect(effect).toMatch(/qRef\.current = kept/);
    // typing keeps it
    expect(page).toMatch(/onInput=\{\(e\) => \{[\s\S]{0,200}keepAdminQuery\(/);
  });
});
