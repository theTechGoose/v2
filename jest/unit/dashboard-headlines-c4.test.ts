/**
 * REQ-566 (demo-loop cycle 4, m11) — "Dashboard/page headlines contradict
 * real state". The 20-agent demo saw, in its own words:
 *
 *   (b) "Semana tranquila — $450 llegan la próxima semana." beside
 *       ENVIADAS PARA COBRO $100,000,449 (pair 10)
 *   (c) "QUOTES PENDING 0 — No quotes out yet — 1 draft is ready to send."
 *       right after pressing Send on a quote to a 555 number (pair 3)
 *   (d) "Aún no hay cotizaciones enviadas" on first paint, then "1 enviadas"
 *       (ungrammatical) (pair 6)
 *
 * (a) "What we handled today — Nothing yet" is the backend feed's half
 * (notify-on-event test.ts + owner-activity.int.test.ts); the front-end side
 * is that the feed's new row types have an icon.
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  dashQuotesEmpty,
  invoicesHeroMode,
  quotesPendingSub,
} from "../../front-end/lib/headline-counts";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

const none = { thisWeekCents: 0, nextWeekCents: 0, atRiskCents: 0 };

describe("REQ-566 (b): the quiet-week line never hides more money out", () => {
  it("$450 next week beside $100,000,449 outstanding → the 'outstanding' headline, not 'Quiet week'", () => {
    expect(
      invoicesHeroMode({
        totalInvoiceCount: 2,
        outstandingCount: 2,
        claimedCount: 0,
        outstandingCents: 100_000_449_00,
        forecast: { ...none, nextWeekCents: 450_00 },
      }),
    ).toBe("outstanding");
  });
  it("when next week IS all that is out, the quiet line stays (fleet-0: $1,425 of $1,425)", () => {
    expect(
      invoicesHeroMode({
        totalInvoiceCount: 1,
        outstandingCount: 1,
        claimedCount: 0,
        outstandingCents: 1_425_00,
        forecast: { ...none, nextWeekCents: 1_425_00 },
      }),
    ).toBe("nextWeek");
  });
  it("the /invoices hero passes its outstanding total to the rule", () => {
    const src = read("front-end/islands/InvoicesPage.tsx");
    const at = src.indexOf("const mode = invoicesHeroMode({");
    expect(at).toBeGreaterThan(0);
    const call = src.slice(at, src.indexOf("});", at));
    expect(call).toMatch(/outstandingCents: outstandingTotal/);
  });
});

describe("REQ-566 (c): a quote whose send reached nobody reads 'Not delivered', not 'draft ready'", () => {
  it("the dashboard's empty line names the undelivered quote", () => {
    expect(
      dashQuotesEmpty({
        draftCount: 1,
        undeliveredCount: 1,
        hasDecidedHistory: false,
      }),
    ).toEqual({ key: "quotesAwaiting.emptyUndelivered.one", n: 1 });
    expect(
      dashQuotesEmpty({
        draftCount: 3,
        undeliveredCount: 2,
        hasDecidedHistory: false,
      }),
    ).toEqual({ key: "quotesAwaiting.emptyUndelivered.other", n: 2 });
  });
  it("drafts never sent keep the 'ready to send' line (REQ-404)", () => {
    expect(
      dashQuotesEmpty({
        draftCount: 1,
        undeliveredCount: 0,
        hasDecidedHistory: false,
      }),
    ).toEqual({ key: "quotesAwaiting.emptyDrafts.one", n: 1 });
  });
  it("the Quotes pending KPI sub-line says 'Not delivered (n)' when nothing is in flight", () => {
    expect(quotesPendingSub({ pendingTotalCents: 0, undeliveredCount: 1 }))
      .toEqual({ key: "kpis.quotesPending.notDelivered", n: 1 });
    expect(quotesPendingSub({ pendingTotalCents: 45000, undeliveredCount: 1 }))
      .toEqual({ key: "kpis.quotesPending.inFlight", n: 0 });
    expect(quotesPendingSub({ pendingTotalCents: 0, undeliveredCount: 0 }))
      .toBeNull();
    const ds = read("front-end/components/DashSections.tsx");
    expect(ds).toMatch(/quotesPendingSub\(/);
    expect(en["kpis.quotesPending.notDelivered"]).toBe("Not delivered ({n})");
    expect(es["kpis.quotesPending.notDelivered"]).toBe("Sin entregar ({n})");
  });
  it("the dashboard reads the undelivered count from the stats", () => {
    const src = read("front-end/islands/DashboardPage.tsx");
    expect(src).toMatch(
      /undeliveredCount=\{stats\?\.quotes\.undelivered \?\? 0\}/,
    );
    expect(src).toMatch(
      /undeliveredQuotes=\{stats\?\.quotes\.undelivered \?\? 0\}/,
    );
    expect(read("front-end/clients/dashboard.ts")).toMatch(
      /undelivered\?: number;/,
    );
  });
  it("en + es lines exist and match", () => {
    for (const k of ["one", "other"]) {
      const key = `quotesAwaiting.emptyUndelivered.${k}`;
      expect(en[key]).toMatch(/not delivered/i);
      expect(es[key]).toMatch(/no se entreg/i);
      expect(en[key]).toContain("{n}");
      expect(es[key]).toContain("{n}");
    }
  });
});

describe("REQ-566 (d): the 'awaiting signature' panel never claims 'none sent' before its list loads", () => {
  it("QuotesAwaiting takes a pending flag and DashboardPage passes it until the lists land", () => {
    const ds = read("front-end/components/DashSections.tsx");
    const start = ds.indexOf("export function QuotesAwaiting(");
    const body = ds.slice(start, ds.indexOf("export function ", start + 1));
    expect(body).toMatch(/pending/);
    expect(body).toMatch(/empty && !pending/);
    const page = read("front-end/islands/DashboardPage.tsx");
    expect(page).toMatch(/pending=\{!s\.listsLoaded\}/);
  });
  it("the es count is grammatical for one ('1 enviadas' is gone)", () => {
    expect(es["quotesAwaiting.count"]).not.toMatch(/^\{n\} enviadas/);
    expect(es["quotesAwaiting.count"]).toContain("{n}");
    expect(es["quotesAwaiting.count"]).toContain("${total}");
  });
});

describe("REQ-566 (a): the owner-side feed rows have their own icon and keys", () => {
  it("NOTIF_ICON covers invoice_sent and task_completed; the client union has them", () => {
    const page = read("front-end/islands/DashboardPage.tsx");
    expect(page).toMatch(/invoice_sent:\s*\{/);
    expect(page).toMatch(/task_completed:\s*\{/);
    const client = read("front-end/clients/dashboard.ts");
    expect(client).toMatch(/"invoice_sent"/);
    expect(client).toMatch(/"task_completed"/);
  });
  it("every new notify key is in en and es with the same placeholders", () => {
    const keys = [
      "notify.invoice.issued",
      "notify.invoice.issuedAmount",
      "notify.payment.recorded",
      "notify.payment.recordedAmount",
      "notify.task.completed",
      "notify.task.completedBy",
    ];
    const ph = (s: string) => (s.match(/\{[a-z]+\}/g) ?? []).sort();
    for (const k of keys) {
      expect(en[k]).toBeDefined();
      expect(es[k]).toBeDefined();
      expect(ph(es[k])).toEqual(ph(en[k]));
    }
  });
});
