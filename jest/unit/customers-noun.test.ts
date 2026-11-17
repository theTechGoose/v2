/**
 * REQ-274 — demo issue i18n-formatting-m12: the sidebar says "Customers" but the
 * /customers browser tab said "Clients · DocuMonster" and the hero crumb
 * "Clients · 0 on the books" (EN only; ES says "Clientes" everywhere).
 *
 * Root cause: P-46 picked "customers" as the one EN noun, but its guard
 * (i18n-dictionary-consistency.test.ts) checks a hand-picked key list, so the
 * title (clientsRoute.docTitle), the crumb and the quiet-count lines slipped
 * through. This pins the WHOLE page: every EN string under the namespaces the
 * /customers route renders uses "customer", never "client".
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const dict = (rel: string) => JSON.parse(read(rel)) as Record<string, string>;
const en = dict("lang/en.json");
const es = dict("lang/es.json");

// What /customers (routes/clients/index.tsx → islands/ClientsPage.tsx,
// components/ClientsSections.tsx, ClientsBoard, lib/clients-display.ts) renders.
const PAGE_NAMESPACES = [
  "clientsRoute.",
  "clientsHero.",
  "clientsPage.",
  "clientsBoard.",
  "clientsDisplay.",
];
const pageKeys = (d: Record<string, string>) =>
  Object.keys(d).filter((k) => PAGE_NAMESPACES.some((p) => k.startsWith(p)));

describe("REQ-274 /customers says one EN noun: Customers (demo i18n-formatting-m12)", () => {
  test("REQ-274 the browser-tab title matches the sidebar label", () => {
    expect(en["appNav.customers"]).toBe("Customers");
    expect(en["nav.customers"]).toBe("Customers");
    expect(en["clientsRoute.docTitle"]).toBe("Customers · DocuMonster");
  });

  test("REQ-274 the hero crumb says Customers", () => {
    expect(en["clientsHero.crumb"]).toBe("Customers · {n} on the books");
  });

  test("REQ-274 no EN string on the /customers page says client(s)", () => {
    const offenders = pageKeys(en)
      .filter((k) => /\bclients?\b/i.test(en[k]))
      .map((k) => `${k}: ${en[k]}`);
    expect(offenders).toEqual([]);
  });

  test("REQ-274 the legacy nav.clients label agrees too", () => {
    expect(en["nav.clients"]).toBe("Customers");
  });

  test("REQ-274 Spanish stays Clientes in the nav, the title and the crumb", () => {
    expect(es["appNav.customers"]).toBe("Clientes");
    expect(es["clientsRoute.docTitle"]).toBe("Clientes · DocuMonster");
    expect(es["clientsHero.crumb"]).toMatch(/^Clientes · /);
  });

  test("REQ-274 the route takes its title from clientsRoute.docTitle and /customers re-exports it", () => {
    // REQ-367: a DocTitle, so the tab title follows the EN/ES switch
    expect(read("front-end/routes/clients/index.tsx")).toMatch(
      /<DocTitle lang=\{lang\} title=\{\(l\) => tFor\(l, "clientsRoute\.docTitle"\)\} \/>/,
    );
    expect(read("front-end/routes/customers/index.tsx")).toMatch(
      /export \{ default \} from "\.\.\/clients\/index\.tsx"/,
    );
  });
});
