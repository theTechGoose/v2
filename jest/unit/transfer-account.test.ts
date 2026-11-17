/**
 * REQ-220 — Settings: "Transfer account" next to the phone. The wiring: the button on the phone
 * row (never while acting as an admin), the two-step dialog, the client's two calls, the bounce
 * to /login, and every key in both languages.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-220 transfer account — the settings wiring", () => {
  const page = read("front-end/islands/SettingsPage.tsx");
  const dialog = read("front-end/components/TransferAccount.tsx");
  const client = read("front-end/clients/profile.ts");

  test("the phone row carries the button, and an admin acting for the account never gets it", () => {
    expect(page).toMatch(/import \{ TransferAccount \} from "\.\.\/components\/TransferAccount\.tsx"/);
    expect(page).toMatch(/!acting\s*&&\s*<TransferAccount/);
    // on the phone row itself, next to the number
    const row = page.slice(page.indexOf("t.phone,", page.indexOf("title={t.account}")));
    expect(row.indexOf("<TransferAccount")).toBeGreaterThan(-1);
    expect(row.indexOf("<TransferAccount")).toBeLessThan(row.indexOf("t.language"));
  });

  test("REQ-220 AMENDMENT — the dialog is one step: the number and the button; no code anywhere", () => {
    for (
      const cy of [
        "transfer-open",
        "transfer-modal",
        "transfer-phone",
        "transfer-confirm",
        "transfer-cancel",
        "transfer-error",
      ]
    ) expect(dialog).toContain(`data-cy="${cy}"`);
    expect(dialog).toMatch(/role="dialog"/);
    expect(dialog).toMatch(/profileClient\.transferAccount\(/);
    // moved → this browser is signed out
    expect(dialog).toMatch(/location\.href = "\/login"/);
    for (const code of ["same_number", "phone_taken", "bad_phone"]) {
      expect(dialog).toContain(code);
    }
    for (
      const gone of [
        "transfer-code",
        "transfer-send",
        "transfer-dev-code",
        "transferStart",
        "transferConfirm",
        "invalid_code",
        "devCode",
      ]
    ) expect(dialog).not.toContain(gone);
  });

  test("one solid action per step; the cancel is a ghost (the action-row rule)", () => {
    expect(dialog).not.toMatch(/gradient/);
    expect(dialog).toMatch(/background:transparent/);
  });

  test("REQ-220 AMENDMENT — the client posts the number to the one route", () => {
    expect(client).toMatch(/transferAccount:[\s\S]{0,200}"\/me\/transfer"/);
    expect(client).not.toMatch(/transfer\/start|transfer\/confirm/);
  });

  test("both languages carry every key the dialog uses, and none of the code's", () => {
    const keys = [...new Set([...dialog.matchAll(/"(settings\.transfer\.[a-zA-Z_.]+)"/g)].map((m) => m[1]))];
    expect(keys.length).toBeGreaterThan(8);
    for (const file of ["lang/en.json", "lang/es.json"]) {
      const dict = JSON.parse(read(file));
      for (const k of keys) {
        expect(typeof dict[k]).toBe("string");
        expect(dict[k].length).toBeGreaterThan(0);
      }
      const all = Object.keys(dict).filter((k) => k.startsWith("settings.transfer."));
      expect(all.sort()).toEqual([...keys].sort()); // nothing left over from the code step
      expect(dict["sms.transferCode"]).toBeUndefined();
      expect(JSON.stringify(all.map((k) => dict[k]))).not.toMatch(/code|código/i);
    }
    expect(JSON.parse(read("lang/en.json"))["settings.transfer.button"]).toBe("Transfer account");
  });
});
