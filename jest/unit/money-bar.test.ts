/**
 * REQ-798 — the dashboard's money bar: five buckets from quotes, jobs and invoices, the default
 * selection, and the dashboard's wiring of the band above the KPI tiles.
 */
import * as fs from "fs";
import * as path from "path";
import {
  buildMoneyBar,
  defaultBucket,
  MONEY_BUCKET_KEYS,
} from "../../shared/receivables/money-bar.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

const NOW = new Date("2026-11-13T15:00:00Z");

const quotes = [
  {
    id: "q-sent",
    status: "sent",
    estimatedTotal: 120_000,
    customerName: "Ana",
    number: "Q-001",
    sentAt: "2026-11-01T00:00:00Z",
  },
  {
    id: "q-won",
    status: "accepted",
    estimatedTotal: 500_000,
    customerName: "Bo",
    number: "Q-002",
  },
  {
    id: "q-sample",
    status: "sent",
    estimatedTotal: 999_999,
    isSample: true,
    customerName: "Sample",
  },
  { id: "q-draft", status: "draft", estimatedTotal: 5_000, customerName: "Cy" },
];
const jobs = [
  {
    id: "q-won",
    customer: { id: "c2", name: "Bo" },
    quote: { id: "q-won", summary: "Deck", estimatedTotalCents: 500_000 },
    totalCents: 500_000,
    paidCents: 0,
  },
];
const invoices = [
  {
    id: "i-overdue",
    status: "sent",
    amount: 50_000,
    dueDate: "2026-11-10",
    customerId: "c1",
    number: "INV-001",
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "i-open",
    status: "pending",
    amount: 30_000,
    paidCents: 10_000,
    dueDate: "2026-12-01",
    customerId: "c1",
    number: "INV-002",
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "i-today",
    status: "viewed",
    amount: 7_000,
    dueDate: "2026-11-13",
    customerId: "c1",
    number: "INV-003",
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "i-paid",
    status: "paid",
    amount: 65_000,
    paidCents: 65_000,
    paidAt: "2026-11-01T00:00:00Z",
    dueDate: "2026-10-01",
    customerId: "c1",
    number: "INV-004",
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "i-paid-old",
    status: "paid",
    amount: 1_000,
    paidAt: "2026-09-01T00:00:00Z",
    dueDate: "2026-08-01",
    customerId: "c1",
    number: "INV-005",
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "i-void",
    status: "void",
    amount: 99_000,
    dueDate: "2026-11-01",
    customerId: "c1",
    number: "INV-006",
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "i-draft",
    status: "draft",
    amount: 99_000,
    dueDate: "2026-11-01",
    customerId: "c1",
    number: "INV-007",
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "i-billed",
    status: "sent",
    quoteId: "q-won",
    amount: 200_000,
    dueDate: "2026-12-20",
    customerId: "c2",
    number: "INV-008",
    createdAt: "",
    updatedAt: "",
  },
];
const names = new Map([["c1", "Ana"], ["c2", "Bo"]]);

describe("REQ-798 money-bar — the five buckets", () => {
  const bar = buildMoneyBar({
    quotes,
    jobs,
    invoices,
    customerNames: names,
    now: NOW,
  });
  const by = Object.fromEntries(bar.buckets.map((b) => [b.key, b]));

  test("the buckets come in QuickBooks' order", () => {
    expect(bar.buckets.map((b) => b.key)).toEqual(MONEY_BUCKET_KEYS);
    expect(MONEY_BUCKET_KEYS).toEqual([
      "estimates",
      "unbilled",
      "overdue",
      "open",
      "paid",
    ]);
  });
  test("estimates = sent quotes, never the sample or a draft", () => {
    expect(by.estimates.count).toBe(1);
    expect(by.estimates.cents).toBe(120_000);
    expect(by.estimates.items[0]).toMatchObject({
      id: "q-sent",
      kind: "quote",
      title: "Ana",
      number: "Q-001",
      cents: 120_000,
      url: "/quotes?open=q-sent",
    });
  });
  test("unbilled = a won job's agreed total minus what has been invoiced against it", () => {
    expect(by.unbilled.count).toBe(1);
    expect(by.unbilled.cents).toBe(300_000);
    expect(by.unbilled.items[0]).toMatchObject({
      id: "q-won",
      kind: "job",
      title: "Bo",
      cents: 300_000,
      billedCents: 200_000,
      agreedCents: 500_000,
      url: "/quotes?open=q-won",
    });
  });
  test("overdue = open invoices past their due date, by balance; voids and drafts never count", () => {
    expect(by.overdue.count).toBe(1);
    expect(by.overdue.cents).toBe(50_000);
    expect(by.overdue.items[0]).toMatchObject({
      id: "i-overdue",
      kind: "invoice",
      daysOverdue: 3,
      cents: 50_000,
      url: "/invoices?open=i-overdue",
    });
  });
  test("open = open invoices due today or later, by balance (amount minus what was received)", () => {
    expect(by.open.items.map((i) => i.id)).toEqual([
      "i-today",
      "i-open",
      "i-billed",
    ]);
    expect(by.open.cents).toBe(7_000 + 20_000 + 200_000);
    expect(by.open.items[1]).toMatchObject({
      cents: 20_000,
      dueDate: "2026-12-01",
    });
  });
  test("recently paid = paid in the last 30 days, newest first", () => {
    expect(by.paid.items.map((i) => i.id)).toEqual(["i-paid"]);
    expect(by.paid.cents).toBe(65_000);
    expect(by.paid.items[0]).toMatchObject({ paidAt: "2026-11-01T00:00:00Z" });
  });
  test("the owed total is every open balance, overdue or not; the bar total is all five", () => {
    expect(bar.owedCents).toBe(50_000 + 227_000);
    expect(bar.totalCents).toBe(120_000 + 300_000 + 50_000 + 227_000 + 65_000);
  });
  test("a scheduled installment is a bill on the calendar: it counts against unbilled, and never as open", () => {
    const b = buildMoneyBar({
      quotes: [{
        id: "q",
        status: "accepted",
        estimatedTotal: 185_000,
        customerName: "Rosa",
      }],
      jobs: [{
        id: "q",
        customer: { id: "c", name: "Rosa" },
        quote: { id: "q", summary: "Door" },
        totalCents: 185_000,
      }],
      invoices: [
        {
          id: "p",
          status: "paid",
          quoteId: "q",
          amount: 92_500,
          paidCents: 92_500,
          paidAt: "2026-11-12T00:00:00Z",
          dueDate: "2026-11-13",
          createdAt: "",
          updatedAt: "",
        },
        {
          id: "s",
          status: "scheduled",
          quoteId: "q",
          amount: 92_500,
          dueDate: "2026-12-27",
          createdAt: "",
          updatedAt: "",
        },
      ],
      customerNames: names,
      now: NOW,
    });
    const by = Object.fromEntries(b.buckets.map((x) => [x.key, x]));
    expect(by.unbilled.cents).toBe(0);
    expect(by.open.count).toBe(0);
    expect(by.paid.cents).toBe(92_500);
  });
  test("an invoice stamped paidAt or with no balance is never open, whatever its status (REQ-397)", () => {
    const b = buildMoneyBar({
      quotes: [],
      jobs: [],
      customerNames: names,
      now: NOW,
      invoices: [
        {
          id: "a",
          status: "sent",
          amount: 100,
          paidAt: "2026-11-01T00:00:00Z",
          dueDate: "2026-10-01",
          createdAt: "",
          updatedAt: "",
        },
        {
          id: "b",
          status: "pending",
          amount: 100,
          paidCents: 100,
          dueDate: "2026-10-01",
          createdAt: "",
          updatedAt: "",
        },
      ],
    });
    expect(b.owedCents).toBe(0);
  });
  test("the overdue list is the most overdue first", () => {
    const b = buildMoneyBar({
      quotes: [],
      jobs: [],
      customerNames: names,
      now: NOW,
      invoices: [
        {
          id: "a",
          status: "sent",
          amount: 100,
          dueDate: "2026-11-12",
          createdAt: "",
          updatedAt: "",
        },
        {
          id: "b",
          status: "sent",
          amount: 100,
          dueDate: "2026-10-01",
          createdAt: "",
          updatedAt: "",
        },
      ],
    });
    expect(b.buckets[2].items.map((i) => i.id)).toEqual(["b", "a"]);
  });
});

describe("REQ-798 money-bar — the default selection", () => {
  test("the first non-empty of overdue, open, unbilled, estimates, paid; null when every bucket is empty", () => {
    const bar = buildMoneyBar({
      quotes,
      jobs,
      invoices,
      customerNames: names,
      now: NOW,
    });
    expect(defaultBucket(bar.buckets)).toBe("overdue");
    const noOverdue = buildMoneyBar({
      quotes,
      jobs,
      invoices: invoices.filter((i) => i.id !== "i-overdue"),
      customerNames: names,
      now: NOW,
    });
    expect(defaultBucket(noOverdue.buckets)).toBe("open");
    const onlyPaid = buildMoneyBar({
      quotes: [],
      jobs: [],
      invoices: invoices.filter((i) => i.id === "i-paid"),
      customerNames: names,
      now: NOW,
    });
    expect(defaultBucket(onlyPaid.buckets)).toBe("paid");
    const empty = buildMoneyBar({
      quotes: [],
      jobs: [],
      invoices: [],
      customerNames: names,
      now: NOW,
    });
    expect(defaultBucket(empty.buckets)).toBeNull();
  });
});

describe("REQ-798 money-bar — the dashboard wires it", () => {
  const page = read("front-end/islands/DashboardPage.tsx");
  const bar = read("front-end/components/MoneyBar.tsx");
  const css = read("front-end/static/dashboard.css");
  test("the dashboard fetches every invoice (not only status=pending) and renders the band above the KPI tiles", () => {
    expect(page).toMatch(/dashboardClient\.invoices\(\)/);
    expect(page).not.toMatch(/invoices\("pending"\)/);
    expect(page).not.toMatch(/invoices\("open"\)/);
    expect(page).not.toMatch(/quotesClient\.list\("sent"\)/);
    // REQ-473 / REQ-728 carried over: the upcoming line, the empty key, the skeleton
    expect(page).toMatch(/upcoming=\{upcomingLine\}/);
    expect(page).toMatch(/emptyKey=\{outstandingEmpty\}/);
    expect(page).toMatch(/pending=\{listsPending\}/);
    expect(bar).toMatch(/data-cy="money-upcoming"/);
    expect(bar).toMatch(/SkelBlock/);
    expect(page.indexOf("<MoneyBar")).toBeGreaterThan(-1);
    expect(page.indexOf("<MoneyBar")).toBeLessThan(page.indexOf("<Kpis"));
    expect(page).not.toMatch(/<Outstanding\b/);
  });
  test("the band: five columns and five segments as buttons, a list of rows that link to the document", () => {
    expect(bar).toMatch(/data-cy="money-col"/);
    expect(bar).toMatch(/data-cy="money-seg"/);
    expect(bar).toMatch(/data-cy="money-row"/);
    expect(bar).toMatch(/data-cy="money-owed"/);
    expect(bar).toMatch(/buildMoneyBar|MoneyBarData/);
    expect(bar).toMatch(/fmtMoney/);
    expect(bar).not.toMatch(/money__legend/);
  });
  test("the stylesheet carries the bar, the lifted selected segment and the dimmed rest", () => {
    for (
      const cls of [
        ".moneybar",
        ".moneybar__cols",
        ".moneybar__col",
        ".moneybar__seg",
        ".moneybar__seg--on",
        ".moneybar__row",
      ]
    ) {
      expect(css).toContain(cls);
    }
  });
  test("both languages carry every key", () => {
    const keys = [
      ...MONEY_BUCKET_KEYS.flatMap((
        k,
      ) => [`moneyBar.bucket.${k}.one`, `moneyBar.bucket.${k}.other`]),
      "moneyBar.empty",
      "moneyBar.viewAll",
      "moneyBar.hint",
      "moneyBar.paidOn",
      "moneyBar.sentOn",
      "moneyBar.unbilledOf",
      "outstanding.label",
      "outstanding.nudgeAll",
    ];
    for (const k of keys) {
      expect(en[k]).toBeTruthy();
      expect(es[k]).toBeTruthy();
    }
    for (
      const k of [
        "outstanding.legend.current",
        "outstanding.legend.mid",
        "outstanding.legend.overdue",
      ]
    ) {
      expect(en[k]).toBeUndefined();
      expect(es[k]).toBeUndefined();
    }
  });
});
