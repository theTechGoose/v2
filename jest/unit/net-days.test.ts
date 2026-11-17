/**
 * REQ-174 — a subscription says how many days the customer has to pay, defaulting to a number in
 * Settings; the batch stores it on the draft and dates the invoice from the day it is sent.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-174 days to pay", () => {
  test("the subscription form has the field, defaulting to the account's setting", () => {
    const src = read("front-end/islands/FieldSubscriptionsPage.tsx");
    expect(src).toMatch(/data-cy="subs-net-days"/);
    expect(src).toMatch(/invoiceNetDays/);
    expect(src).toMatch(/netDays/);
  });
  test("Settings collects the default as a number", () => {
    const src = read("front-end/islands/SettingsPage.tsx");
    expect(src).toMatch(/data-cy="settings-net-days"/);
    expect(src).toMatch(/saveIdentity\(\{ invoiceNetDays/);
  });
  test("finishing a draft on /invoices dates it from today by its days to pay", () => {
    // REQ-727 (demo-loop cycle 5, c4-M16): the rule lives in
    // lib/invoice-send-sheet.ts finishDraftDates — "Finish + send" stamps,
    // and the send sheet previews, the same dates.
    const src = read("front-end/islands/InvoicesPage.tsx");
    expect(src).toMatch(/finishDraftDates\(\s*inv,/);
    expect(read("front-end/lib/invoice-send-sheet.ts")).toMatch(/inv\.netDays/);
  });
  test("labels in both languages", () => {
    for (const d of [en, es]) {
      for (
        const k of [
          "field.subs.netDays",
          "field.subs.netDaysHint",
          "settings.netDays",
          "settings.netDaysHint",
        ]
      ) {
        expect(d[k]).toBeTruthy();
      }
      expect(d["field.subs.netDaysHint"]).toMatch(/\{n\}/);
    }
  });
});
