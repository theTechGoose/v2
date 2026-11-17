/**
 * REQ-728 — demo-loop cycle 5, issue m15 "Wrong data flashes before the page
 * loads". The demo saw "Active jobs 0", "No jobs in flight yet…" and the
 * Outstanding empty line on a warm dashboard start, and "No users found." on
 * /admin, before the data had arrived.
 *
 * The first render is what SSR (and the first client paint) shows, so these
 * tests render the islands to a string — no effect has run, nothing has
 * loaded — and assert no panel claims "none".
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import DashboardPage from "../islands/DashboardPage.tsx";
import AdminPage from "../islands/AdminPage.tsx";
import { _resetForTest } from "./dash-cache.ts";
import {
  _resetNotificationsForTest,
  notificationsLoaded,
  refreshNotifications,
} from "./notifications-feed.ts";
import { langSignal, tFor } from "./i18n.ts";
import type { DashboardStats } from "../clients/dashboard.ts";

// A cached snapshot of a user who has open invoices but whose lists have not
// landed yet (the warm start DashboardPage takes from the shared dash cache).
const STATS: DashboardStats = {
  customers: 2,
  quotes: { total: 3, draft: 0, sent: 1, accepted: 2 },
  invoices: {
    total: 0,
    pending: 0,
    paid: 0,
    overdue: 0,
    agingBuckets: {
      current: 0,
      aging1_14d: 0,
      overdue15_30d: 0,
      overdue30plus: 0,
    },
  },
  quotedValueCents: 50_000,
  awaitingResponse: 1,
  revenue: {
    ytdCents: 0,
    lastMonthCents: 0,
    monthOverMonthPct: 0,
    sparkline12mo: [],
  },
  payments: { receivedYtdCents: 0, methodMixCents: {}, topPayors: [] },
} as unknown as DashboardStats;

// the islands render in the live UI language; pin it so the copy checks match
langSignal.value = "en";

function withWarmCache<T>(fn: () => T): T {
  // Deno's own sessionStorage is the store readCached() falls back to.
  _resetForTest();
  sessionStorage.setItem(
    "pm:dash-cache:v1",
    JSON.stringify({ stats: STATS, profile: null }),
  );
  try {
    return fn();
  } finally {
    _resetForTest();
  }
}

function text(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html")!;
  return (doc.body?.textContent ?? "").replace(/\s+/g, " ");
}

Deno.test("REQ-728 (m15): a warm dashboard start shows no 'no jobs' line before the lists land", () => {
  const html = withWarmCache(() => renderToString(<DashboardPage />));
  const body = text(html);
  // the warm start really rendered the dashboard, not the cold skeleton
  assert(
    body.includes(tFor("en", "kpis.quotesPending.label")),
    "warm start should paint the KPIs from the cache",
  );
  assert(
    !body.includes(tFor("en", "activeJobs.empty.text")),
    "Active jobs panel claimed 'no jobs' before the jobs list loaded",
  );
  assert(
    !body.includes(tFor("en", "outstanding.empty.noInvoices")) &&
      !body.includes(tFor("en", "outstanding.empty.allPaid")),
    "Outstanding claimed empty before the invoice lists loaded",
  );
});

Deno.test("REQ-728 (m15): the Active jobs KPI does not read 0 before the jobs list lands", () => {
  const html = withWarmCache(() => renderToString(<DashboardPage />));
  const doc = new DOMParser().parseFromString(html, "text/html")!;
  const label = tFor("en", "kpis.activeJobs.label");
  const kpi = Array.from(doc.querySelectorAll(".kpi")).find((k) =>
    // deno-lint-ignore no-explicit-any
    (k as any).querySelector(".kpi__label")?.textContent === label
  );
  assert(kpi, "Active jobs KPI rendered");
  // deno-lint-ignore no-explicit-any
  const val = (kpi as any).querySelector(".kpi__val");
  assertEquals(val?.textContent?.trim(), "", "KPI value is a placeholder");
  assertEquals(val?.getAttribute("aria-busy"), "true");
  // and the panel header does not count "0 active"
  const panelCount = doc.querySelector(".panel .panel__count");
  assert(
    !/\b0\b/.test(panelCount?.textContent ?? ""),
    `panel count read "${panelCount?.textContent}" before the list loaded`,
  );
});

Deno.test("REQ-728 (m15): /admin does not say 'No users found.' before the first search resolves", () => {
  const body = text(renderToString(<AdminPage selfId="u-admin" />));
  assert(
    !body.includes(tFor("en", "adminPage.empty")),
    "'No users found.' rendered before any search ran",
  );
  assert(
    body.includes(tFor("en", "adminPage.loading")),
    "the first paint says it is loading users",
  );
});

// REQ-757 (demo-loop cycle 5v2, m15 re-test): the verifier sampled a fresh
// /dashboard load on an account WITH activity every ~15 ms and saw the
// Activity panel read "Nothing yet — your activity will land here." for
// ~150 ms before the notifications feed resolved. The panel reads the shared
// notifications feed, which is empty until its first refresh lands — so the
// first paint must be a skeleton, not the empty line.
Deno.test("REQ-757 (m15, 5v2): Activity does not say 'Nothing yet' before the notifications feed first loads", () => {
  _resetNotificationsForTest(() => new Promise<never>(() => {}));
  try {
    const html = withWarmCache(() => renderToString(<DashboardPage />));
    const doc = new DOMParser().parseFromString(html, "text/html")!;
    const panel = doc.querySelector("#activity");
    assert(panel, "Activity panel rendered on the warm start");
    const body = (panel.textContent ?? "").replace(/\s+/g, " ");
    assert(
      !body.includes(tFor("en", "activity.emptySub")),
      "Activity claimed 'Nothing yet' before the notifications feed loaded",
    );
    assert(
      panel.querySelector('[aria-busy="true"]'),
      "Activity shows a busy skeleton while the feed loads",
    );
  } finally {
    _resetNotificationsForTest();
  }
});

Deno.test("REQ-757 (m15, 5v2): once the feed has loaded empty, Activity says 'Nothing yet'", async () => {
  _resetNotificationsForTest(() => Promise.resolve([]));
  try {
    await refreshNotifications();
    assert(notificationsLoaded(), "the feed reports it has loaded");
    const html = withWarmCache(() => renderToString(<DashboardPage />));
    const doc = new DOMParser().parseFromString(html, "text/html")!;
    const panel = doc.querySelector("#activity")!;
    assert(
      (panel.textContent ?? "").includes(tFor("en", "activity.emptySub")),
      "a truly empty, loaded feed still shows the empty line",
    );
    assert(!panel.querySelector('[aria-busy="true"]'));
  } finally {
    _resetNotificationsForTest();
  }
});

Deno.test("REQ-757 (m15, 5v2): a failed first feed load ends the skeleton too", async () => {
  _resetNotificationsForTest(() => Promise.reject(new Error("offline")));
  try {
    assert(!notificationsLoaded());
    await refreshNotifications().catch(() => {});
    assert(
      notificationsLoaded(),
      "a settled (failed) load is no longer pending",
    );
  } finally {
    _resetNotificationsForTest();
  }
});
