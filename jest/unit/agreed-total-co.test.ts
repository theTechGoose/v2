/**
 * REQ-679 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 5 (run r37f88707), issues M18 + M19.
 *
 * M18: after CO-001 (+$1,600) was approved on a $16,300 50/50 job, /i showed
 * "BALANCE DUE $9,750.00" next to "AGREEMENT VALUE $16,300.00" and a payment
 * schedule whose balance read "$8,150.00 On completion".
 * M19: the /quotes panel header (and the dashboard's active-job row) kept
 * $16,300 while the ledger's Agreed row and the Customers card read $17,900.
 *
 * RCA: approving a CO only revises the invoice; every agreement figure other
 * than the ledger read quote.estimatedTotal. One helper now owns the rule:
 * agreed total = quote total + approved change-order deltas.
 */
import { readFileSync } from "fs";
import { join } from "path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ledgerMod = () => require("../../shared/documents/ledger");

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

const quote = { id: "q1", estimatedTotal: 1_630_000 };
const cos = [
  { id: "co1", status: "approved", deltaAmountCents: 160_000 },
  { id: "co2", status: "pending", deltaAmountCents: 99_900 },
  { id: "co3", status: "declined", deltaAmountCents: 50_000 },
];

describe("REQ-679 agreedTotalCents — quote total + APPROVED change orders", () => {
  it("REQ-679: 16,300 + approved 1,600 = 17,900; pending/declined ignored", () => {
    const { agreedTotalCents } = ledgerMod();
    expect(agreedTotalCents(quote, cos)).toBe(1_790_000);
  });
  it("REQ-679: no change orders → the quote's own total (line items when no estimatedTotal)", () => {
    const { agreedTotalCents } = ledgerMod();
    expect(agreedTotalCents(quote, [])).toBe(1_630_000);
    expect(
      agreedTotalCents({ lineItems: [{ price: 50_000, quantity: 2 }] }, []),
    ).toBe(100_000);
  });
  it("REQ-679: a negative approved order lowers it, never below zero", () => {
    const { agreedTotalCents } = ledgerMod();
    expect(
      agreedTotalCents(quote, [{
        status: "approved",
        deltaAmountCents: -30_000,
      }]),
    ).toBe(1_600_000);
    expect(
      agreedTotalCents({ estimatedTotal: 100 }, [{
        status: "approved",
        deltaAmountCents: -500,
      }]),
    ).toBe(0);
  });
  it("REQ-679: quoteLedger's agreement total is the same helper's figure", () => {
    const { quoteLedger, agreedTotalCents } = ledgerMod();
    const l = quoteLedger(
      quote,
      [],
      cos.map((c) => ({ ...c })),
    );
    expect(l.agreementTotalCents).toBe(agreedTotalCents(quote, cos));
  });
});

describe("REQ-679 installmentSchedule — the schedule from the real installments", () => {
  it("REQ-679 (the demo): 16,300 at 50/50, +1,600 approved on the balance → 8,150 / 9,750", () => {
    const { installmentSchedule } = ledgerMod();
    // the split of the CO-adjusted agreement (17,900 at 50/50)
    const split = [895_000, 895_000];
    expect(
      installmentSchedule(split, 1_790_000, [
        {
          id: "inv1",
          amount: 815_000,
          status: "paid",
          installmentIndex: 1,
          installmentTotal: 2,
        },
        {
          id: "inv2",
          amount: 975_000,
          status: "sent",
          installmentIndex: 2,
          installmentTotal: 2,
        },
      ]),
    ).toEqual([815_000, 975_000]);
  });
  it("REQ-679: an installment not issued yet gets what is left of the agreement", () => {
    const { installmentSchedule } = ledgerMod();
    expect(
      installmentSchedule([895_000, 895_000], 1_790_000, [{
        id: "inv1",
        amount: 815_000,
        status: "paid",
        installmentIndex: 1,
        installmentTotal: 2,
      }]),
    ).toEqual([815_000, 975_000]);
  });
  it("REQ-679: no installments known (or a different plan) → the split as given", () => {
    const { installmentSchedule } = ledgerMod();
    expect(installmentSchedule([895_000, 895_000], 1_790_000, [])).toEqual([
      895_000,
      895_000,
    ]);
    expect(
      installmentSchedule([895_000, 895_000], 1_790_000, [{
        amount: 100,
        installmentIndex: 1,
        installmentTotal: 3,
      }]),
    ).toEqual([895_000, 895_000]);
    // a void installment is not part of the schedule
    expect(
      installmentSchedule([895_000, 895_000], 1_790_000, [{
        amount: 100,
        status: "void",
        installmentIndex: 1,
        installmentTotal: 2,
      }]),
    ).toEqual([895_000, 895_000]);
  });
  it("REQ-679: a single-payment plan is left alone", () => {
    const { installmentSchedule } = ledgerMod();
    expect(installmentSchedule([1_790_000], 1_790_000, [])).toEqual([
      1_790_000,
    ]);
  });
  it("REQ-679: three installments, the middle one unknown, take the remainder", () => {
    const { installmentSchedule } = ledgerMod();
    expect(
      installmentSchedule([300, 300, 400], 1_100, [
        { amount: 300, installmentIndex: 1, installmentTotal: 3 },
        { amount: 500, installmentIndex: 3, installmentTotal: 3 },
      ]),
    ).toEqual([300, 300, 500]);
  });
});

describe("REQ-679 panelAgreedTotal — the /quotes panel header", () => {
  it("REQ-679 (M19): the ledger's agreement total and its approved change orders", () => {
    const { panelAgreedTotal } = ledgerMod();
    expect(
      panelAgreedTotal(quote, {
        agreementTotalCents: 1_790_000,
        approvedChangeOrdersCents: 160_000,
      }),
    ).toEqual({ totalCents: 1_790_000, changeOrdersCents: 160_000 });
  });
  it("REQ-679: without a ledger, the card's approved change orders; else the bare quote", () => {
    const { panelAgreedTotal } = ledgerMod();
    expect(
      panelAgreedTotal({ ...quote, approvedChangeOrdersCents: 160_000 }, null),
    ).toEqual({ totalCents: 1_790_000, changeOrdersCents: 160_000 });
    expect(panelAgreedTotal(quote, null)).toEqual({
      totalCents: 1_630_000,
      changeOrdersCents: 0,
    });
  });
});

describe("REQ-679 wiring", () => {
  it("REQ-679 (M19): the panel header renders the agreed total with the 'incl.' line, not q.estimatedTotal", () => {
    const src = read("front-end/islands/QuotesPage.tsx");
    expect(src).not.toMatch(
      /class="qopen__amount">\{fmtMoney\(q\.estimatedTotal/,
    );
    expect(src).toMatch(/panelAgreedTotal\(q, state\.ledger\)/);
    expect(src).toMatch(/data-cy="quote-panel-incl-co"/);
    expect(src).toMatch(/quotesPage\.open\.inclChangeOrders/);
  });
  it("REQ-679 (M18): /i builds its schedule from the real installments", () => {
    const src = read("front-end/routes/i/[id].tsx");
    expect(src).toMatch(/installmentSchedule\(/);
  });
  it("REQ-679: the 'incl.' key exists in en and es with the same placeholder", () => {
    expect(en["quotesPage.open.inclChangeOrders"]).toMatch(/\{amount\}/);
    expect(es["quotesPage.open.inclChangeOrders"]).toMatch(/\{amount\}/);
  });
});
