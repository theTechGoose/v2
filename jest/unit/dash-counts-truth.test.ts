/**
 * REQ-698 (demo-loop cycle 5, demo issue m14) — "Dashboard and Quotes counts
 * disagree with the real state".
 *
 *  (1) pair 10: "QUOTES PENDING 0 … 1 draft is ready to send" while the draft
 *      was still mid-wizard — the line worded EVERY draft as ready.
 *  (2) pair 3: the menu badge "Cotizaciones 1" next to "En espera de
 *      respuesta 0" — the customer signed in another tab, /quotes re-read its
 *      own list from the change feed, but the sidebar kept its mount snapshot
 *      (nothing on the page called refreshDash()).
 */
import * as fs from "fs";
import * as path from "path";
import { dashQuotesEmpty } from "../../front-end/lib/headline-counts";
import { followBadgeChanges } from "../../front-end/lib/sidebar-counts";
import { _resetChangeFeedForTest } from "../../front-end/lib/change-feed";
import { _setChangeChannelForTest } from "../../front-end/lib/change-announce";
import { _resetNotificationsForTest } from "../../front-end/lib/notifications-feed";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json"));
const es = JSON.parse(read("lang/es.json"));

const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};

describe("REQ-698 (cycle 5, m14) the dashboard's empty line says 'ready to send' only for drafts whose wizard finished", () => {
  test("pair 10: one draft, mid-wizard → 'in progress', never 'ready to send'", () => {
    expect(
      dashQuotesEmpty({
        draftCount: 1,
        readyCount: 0,
        hasDecidedHistory: false,
      }),
    ).toEqual({ key: "quotesAwaiting.emptyInProgress.one", n: 1 });
    expect(
      dashQuotesEmpty({
        draftCount: 3,
        readyCount: 0,
        hasDecidedHistory: true,
      }),
    ).toEqual({ key: "quotesAwaiting.emptyInProgress.other", n: 3 });
  });

  test("a finished draft is named ready, counting only the ready ones", () => {
    expect(
      dashQuotesEmpty({
        draftCount: 3,
        readyCount: 1,
        hasDecidedHistory: false,
      }),
    ).toEqual({ key: "quotesAwaiting.emptyDrafts.one", n: 1 });
  });

  test("the in-progress copy exists in en and es and does not say ready", () => {
    for (const k of ["one", "other"]) {
      const e = en[`quotesAwaiting.emptyInProgress.${k}`];
      const s = es[`quotesAwaiting.emptyInProgress.${k}`];
      expect(e).toMatch(/\{n\}/);
      expect(s).toMatch(/\{n\}/);
      expect(e).toMatch(/in progress/i);
      expect(s).toMatch(/en curso|en progreso/i);
      expect(e).not.toMatch(/ready/i);
      expect(s).not.toMatch(/listo/i);
    }
  });

  test("DashboardPage passes the server's readyToSend count", () => {
    const page = read("front-end/islands/DashboardPage.tsx");
    expect(page).toMatch(/readyCount=\{stats\?\.quotes\.readyToSend\}/);
    const sections = read("front-end/components/DashSections.tsx");
    expect(sections).toMatch(/readyCount,/);
  });
});

describe("REQ-698 (cycle 5, m14) the sidebar badge follows the change feed", () => {
  afterEach(() => {
    _resetChangeFeedForTest();
    _setChangeChannelForTest();
    _resetNotificationsForTest();
  });

  test("a quote/invoice change re-reads the badge counts; other changes do not", async () => {
    const ls = new Set<(items: unknown[]) => void>();
    _setChangeChannelForTest(() => null);
    _resetChangeFeedForTest({
      since: 0,
      win: null,
      subscribeFeed: (fn) => {
        ls.add(fn as (items: unknown[]) => void);
        return () => {
          ls.delete(fn as (items: unknown[]) => void);
        };
      },
    });
    let reads = 0;
    const stop = followBadgeChanges(() => {
      reads++;
    });
    const push = (items: unknown[]) => {
      for (const fn of [...ls]) fn(items);
    };
    const note = (id: string, entityType: string) => ({
      id,
      userId: "u1",
      type: "generic",
      title: id,
      read: false,
      createdAt: "2026-11-12T19:05:37Z",
      entityType,
      entityId: `${entityType}-1`,
    });
    push([note("n1", "quote")]); // Maria signed Q-001 in another tab
    await flush();
    expect(reads).toBe(1);
    push([note("n2", "customer"), note("n1", "quote")]);
    await flush();
    expect(reads).toBe(1);
    stop();
  });

  test("DashSidebar re-reads the dash on a document change", () => {
    const src = read("front-end/islands/DashSidebar.tsx");
    expect(src).toMatch(/followBadgeChanges\(\s*\(\)\s*=>\s*refreshDash\(\)/);
  });
});
