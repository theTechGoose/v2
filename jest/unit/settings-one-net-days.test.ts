/**
 * REQ-622 — demo-loop cycle 4, issue p4-p6c. Settings showed two payment-term settings: "Days to
 * pay an invoice" (identity.invoiceNetDays, REQ-174 — read by the invoice form) and the Contract
 * defaults card's "Payment terms (days)" / deposit % / warranty days, saved to
 * /profile/contract-defaults and read by nothing. The dead card is gone; invoiceNetDays is the one
 * source, and the front-end type no longer advertises the dead fields.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const page = read("front-end/islands/SettingsPage.tsx");
const client = read("front-end/clients/profile.ts");

describe("REQ-622 (demo cycle 4, p4-p6c) one payment-term setting in Settings", () => {
  test("REQ-622 Settings no longer renders the Contract defaults card", () => {
    expect(page).not.toMatch(/ContractDefaultsEditCard/);
    expect(page).not.toMatch(/settings-contract-defaults/);
    expect(page).not.toMatch(/\/profile\/contract-defaults/);
  });

  test("REQ-622 nothing in Settings saves paymentTermsDays, depositPct or warrantyDays", () => {
    expect(page).not.toMatch(/paymentTermsDays|depositPct|warrantyDays/);
  });

  test("REQ-622 'Days to pay an invoice' (invoiceNetDays) stays the single source", () => {
    expect(page).toMatch(/saveIdentity\(\{ invoiceNetDays: n \}\)/);
    expect(page).toMatch(/data-cy="settings-net-days"/);
  });

  test("REQ-622 the client's ContractDefaults type drops the dead fields", () => {
    const decl = client.slice(
      client.indexOf("export interface ContractDefaults"),
      client.indexOf("}", client.indexOf("export interface ContractDefaults")),
    );
    expect(decl).not.toMatch(/paymentTermsDays|depositPct|warrantyDays/);
  });
});
