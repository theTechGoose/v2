/**
 * REQ-513 — demo-loop cycle 3, issue p8-pair1-b: "'Upload your logo' opens the top of Settings".
 * Every dashboard setup-checklist item linked to the bare "/settings", and no Settings section had
 * an id to land on, so a click opened the page at its hero and left the person to hunt.
 *
 *   - each checklist item links to its own Settings section (`/settings#logo`, `#insurance`, …);
 *   - Settings gives each of those sections that id;
 *   - on load Settings reveals the section the hash names (scroll + focus), after the profile
 *     has loaded — the browser's own hash jump fires before the island has drawn anything.
 */
import * as fs from "fs";
import * as path from "path";
import {
  SETTINGS_ANCHORS,
  settingsAnchorOf,
  setupItemHref,
} from "../../front-end/lib/settings-anchors";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("REQ-513 (demo cycle 3, p8-pair1-b) — setup checklist deep-links into Settings", () => {
  test("REQ-513 each checklist item has its own Settings anchor", () => {
    expect(setupItemHref("logo")).toBe("/settings#logo");
    expect(setupItemHref("insurance")).toBe("/settings#insurance");
    expect(setupItemHref("payment")).toBe("/settings#payments");
    expect(setupItemHref("address")).toBe("/settings#address");
    expect(setupItemHref("name")).toBe("/settings#name");
    expect(setupItemHref("email")).toBe("/settings#email");
    expect(setupItemHref("biz")).toBe("/settings#business");
    const all = Object.values(SETTINGS_ANCHORS);
    expect(new Set(all).size).toBe(all.length);
  });

  test("REQ-513 settingsAnchorOf reads only a known section from a hash", () => {
    expect(settingsAnchorOf("#logo")).toBe("logo");
    expect(settingsAnchorOf("logo")).toBe("logo");
    expect(settingsAnchorOf("#payments")).toBe("payments");
    expect(settingsAnchorOf("")).toBeNull();
    expect(settingsAnchorOf("#")).toBeNull();
    expect(settingsAnchorOf("#nope")).toBeNull();
    expect(settingsAnchorOf("#settings-reset-title")).toBeNull();
  });

  test("REQ-513 the checklist never links to the bare /settings", () => {
    const src = read("front-end/islands/SetupChecklist.tsx");
    expect(src).not.toMatch(/href:\s*"\/settings"/);
    for (
      const key of [
        "name",
        "biz",
        "email",
        "logo",
        "address",
        "payment",
        "insurance",
      ]
    ) {
      expect(src).toContain(`setupItemHref("${key}")`);
    }
  });

  test("REQ-513 Settings stamps every anchor id and reveals the hashed section on load", () => {
    const src = read("front-end/islands/SettingsPage.tsx");
    for (const key of Object.keys(SETTINGS_ANCHORS)) {
      expect(src).toContain(`id={SETTINGS_ANCHORS.${key}}`);
    }
    expect(src).toMatch(/revealSettingsAnchor\(/);
  });
});
