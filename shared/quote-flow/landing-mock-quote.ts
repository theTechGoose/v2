/**
 * REQ-412 — the landing page's ONE sample job (demo-loop cycle 2, m41).
 *
 * Every landing mock used to type its own money, and they drifted: the hero
 * card showed $4,200 + $3,990 + $1,950 under a $10,990 total. Now the line
 * items below (qty × unit price) are the only typed amounts; the subtotal, the
 * compact three-row card, the contract's payment schedule and the invoice
 * balance are all computed from them.
 *
 * Wiring sites: routes/index.tsx (hero card, hero phone bubble, and the
 * `window.__PM_MOCK_QUOTE` boot for static/landing-scripts.js — the Quote /
 * Contract / Invoice showcase and the scripted phone card), islands/PhoneChat.tsx.
 *
 * Money stays US-grouped in both languages ("$10,990"): the client is a US
 * customer, and "$ 10.990" reads as eleven dollars.
 */

export type MockLineId = "demo" | "cabinets" | "counters" | "labor";

export interface MockQuoteLine {
  id: MockLineId;
  qty: number;
  unitCents: number;
}

/** The sample kitchen remodel, in showcase order. */
export const MOCK_QUOTE_LINES: readonly MockQuoteLine[] = [
  { id: "demo", qty: 1, unitCents: 85_000 },
  { id: "cabinets", qty: 12, unitCents: 35_000 },
  { id: "counters", qty: 42, unitCents: 9_500 },
  { id: "labor", qty: 3, unitCents: 65_000 },
];

export const lineTotalCents = (l: MockQuoteLine): number => l.qty * l.unitCents;

const line = (id: MockLineId): MockQuoteLine => {
  const l = MOCK_QUOTE_LINES.find((x) => x.id === id);
  if (!l) throw new Error(`landing mock quote has no ${id} line`);
  return l;
};

const subtotalCents = MOCK_QUOTE_LINES.reduce(
  (a, l) => a + lineTotalCents(l),
  0,
);
/** Sales-tax estimate shown under the subtotal (~8%, rounded to $10). */
const taxCents = Math.round(subtotalCents * 0.08 / 1_000) * 1_000;
const depositCents = 250_000;
const progressCents = Math.round(subtotalCents / 2);
const changeOrderCents = 42_000;

export const MOCK_QUOTE = {
  subtotalCents,
  taxCents,
  estimateCents: subtotalCents + taxCents,
  /** Three-row card on the phone mocks: demolition and labor folded together. */
  compact: {
    cabinetsCents: lineTotalCents(line("cabinets")),
    countersCents: lineTotalCents(line("counters")),
    demoLaborCents: lineTotalCents(line("demo")) +
      lineTotalCents(line("labor")),
  },
  /** The signed contract's schedule; the final payment is the remainder. */
  contract: {
    depositCents,
    progressCents,
    finalCents: subtotalCents - depositCents - progressCents,
  },
  /** The closing invoice: the job + a change order − what was already paid. */
  invoice: {
    changeOrderCents,
    balanceCents: subtotalCents + changeOrderCents - depositCents -
      progressCents,
  },
} as const;

/** "$10,990" · `decimals` → "$10,990.00" · `spaced` → "$ 10,990". */
export function formatMockUsd(
  cents: number,
  opts: { decimals?: boolean; spaced?: boolean } = {},
): string {
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / 100).toString().replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ",",
  );
  const frac = opts.decimals ? `.${String(abs % 100).padStart(2, "0")}` : "";
  return `${cents < 0 ? "− " : ""}$${opts.spaced ? " " : ""}${whole}${frac}`;
}

export interface MockQuoteBoot {
  lines: Record<MockLineId, { qty: number; rate: string; amount: string }>;
  subtotal: string;
  tax: string;
  estimate: string;
  compact: { l1: string; l2: string; l3: string; total: string };
  contract: { deposit: string; progress: string; final: string; total: string };
  invoice: {
    completed: string;
    changeOrder: string;
    changeOrderRate: string;
    deposit: string;
    progress: string;
    balance: string;
  };
}

/** Pre-formatted figures for static/landing-scripts.js (`__PM_MOCK_QUOTE`). */
export function mockQuoteBoot(): MockQuoteBoot {
  const $ = (c: number) => formatMockUsd(c, { spaced: true });
  const lines = Object.fromEntries(
    MOCK_QUOTE_LINES.map((l) => [l.id, {
      qty: l.qty,
      rate: $(l.unitCents),
      amount: $(lineTotalCents(l)),
    }]),
  ) as MockQuoteBoot["lines"];
  const { compact, contract, invoice } = MOCK_QUOTE;
  return {
    lines,
    subtotal: $(subtotalCents),
    tax: $(taxCents),
    estimate: $(MOCK_QUOTE.estimateCents),
    compact: {
      l1: $(compact.cabinetsCents),
      l2: $(compact.countersCents),
      l3: $(compact.demoLaborCents),
      total: $(subtotalCents),
    },
    contract: {
      deposit: $(contract.depositCents),
      progress: $(contract.progressCents),
      final: $(contract.finalCents),
      total: $(subtotalCents),
    },
    invoice: {
      completed: $(subtotalCents),
      changeOrder: $(invoice.changeOrderCents),
      changeOrderRate: $(invoice.changeOrderCents),
      deposit: $(-contract.depositCents),
      progress: $(-contract.progressCents),
      balance: $(invoice.balanceCents),
    },
  };
}
