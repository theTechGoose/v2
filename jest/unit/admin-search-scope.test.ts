/**
 * REQ-507 — "fix every issue the demo found, loop until there are none." Demo-loop cycle 3,
 * issue m25 ("/admin search confusing: phone shows 'Nothing matches' while listed; 'abc!!'
 * shows all").
 *
 * RCA: /admin carried two search boxes with different scopes. The topbar's GlobalSearch
 * ("Search the account") searches the signed-in staff account's OWN customers and documents,
 * so a customer's phone typed there said "Nothing matches" while the /admin table listed her.
 * And the /admin users search stripped every non-digit, so "abc!!" listed everyone, with no
 * "no matches" state.
 *
 * Here: the /admin route renders the topbar without GlobalSearch; the island renders it only
 * when `search` is not false; the users search says it takes a name, business or phone (no
 * tel keypad); an empty result names the query (`adminEmptyText`). The backend half is
 * backend/src/users/entrypoints/admin-controller/search.int.test.ts; the browser proof is
 * e2e/admin-search-scope/admin-search-scope.e2e.test.ts.
 */
import * as fs from "fs";
import * as path from "path";
import { adminEmptyText } from "../../front-end/lib/admin-console";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const en: Record<string, string> = require("../../lang/en.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const es: Record<string, string> = require("../../lang/es.json");

const tEn = (k: string, v?: Record<string, string>) =>
  (en[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => v?.[n] ?? `{${n}}`);

describe("REQ-507 (demo cycle 3, m25) /admin has one search, scoped to users", () => {
  test("the /admin route renders the topbar with search={false}", () => {
    expect(read("front-end/routes/admin/index.tsx")).toMatch(
      /<DashTopbar\b[^>]*\bsearch=\{false\}/,
    );
  });

  test("DashTopbar renders GlobalSearch only when `search` is not false", () => {
    const src = read("front-end/islands/DashTopbar.tsx");
    expect(src).toMatch(/search\?: boolean/);
    expect(src).toMatch(/search\s*!==\s*false\s*&&\s*<GlobalSearch\s*\/>/);
    expect(src).not.toMatch(/^\s*<GlobalSearch \/>\s*$/m);
  });

  test("the users search says it takes a name, business or phone — and opens no tel keypad", () => {
    expect(en["adminPage.search.placeholder"]).toMatch(/name/i);
    expect(en["adminPage.search.placeholder"]).toMatch(/business/i);
    expect(en["adminPage.search.placeholder"]).toMatch(/phone/i);
    expect(es["adminPage.search.placeholder"]).toMatch(/nombre/i);
    expect(es["adminPage.search.placeholder"]).toMatch(/negocio/i);
    expect(es["adminPage.search.placeholder"]).toMatch(/teléfono/i);
    expect(en["adminPage.search.aria"]).toMatch(/name/i);
    expect(es["adminPage.search.aria"]).toMatch(/nombre/i);
    expect(read("front-end/islands/AdminPage.tsx")).not.toMatch(
      /inputMode="tel"/,
    );
  });

  test("adminEmptyText names the query; a blank query keeps the plain 'No users found.'", () => {
    expect(adminEmptyText(tEn, "abc!!")).toBe("No users match “abc!!”.");
    expect(adminEmptyText(tEn, "  zzz ")).toBe("No users match “zzz”.");
    expect(adminEmptyText(tEn, "")).toBe("No users found.");
    expect(es["adminPage.emptyFor"]).toContain("{q}");
    expect(en["adminPage.emptyFor"]).toContain("{q}");
  });

  test("the island's empty state renders adminEmptyText with the query the rows came from", () => {
    const src = read("front-end/islands/AdminPage.tsx");
    expect(src).toMatch(/adminEmptyText\(t, shownQ\)/);
    expect(src).not.toMatch(/\{t\("adminPage\.empty"\)\}/);
  });
});
