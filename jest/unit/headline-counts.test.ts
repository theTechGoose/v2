/**
 * REQ-243 — demo issue quote-invoice-money-m3: "Counts and headlines contradict
 * the lists". The 20-agent demo saw, in its own words:
 *
 *   (a) "1 cotización abierta en 0 clientes" over Maria Lopez's card (pair 2)
 *   (b) "Out for response — 1 quote" over two cards (pair 3)
 *   (c) "0 jobs in flight" with a $28,500 quote out (pair 7)
 *   (d) "Todo en orden — nada pendiente." over a waiting claim (pair 9)
 *   (e) a stale /invoices hero after "Payment received" (pair 1)
 *
 * RCA (demo-rca.md, quote-invoice-money-m3): (a) clientCount read customerId
 * only while the card's name falls back to the summary; (b) the track count is
 * real quotes only but the sample card renders too; (c) activeJobs counts
 * SIGNED quotes and the label did not say so; (d) the hero's outstandingCount
 * was overdue + out — "claimed" was in neither, so a claim read as all clear;
 * (e) refreshInvoices re-pulled the list but never the forecast.
 *
 * The derivations live in front-end/lib/headline-counts.ts; the islands are
 * bound to them below.
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  countOpenClients,
  invoicesHeroMode,
  outTrackCounts,
  reloadInvoiceData,
} from "../../front-end/lib/headline-counts";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-243 (a): the hero's client count reads the same field the card shows", () => {
  it("a quote with no customerId but a named card counts as one client (not '1 quote across 0 clients')", () => {
    expect(countOpenClients([{ customerId: null, client: "Maria Lopez" }]))
      .toBe(1);
  });
  it("a linked quote and an unlinked one with the same name are still distinct customer ids only when linked", () => {
    expect(
      countOpenClients([
        { customerId: "c1", client: "Maria Lopez" },
        { customerId: "c1", client: "Maria Lopez" },
        { customerId: null, client: "Joe Ruiz" },
        { customerId: null, client: "  joe ruiz " },
      ]),
    ).toBe(2);
  });
  it("two unlinked placeholder ('—') quotes never collapse into a phantom client (#31)", () => {
    expect(
      countOpenClients([
        { customerId: null, client: "—" },
        { customerId: undefined, client: "" },
        { customerId: null, client: null },
      ]),
    ).toBe(0);
  });
  it("QuotesPage feeds QuotesHero from countOpenClients, not a customerId-only Set", () => {
    // REQ-404 (m13): the count runs inside quotesHeroNumbers, over the OUT
    // quotes only — still countOpenClients, never a customerId-only Set.
    const src = read("front-end/islands/QuotesPage.tsx");
    expect(src).toMatch(/clientCount=\{heroNums\.outClients\}/);
    expect(read("front-end/lib/headline-counts.ts")).toMatch(
      /outClients: countOpenClients\(out\)/,
    );
  });
});

describe("REQ-243 (b): 'Out for response' says the sample is there instead of '1 quote' over 2 cards", () => {
  it("outTrackCounts splits real quotes from the badged sample", () => {
    expect(
      outTrackCounts([{ isSample: false }, { isSample: true }, {}]),
    ).toEqual({ real: 2, sample: 1 });
  });
  it("QuoteTrack renders a '+ sample' suffix and QuotesPage passes the sample count", () => {
    expect(read("front-end/islands/QuoteTrack.tsx")).toMatch(
      /quoteTrack\.count\.plusSample/,
    );
    expect(read("front-end/islands/QuotesPage.tsx")).toMatch(
      /sampleCount=\{outCounts\.sample\}/,
    );
  });
  it("both languages carry the suffix, with no digit (the KPI-equals-track check reads the first number)", () => {
    for (const d of [en, es]) {
      expect(d["quoteTrack.count.plusSample"]).toBeTruthy();
      expect(d["quoteTrack.count.plusSample"]).not.toMatch(/\d/);
    }
  });
});

describe("REQ-243 (c): the clients hero says the jobs it counts are SIGNED ones", () => {
  it("en and es name signed jobs", () => {
    expect(en["clientsHero.jobsInFlight.one"]).toMatch(/signed/i);
    expect(en["clientsHero.jobsInFlight.other"]).toMatch(/signed/i);
    expect(es["clientsHero.jobsInFlight.one"]).toMatch(/firmado/i);
    expect(es["clientsHero.jobsInFlight.other"]).toMatch(/firmados/i);
  });
});

describe("REQ-243 (d): a waiting claim is never 'All clear'", () => {
  const none = { thisWeekCents: 0, nextWeekCents: 0, atRiskCents: 0 };
  it("a claim-only state with an empty forecast is 'claimed', not 'clear'", () => {
    expect(
      invoicesHeroMode({
        totalInvoiceCount: 1,
        outstandingCount: 0,
        claimedCount: 1,
        forecast: none,
      }),
    ).toBe("claimed");
  });
  it("a claim outranks the forecast when nothing else is owed", () => {
    expect(
      invoicesHeroMode({
        totalInvoiceCount: 2,
        outstandingCount: 0,
        claimedCount: 2,
        forecast: { ...none, thisWeekCents: 5000 },
      }),
    ).toBe("claimed");
  });
  it("truly nothing pending is still 'clear'; no invoices is still 'empty'", () => {
    expect(
      invoicesHeroMode({
        totalInvoiceCount: 3,
        outstandingCount: 0,
        claimedCount: 0,
      }),
    ).toBe("clear");
    expect(
      invoicesHeroMode({
        totalInvoiceCount: 0,
        outstandingCount: 0,
        claimedCount: 0,
      }),
    ).toBe("empty");
  });
  it("money still owed keeps the forecast / outstanding headlines", () => {
    expect(
      invoicesHeroMode({
        totalInvoiceCount: 2,
        outstandingCount: 1,
        claimedCount: 1,
        forecast: { ...none, thisWeekCents: 100 },
      }),
    ).toBe("thisWeek");
    // REQ-697 (cycle 5, m13): an open bill due next week is never "Quiet week"
    expect(
      invoicesHeroMode({
        totalInvoiceCount: 2,
        outstandingCount: 1,
        claimedCount: 0,
        forecast: { ...none, nextWeekCents: 100 },
      }),
    ).toBe("outstanding");
    expect(
      invoicesHeroMode({
        totalInvoiceCount: 2,
        outstandingCount: 1,
        claimedCount: 0,
      }),
    ).toBe("outstanding");
  });
  it("InvoicesPage passes the claimed count to the hero and both languages carry its copy", () => {
    const src = read("front-end/islands/InvoicesPage.tsx");
    expect(src).toMatch(/claimedCount=\{claimed\.length\}/);
    expect(src).toMatch(/invoicesHeroMode\(/);
    for (const d of [en, es]) {
      for (
        const k of [
          "invoicesPage.hero.claimed.one",
          "invoicesPage.hero.claimed.other",
          "invoicesPage.hero.claimedEm",
          "invoicesPage.sub.claimed",
        ]
      ) expect(d[k]).toBeTruthy();
    }
  });
});

describe("REQ-243 (e): a refresh after 'Payment received' re-pulls the forecast too", () => {
  it("reloadInvoiceData fetches both the list and the forecast", async () => {
    const calls: string[] = [];
    const r = await reloadInvoiceData({
      invoices: () => {
        calls.push("invoices");
        return Promise.resolve(["i1"]);
      },
      forecast: () => {
        calls.push("forecast");
        return Promise.resolve({ thisWeekCents: 0 });
      },
    });
    expect(calls.sort()).toEqual(["forecast", "invoices"]);
    expect(r).toEqual({ invoices: ["i1"], forecast: { thisWeekCents: 0 } });
  });
  it("a failing forecast keeps the fresh list (and vice versa)", async () => {
    const r = await reloadInvoiceData({
      invoices: () => Promise.resolve(["i1"]),
      forecast: () => Promise.reject(new Error("404")),
    });
    expect(r).toEqual({ invoices: ["i1"], forecast: undefined });
    const r2 = await reloadInvoiceData({
      invoices: () => Promise.reject(new Error("500")),
      forecast: () => Promise.resolve({ thisWeekCents: 1 }),
    });
    expect(r2).toEqual({ invoices: undefined, forecast: { thisWeekCents: 1 } });
  });
  it("InvoicesPage's refreshInvoices goes through reloadInvoiceData", () => {
    const src = read("front-end/islands/InvoicesPage.tsx");
    const body = src.slice(
      src.indexOf("async function refreshInvoices"),
      src.indexOf("useEffect(", src.indexOf("async function refreshInvoices")),
    );
    expect(body).toMatch(/reloadInvoiceData\(/);
    expect(body).toMatch(/setForecast\(/);
  });
});

describe("REQ-317: a scheduled installment of a signed agreement is never 'All clear' (demo-loop cycle 1, M33)", () => {
  const none = { thisWeekCents: 0, nextWeekCents: 0, atRiskCents: 0 };
  it("the 50/50 case: deposit paid, $1,600 balance scheduled → 'scheduled', not 'clear'", () => {
    expect(
      invoicesHeroMode({
        totalInvoiceCount: 2,
        outstandingCount: 0,
        claimedCount: 0,
        scheduledCount: 1,
        scheduledCents: 160_000,
        forecast: none,
      }),
    ).toBe("scheduled");
  });
  it("a claim waiting for confirmation still outranks the scheduled balance", () => {
    expect(
      invoicesHeroMode({
        totalInvoiceCount: 2,
        outstandingCount: 0,
        claimedCount: 1,
        scheduledCount: 1,
        scheduledCents: 160_000,
        forecast: none,
      }),
    ).toBe("claimed");
  });
  it("money overdue / out / expected keeps its own headline over the scheduled one", () => {
    expect(
      invoicesHeroMode({
        totalInvoiceCount: 2,
        outstandingCount: 1,
        claimedCount: 0,
        scheduledCount: 1,
        scheduledCents: 160_000,
        forecast: { ...none, thisWeekCents: 160_000 },
      }),
    ).toBe("thisWeek");
    expect(
      invoicesHeroMode({
        totalInvoiceCount: 2,
        outstandingCount: 1,
        claimedCount: 0,
        scheduledCount: 1,
        scheduledCents: 160_000,
      }),
    ).toBe("outstanding");
  });
  it("a scheduled row carrying no money, or none at all, is still 'clear'", () => {
    expect(
      invoicesHeroMode({
        totalInvoiceCount: 2,
        outstandingCount: 0,
        claimedCount: 0,
        scheduledCount: 1,
        scheduledCents: 0,
      }),
    ).toBe("clear");
    expect(
      invoicesHeroMode({
        totalInvoiceCount: 1,
        outstandingCount: 0,
        claimedCount: 0,
        scheduledCount: 0,
        scheduledCents: 0,
      }),
    ).toBe("clear");
  });
  it("InvoicesPage feeds the hero the scheduled money and next date; en + es carry the copy", () => {
    const src = read("front-end/islands/InvoicesPage.tsx");
    expect(src).toMatch(/scheduledCount=\{scheduled\.length\}/);
    expect(src).toMatch(/scheduledCents=\{scheduledTotal\}/);
    expect(src).toMatch(/nextScheduledFor=/);
    for (const d of [en, es]) {
      for (
        const k of [
          "invoicesPage.hero.scheduled",
          "invoicesPage.sub.scheduledNext",
          "invoicesPage.unitScheduled.one",
          "invoicesPage.unitScheduled.other",
        ]
      ) expect(d[k]).toBeTruthy();
    }
    // REQ-697 (cycle 5, m13): scheduled money is named as scheduled, unsent
    expect(en["invoicesPage.hero.scheduled"]).toMatch(
      /^\{amount\} scheduled — not sent yet\.$/,
    );
    expect(es["invoicesPage.hero.scheduled"]).toMatch(
      /^\{amount\} programado — aún sin enviar\.$/,
    );
  });
});
