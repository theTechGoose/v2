/**
 * REQ-961 (LOOP-007 cycle 1, issue q1-35) — Raphael: "test every single
 * aspect of this application … one Opus agent per issue to do root cause
 * analysis, then one to write the test, then one to fix it and make it green."
 *
 * q1-35: a $2,489.75 invoice reads "$2,489.75" on the customer's page, PDF,
 * email and the owner's own drawer, but the owner's /invoices card (front and
 * back), the PAID THIS MONTH tile and every /payments card printed "$2,490".
 * Those call sites format ONE document's or payment's amount with the KPI
 * formatter fmtMoney, which does Math.round(|cents| / 100). format.ts's own
 * rule says document totals keep their cents (fmtMoneyExact).
 *
 * The cards are inner functions of the InvoicesPage / PaymentsPage islands
 * (not exported, mounted only after the client fetch), so this pins the
 * formatter each card applies to its amount; the e2e story
 * e2e/owner-cents/owner-cents.e2e.test.ts drives the same screens live.
 */
import * as fs from "fs";
import * as path from "path";
import { fmtMoney, fmtMoneyExact } from "../../front-end/lib/format.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const invoices = read("front-end/islands/InvoicesPage.tsx");
const payments = read("front-end/islands/PaymentsPage.tsx");
const kpis = read("front-end/components/PaymentsKpis.tsx");

const CENTS = 248_975;

/** the formatter call that wraps `expr` on the line matching `anchor` */
function formatterAt(src: string, anchor: RegExp, expr: string): string {
  const lines = src.split("\n");
  const i = lines.findIndex((l) => anchor.test(l));
  if (i < 0) throw new Error(`anchor ${anchor} not found`);
  // the amount sits on the anchor line or within the next 3 lines
  const win = lines.slice(i, i + 4).join("\n");
  const esc = expr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = win.match(new RegExp(`(\\w+)\\(\\s*${esc}\\s*\\)`));
  if (!m) throw new Error(`no formatter call on ${expr} near ${anchor}`);
  return m[1];
}

describe("REQ-961 q1-35: one invoice's or payment's amount is shown to the cent on owner screens", () => {
  it("REQ-961: the formatters — 248975 cents is $2,489.75 exact and $2,490 rounded", () => {
    expect(fmtMoneyExact(CENTS)).toBe("$2,489.75");
    expect(fmtMoney(CENTS)).toBe("$2,490");
  });

  it("REQ-961: the /invoices card's title (front face) prints the invoice with cents", () => {
    expect(formatterAt(invoices, /class="qcard__title"/, "inv.amount")).toBe(
      "fmtMoneyExact",
    );
  });

  it("REQ-961: the /invoices card's back prints the invoice with cents", () => {
    const back = invoices.indexOf(
      'tFor(lang, "invoicesPage.back.eyebrow")',
    );
    expect(back).toBeGreaterThan(-1);
    expect(
      formatterAt(
        invoices.slice(back),
        /class="qcard__back-big"/,
        "inv.amount",
      ),
    ).toBe("fmtMoneyExact");
  });

  it("REQ-961: the owner's drawer already prints it exactly — the card must agree with it", () => {
    expect(invoices).toMatch(/fmtMoneyExact\(inv\.amount\)/);
  });

  const paymentSites: Array<[string, RegExp, string]> = [
    ["hero stub", /class="pph__stub-amount"/, "p.amount"],
    [
      "payment card front",
      /\? "text-decoration:line-through;opacity:0\.6"/,
      "p.amount",
    ],
    ["payment card back", /class="qcard__back-big"/, "p.amount"],
    ["claim card", /<div class="pcard__amount">/, "c.amount"],
    ["landed row", /class="qdone__amt"/, "p.amount"],
    ["chargeback title", /"paymentsPage\.chargeback\.title"/, "p.amount"],
  ];
  for (const [where, anchor, expr] of paymentSites) {
    it(`REQ-961: /payments ${where} prints the single payment with cents`, () => {
      expect(formatterAt(payments, anchor, expr)).toBe("fmtMoneyExact");
    });
  }

  it("REQ-961: totals read against an exact invoice (PAID THIS MONTH, /payments month total) are not the whole-dollar fmtMoney", () => {
    expect(invoices).not.toMatch(/fmtMoney\(paidTotal\)/);
    expect(kpis).not.toMatch(/fmtMoney\(monthTotal\)/);
    expect(payments).not.toMatch(/fmtMoney\(monthTotal\)/);
  });
});
