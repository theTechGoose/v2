/**
 * REQ-619 — demo-loop cycle 4, issue p4-p3d: "Every page header reads 'Hey, Deb 👋' with no page
 * name". On a phone the sidebar (which marks the current page) sits in the closed drawer, so the
 * topbar was the only chrome on screen — and it greeted instead of naming the page.
 *
 *   - topbarGreeting takes a `pageTitleKey`; when given, the heading is that key in the LIVE
 *     language, and it wins over a name saved on the page (pm:profile-updated), which otherwise
 *     re-greets (the skeptic's note: the savedName branch beat every override);
 *   - DashTopbar exposes `pageTitleKey` and hands it to topbarGreeting;
 *   - every app page except /dashboard passes its sidebar label key (nav.* / appNav.settings),
 *     so the greeting lives on /dashboard only; each key exists in en and es.
 */
import * as fs from "fs";
import * as path from "path";
import { topbarGreeting } from "../../front-end/lib/greeting-identity";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const dicts: Record<"en" | "es", Record<string, string>> = {
  en: require("../../lang/en.json"),
  es: require("../../lang/es.json"),
};
const tIn =
  (lang: "en" | "es") => (key: string, vars?: Record<string, string>) =>
    Object.entries(vars ?? {}).reduce(
      (s, [k, v]) => s.replace(`{${k}}`, v),
      dicts[lang][key] ?? key,
    );

/** route file → the page-title key its topbar must show */
const PAGES: Record<string, string> = {
  "front-end/routes/invoices/index.tsx": "nav.invoices",
  "front-end/routes/quotes/index.tsx": "nav.quotes",
  "front-end/routes/clients/index.tsx": "nav.clients",
  "front-end/routes/payments/index.tsx": "nav.payments",
  "front-end/routes/settings/index.tsx": "appNav.settings",
  "front-end/routes/field/subscriptions.tsx": "nav.subscriptions",
  "front-end/routes/field/assignments.tsx": "nav.assignments",
  "front-end/routes/field/tasks.tsx": "nav.tasks",
  "front-end/routes/field/batches.tsx": "nav.batches",
  "front-end/routes/field/workers.tsx": "nav.workers",
  "front-end/routes/work-orders/index.tsx": "nav.workOrders",
  "front-end/routes/wo/[id].tsx": "nav.workOrders",
  "front-end/routes/admins/index.tsx": "nav.admins",
};

describe("REQ-619 (cycle 4, p4-p3d) the topbar names the page; the greeting is /dashboard's", () => {
  test("REQ-619 topbarGreeting: a pageTitleKey is the heading, in the live language", () => {
    expect(
      topbarGreeting(tIn("en"), {
        greetingName: "Deb",
        pageTitleKey: "nav.invoices",
      }),
    ).toBe("Invoices");
    expect(
      topbarGreeting(tIn("es"), {
        greetingName: "Deb",
        pageTitleKey: "nav.invoices",
      }),
    ).toBe(dicts.es["nav.invoices"]);
  });

  test("REQ-619 topbarGreeting: a name saved on the page does not replace the page title", () => {
    expect(
      topbarGreeting(tIn("en"), {
        greetingName: "Deb",
        savedName: "Deborah Hale",
        pageTitleKey: "appNav.settings",
      }),
    ).toBe(dicts.en["appNav.settings"]);
  });

  test("REQ-619 topbarGreeting: without a pageTitleKey the dashboard still greets", () => {
    expect(topbarGreeting(tIn("en"), { greetingName: "Deb" })).toBe(
      tIn("en")("dashTopbar.greeting", { name: "Deb" }),
    );
  });

  test("REQ-619 DashTopbar takes pageTitleKey and passes it to topbarGreeting", () => {
    const src = read("front-end/islands/DashTopbar.tsx");
    expect(src).toMatch(/pageTitleKey\?:\s*string/);
    expect(src).toMatch(/topbarGreeting\([\s\S]*?pageTitleKey[\s\S]*?\)/);
  });

  test.each(Object.entries(PAGES))(
    "REQ-619 %s passes pageTitleKey=%s (present in en and es)",
    (file, key) => {
      const src = read(file);
      expect(src).toMatch(
        new RegExp(`<DashTopbar[^>]*pageTitleKey="${key.replace(".", "\\.")}"`),
      );
      expect(dicts.en[key]).toBeTruthy();
      expect(dicts.es[key]).toBeTruthy();
    },
  );

  test("REQ-619 /dashboard is the one page that greets (no pageTitleKey)", () => {
    expect(read("front-end/routes/dashboard/index.tsx")).not.toMatch(
      /pageTitleKey/,
    );
  });
});
