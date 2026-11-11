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

  test("the dialog: the button, the phone step, the code step, the dev code, the errors", () => {
    for (
      const cy of [
        "transfer-open",
        "transfer-modal",
        "transfer-phone",
        "transfer-send",
        "transfer-code",
        "transfer-dev-code",
        "transfer-confirm",
        "transfer-cancel",
        "transfer-error",
      ]
    ) expect(dialog).toContain(`data-cy="${cy}"`);
    expect(dialog).toMatch(/role="dialog"/);
    expect(dialog).toMatch(/profileClient\.transferStart\(/);
    expect(dialog).toMatch(/profileClient\.transferConfirm\(/);
    // moved → this browser is signed out
    expect(dialog).toMatch(/location\.href = "\/login"/);
    for (
      const code of [
        "same_number",
        "phone_taken",
        "bad_phone",
        "cooldown",
        "invalid_code",
        "expired",
        "rate_limited",
      ]
    ) expect(dialog).toContain(code);
  });

  test("one solid action per step; the cancel is a ghost (the action-row rule)", () => {
    expect(dialog).not.toMatch(/gradient/);
    expect(dialog).toMatch(/background:transparent/);
  });

  test("the client posts to the two routes", () => {
    expect(client).toMatch(/transferStart:[\s\S]{0,200}"\/me\/transfer\/start"/);
    expect(client).toMatch(/transferConfirm:[\s\S]{0,200}"\/me\/transfer\/confirm"/);
  });

  test("both languages carry every key the dialog and the text use", () => {
    const keys = [...new Set([...dialog.matchAll(/"(settings\.transfer\.[a-zA-Z_.]+)"/g)].map((m) => m[1]))];
    expect(keys.length).toBeGreaterThan(10);
    for (const file of ["lang/en.json", "lang/es.json"]) {
      const dict = JSON.parse(read(file));
      for (const k of [...keys, "sms.transferCode"]) {
        expect(typeof dict[k]).toBe("string");
        expect(dict[k].length).toBeGreaterThan(0);
      }
      expect(dict["sms.transferCode"]).toContain("{code}");
      expect(dict["sms.transferCode"]).toContain("{account}");
    }
    expect(JSON.parse(read("lang/en.json"))["settings.transfer.button"]).toBe("Transfer account");
  });
});
