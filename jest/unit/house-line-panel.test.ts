/** REQ-920b — the Phone page's house-registration panel (super admins): pick a verified campaign's service, adopt */
import * as fs from "fs";
import * as path from "path";
const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("REQ-920b the house path on the Phone page", () => {
  test("REQ-920b the panel exists, is mounted in PhonePage, and talks through the client", () => {
    const panel = read("front-end/components/comms/HouseLinePanel.tsx");
    for (
      const cy of [
        "comms-house",
        "comms-house-service",
        "comms-house-adopt",
        "comms-house-registered",
        "comms-house-err",
      ]
    ) {
      expect(panel).toContain(`data-cy="${cy}"`);
    }
    expect(panel).toContain("commsClient.houseServices(");
    expect(panel).toContain("commsClient.houseAdopt(");
    expect(panel).not.toMatch(/fetch\(/);
    const client = read("front-end/clients/communications.ts");
    expect(client).toContain('"/communications/house/services"');
    expect(client).toContain('"/communications/house/adopt"');
    const island = read("front-end/islands/PhonePage.tsx");
    expect(island).toContain("<HouseLinePanel");
  });

  test("REQ-920b/e both dictionaries carry the same comms.house.* keys, every one the panel uses", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    const keys = Object.keys(en).filter((k) => k.startsWith("comms.house."));
    expect(keys.length).toBeGreaterThanOrEqual(8);
    for (const k of keys) expect(typeof es[k]).toBe("string");
    const panel = read("front-end/components/comms/HouseLinePanel.tsx");
    for (const k of panel.match(/t\("comms\.house\.[a-zA-Z.]+"/g) ?? []) {
      expect(en[k.slice(3, -1)]).toBeDefined();
    }
  });

  test("REQ-920b the controller is super-admin only", () => {
    const ctl = read(
      "backend/src/communications/entrypoints/house-line-controller/mod.ts",
    );
    expect(ctl).toContain("requireSuperAdmin(");
    expect(ctl).not.toMatch(/requireUser\(/);
  });
});
