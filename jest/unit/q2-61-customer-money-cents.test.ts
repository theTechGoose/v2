/**
 * REQ-1072 (LOOP-007 cycle 2, issue q2-61) — Raphael: "test every single
 * aspect of this application … one Opus agent per issue to do root cause
 * analysis, then one to write the test, then one to fix it and make it green."
 *
 * q2-61: one customer's money reads two ways side by side. On /customers/<id>
 * the TE DEBE / owes KPI prints 119075 cents as "$1,190.75" while FACTURADO
 * (TOTAL) prints "$1,191" (CustomerWorkspace's local money(…, true) drops the
 * cents). After a $500 payment the owes KPI reads "$690.75" but the /customers
 * board card says "$691 pendiente" (clients-display dollars() rounds), and the
 * /invoices hero says "$691" next to the Out tile's "$690.75".
 * REQ-961's rule: a total read against an exact document reconciles to the
 * cent — whole dollars only when the total is whole (fmtMoneyTotal).
 */
import * as fs from "fs";
import * as path from "path";
import {
  balanceDisplay,
  storyLineFor,
} from "../../front-end/lib/clients-display";
import type { CustomerCard } from "../../front-end/clients/clients";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const workspace = read("front-end/islands/CustomerWorkspace.tsx");
const invoices = read("front-end/islands/InvoicesPage.tsx");

const card = (balanceCents: number): CustomerCard =>
  ({
    id: "c1",
    name: "Ann Lee",
    status: "active",
    balanceCents,
    balanceSub: "awaiting payment",
    documents: [],
  }) as unknown as CustomerCard;

describe("REQ-1072 q2-61: a customer's money reads to the cent on the board and the customer page", () => {
  it("REQ-1072: the /customers board card's balance keeps its cents — $690.75 due / $690.75 pendiente, never $691", () => {
    expect(balanceDisplay(card(69_075), "en").text).toBe("$690.75 due");
    expect(balanceDisplay(card(69_075), "es").text).toBe("$690.75 pendiente");
  });

  it("REQ-1072: a whole-dollar balance stays compact — $2,400 due", () => {
    expect(balanceDisplay(card(240_000), "en").text).toBe("$2,400 due");
  });

  it("REQ-1072: the board card's story line keeps the cents too", () => {
    const line = storyLineFor(card(69_075), "en", Date.now());
    expect(line).toContain("$690.75");
    expect(line).not.toMatch(/\$691(?![\d.])/);
  });

  it("REQ-1072: CustomerWorkspace has no whole-dollar money(…, true) call — FACTURADO / PAGADO / recurring / unbilled / open quotes agree with TE DEBE", () => {
    const whole = workspace.match(/money\([^()]*,\s*lang,\s*true\s*\)/g) ?? [];
    expect(whole).toEqual([]);
  });

  it("REQ-1072: CustomerWorkspace's money formatter never forces maximumFractionDigits 0", () => {
    expect(workspace).not.toMatch(/maximumFractionDigits:\s*0/);
  });

  it("REQ-1072: the /invoices hero's outstanding total uses fmtMoneyTotal, like the Out tile beside it", () => {
    expect(invoices).not.toMatch(/fmtMoney\(outstandingTotal\)/);
    expect(invoices).toMatch(/fmtMoneyTotal\(outstandingTotal\)/);
  });
});
