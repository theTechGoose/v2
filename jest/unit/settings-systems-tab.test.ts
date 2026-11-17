/**
 * REQ-912 — the Systems tab under Account (/settings?tab=systems): the one place listing what
 * DocuMonster runs on for the account; HR's Systems page folded into it (/hr/systems 302s there,
 * the HR folder has five entries); both dictionaries. REQ-920d: the Phone & text card shows the
 * line's texting registration (Not registered / In review / Registered / Failed).
 */
import * as fs from "fs";
import * as path from "path";
import { settingsTabOf } from "../../front-end/lib/plan-return";
import { viewAt } from "../../front-end/lib/nav-folders";
import { NAV } from "../../front-end/lib/nav-tree";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));
const dict = (rel: string) => JSON.parse(read(rel)) as Record<string, string>;

describe("REQ-912 the Systems tab under Account", () => {
  test("REQ-912a ?tab=systems opens the third tab; the other two are untouched", () => {
    expect(settingsTabOf("?tab=systems")).toBe("systems");
    expect(settingsTabOf("?tab=billing")).toBe("billing");
    expect(settingsTabOf("")).toBe("account");
    const page = read("front-end/islands/SettingsPage.tsx");
    expect(page).toContain('data-cy="settings-tab-systems"');
    expect(page).toContain("<SystemsTab");
    expect(page.indexOf('data-cy="settings-tab-billing"')).toBeLessThan(
      page.indexOf('data-cy="settings-tab-systems"'),
    );
    expect(read("front-end/routes/settings/index.tsx")).toContain(
      'asset("/hr.css")',
    );
  });

  test("REQ-912b the tab lists email, the line, card payments, e-sign and the HR registry (with the catalog and the custom form), off GET /me/systems", () => {
    const tab = read("front-end/components/SystemsTab.tsx");
    for (
      const cy of [
        "sys-email",
        "sys-line",
        "sys-payments",
        "sys-esign",
        "sys-hr",
        "hr-catalog-card",
        "hr-sys-card",
        "hr-attach",
        "hr-custom",
        "hr-custom-name",
        "hr-custom-add",
      ]
    ) {
      // the summary cards take the hook as a `cy` prop and render it as data-cy
      expect(tab.includes(`data-cy="${cy}"`) || tab.includes(`cy="${cy}"`))
        .toBe(true);
    }
    expect(tab).toContain("systemsClient.summary(");
    expect(read("front-end/clients/systems.ts")).toContain('"/me/systems"');
    // a built-in arm is built in DocuMonster: no webhook field for it
    expect(tab).toContain("isBuiltin(");
  });

  test("REQ-912d the HR folder lost its Systems entry and /hr/systems 302s to the tab; the old island is gone", () => {
    expect(viewAt(NAV, ["hr"]).items.map((n) => n.id)).toEqual([
      "hrHome",
      "hires",
      "hrDocuments",
      "departments",
      "hrSettings",
    ]);
    const route = read("front-end/routes/hr/systems.tsx");
    expect(route).toContain("302");
    expect(route).toContain("/settings?tab=systems");
    expect(exists("front-end/islands/HrSystemsPage.tsx")).toBe(false);
  });

  test("REQ-912e both dictionaries carry the tab and every settings.systems.* string, with the same keys", () => {
    const en = dict("lang/en.json"), es = dict("lang/es.json");
    expect(en["settings.tabSystems"]).toBe("Systems");
    expect(es["settings.tabSystems"]).toBe("Sistemas");
    const keys = Object.keys(en).filter((k) =>
      k.startsWith("settings.systems.")
    );
    expect(keys.length).toBeGreaterThanOrEqual(12);
    for (const k of keys) expect(typeof es[k]).toBe("string");
    for (
      const k of [
        "settings.systems.title",
        "settings.systems.email",
        "settings.systems.line",
        "settings.systems.lineNone",
        "settings.systems.lineGet",
        "settings.systems.payments",
        "settings.systems.esign",
        "settings.systems.hr",
        "settings.systems.builtin",
      ]
    ) {
      expect(en[k]).toBeTruthy();
    }
  });

  test("REQ-920d the Phone & text card shows the line's texting registration off line.a2p", () => {
    const tab = read("front-end/components/SystemsTab.tsx");
    expect(tab).toContain("systemsA2p(line)");
    expect(read("front-end/lib/a2p.ts")).toContain("return line.a2p");
    expect(tab).toContain("`comms.a2p.sys.${");
    expect(tab).toContain("data-a2p=");
    const client = read("front-end/clients/systems.ts");
    expect(client).toContain(
      'a2p: "none" | "pending" | "registered" | "failed"',
    );
    const en = dict("lang/en.json"), es = dict("lang/es.json");
    expect([
      en["comms.a2p.sys.none"],
      en["comms.a2p.sys.pending"],
      en["comms.a2p.sys.registered"],
    ]).toEqual([
      "Not registered",
      "In review",
      "Registered",
    ]);
    for (const s of ["none", "pending", "registered", "failed"]) {
      expect(es[`comms.a2p.sys.${s}`]).toBeTruthy();
    }
  });
});
