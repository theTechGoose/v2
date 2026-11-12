/**
 * REQ-404 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 2, issue m13: "Counts and headlines contradict data".
 * Pair 7 on /quotes read "$29,500 en trabajo en manos de los clientes" while
 * both quotes were unsent drafts (one with no customer), and "Top of the
 * pipeline: No open quotes yet" beside it. Pair 6 read "QUOTES PENDING 0 /
 * No quotes out yet" over a confirmed, ready-to-send Q-001.
 *
 * RCA: QuotesPage built the hero's `open` from DRAFT_TRACK_STAGES ∪
 * OUT_STAGES, so drafts counted as money "with clients". The dashboard's
 * sent-only count is right (REQ-320) — but its empty line must say the
 * drafts are there.
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  dashQuotesEmpty,
  quotesHeroNumbers,
} from "../../front-end/lib/headline-counts";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-404 (m13): the /quotes hero's money is what is actually with clients", () => {
  it("two unsent drafts ($29,500, the demo's case) are NOT money with clients — the hero is 'draftsOnly'", () => {
    const n = quotesHeroNumbers([
      { stage: "draft", value: 18000, customerId: "c1", client: "Ana" },
      { stage: "undelivered", value: 11500, customerId: null, client: "—" },
    ]);
    expect(n.mode).toBe("draftsOnly");
    expect(n.outCount).toBe(0);
    expect(n.outTotal).toBe(0);
    expect(n.outClients).toBe(0);
    expect(n.draftCount).toBe(2);
    expect(n.draftTotal).toBe(29500);
  });
  it("sent + drafts: the headline money and the client count come from the out quotes only; drafts are reported apart", () => {
    const n = quotesHeroNumbers([
      { stage: "sent", value: 5000, customerId: "c1", client: "Ana" },
      { stage: "opened", value: 2000, customerId: "c2", client: "Bo" },
      { stage: "draft", value: 9000, customerId: "c3", client: "Cy" },
      { stage: "won", value: 7000, customerId: "c4", client: "Di" },
    ]);
    expect(n.mode).toBe("warm");
    expect(n).toMatchObject({
      outCount: 2,
      outTotal: 7000,
      outClients: 2,
      draftCount: 1,
      draftTotal: 9000,
      staleCount: 0,
    });
  });
  it("a stale out quote still makes the 'stale' headline", () => {
    expect(
      quotesHeroNumbers([{ stage: "stale", value: 1, client: "Ana" }]).mode,
    ).toBe("stale");
  });
  it("only decided quotes → 'settled'; nothing at all → 'empty'", () => {
    expect(quotesHeroNumbers([{ stage: "won", value: 1 }]).mode).toBe(
      "settled",
    );
    expect(quotesHeroNumbers([]).mode).toBe("empty");
  });
  it("QuotesPage feeds the hero from quotesHeroNumbers, not a drafts ∪ out `open` list", () => {
    const src = read("front-end/islands/QuotesPage.tsx");
    expect(src).toMatch(/quotesHeroNumbers\(real\)/);
    expect(src).not.toMatch(
      /DRAFT_TRACK_STAGES\.includes\(q\.stage\)\s*\|\|\s*OUT_STAGES\.includes/,
    );
  });
  it("en + es carry the drafts-only headline and the drafting note, plural-aware", () => {
    for (const d of [en, es]) {
      for (
        const k of [
          "quotesHero.draftsOnlyTitle.one",
          "quotesHero.draftsOnlyTitle.other",
          "quotesHero.draftsOnlySub",
          "quotesHero.draftingNote",
          "quotesHero.drafts.one",
          "quotesHero.drafts.other",
        ]
      ) expect(d[k]).toBeTruthy();
    }
    expect(en["quotesHero.draftsOnlyTitle.other"]).toMatch(/nothing sent yet/i);
    expect(es["quotesHero.draftsOnlyTitle.other"]).toMatch(/nada enviad/i);
  });
});

describe("REQ-404 (m13): the dashboard's 'No quotes out yet' mentions ready-to-send drafts", () => {
  it("drafts waiting → the drafts line, with the count", () => {
    expect(dashQuotesEmpty({ draftCount: 1, hasDecidedHistory: false }))
      .toEqual({ key: "quotesAwaiting.emptyDrafts.one", n: 1 });
    expect(dashQuotesEmpty({ draftCount: 3, hasDecidedHistory: true }))
      .toEqual({ key: "quotesAwaiting.emptyDrafts.other", n: 3 });
  });
  it("no drafts → the old lines (REQ-320's sent-only count is unchanged)", () => {
    expect(dashQuotesEmpty({ draftCount: 0, hasDecidedHistory: false }).key)
      .toBe("quotesAwaiting.empty");
    expect(dashQuotesEmpty({ draftCount: 0, hasDecidedHistory: true }).key)
      .toBe("quotesAwaiting.emptyDecided");
  });
  it("DashboardPage passes the draft count; the KPI stays stats.quotes.sent", () => {
    const src = read("front-end/islands/DashboardPage.tsx");
    expect(src).toMatch(/draftCount=\{stats\?\.quotes\.draft \?\? 0\}/);
    expect(src).toMatch(/pendingQuotes: stats\?\.quotes\.sent \?\? 0/);
  });
  it("en + es say the drafts are ready to send", () => {
    expect(en["quotesAwaiting.emptyDrafts.one"]).toMatch(/ready to send/);
    expect(en["quotesAwaiting.emptyDrafts.other"]).toMatch(/ready to send/);
    expect(es["quotesAwaiting.emptyDrafts.one"]).toMatch(/listo para enviar/);
    expect(es["quotesAwaiting.emptyDrafts.other"]).toMatch(
      /listos para enviar/,
    );
  });
});
