/**
 * Top-level data island for /dashboard. The SSR route renders only the
 * page shell; this island fans out the dashboard fetches in parallel and
 * assembles the hero, KPIs, jobs row, quotes row, activity feed, and
 * outstanding list.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import {
  type Customer,
  dashboardClient,
  type DashboardStats,
  type Invoice,
  type Job,
  type Notification,
} from "../clients/dashboard.ts";
import { type QuoteCard, quotesClient } from "../clients/quotes.ts";
import {
  ActiveJobs,
  Activity,
  type ActivityEntry,
  type JobRow,
  Kpis,
  type QuoteRow,
  QuotesAwaiting,
} from "../components/DashSections.tsx";
import { I, ICN, type IconName } from "../lib/dash-icons.tsx";
import { MoneyBar } from "../components/MoneyBar.tsx"; // REQ-798
import { buildMoneyBar } from "../../shared/receivables/money-bar.ts";
import { fmtMoney } from "../lib/format.ts";
import { dueDateLine } from "../../shared/quote-flow/pipeline-stats.ts";
import { readCached, refreshDash } from "../lib/dash-cache.ts";
import { holdHashTarget } from "../lib/dash-anchor.ts";
import { pickKpis } from "../lib/dashboard-kpis.ts";
import { jobRowTitle, quoteRowTitle } from "../lib/dashboard-titles.ts";
import {
  jobPaidLabel,
  nextUpcomingBill,
  outstandingEmptyKey,
} from "../lib/dashboard-receivables.ts";
import {
  notificationsLoaded,
  readNotifications,
  refreshNotifications,
  subscribeNotifications,
} from "../lib/notifications-feed.ts";
import { notificationHref } from "../lib/quote-inquiries.ts"; // REQ-701
import { ShimmerStyle, SkelBlock } from "../components/Skeletons.tsx";
import SetupChecklist from "./SetupChecklist.tsx";
import { type Lang, langSignal, tFor } from "../lib/i18n.ts";

// Toll-free support line (REQ-044: one shared source with the site footer,
// the landings and /contact). A call here hits the Twilio Studio Flow that
// texts a heads-up, plays a brief hold, then forwards to the support cell.
import {
  SUPPORT_PHONE_DISPLAY,
  SUPPORT_PHONE_HREF,
} from "../../shared/legal/contact.ts";

function shortMonth(lang: Lang, monthIdx: number): string {
  return tFor(lang, `common.monthShort.${monthIdx}`);
}
function shortDay(lang: Lang, dayIdx: number): string {
  return tFor(lang, `common.dayShort.${dayIdx}`);
}

/** COMPLETE due phrase for a job row (P-36). Missing due date → the bare
 *  dueDateLine ("Sin fecha de vencimiento" / "No due date") — never wrapped
 *  with a due verb again, so the "Vence Sin fecha de vencimiento" run-on
 *  cannot re-form. A real date keeps the relative "Vence {rel}" phrasing. */
function fmtDue(iso: string | null, now: Date, lang: Lang): string {
  if (!iso) return dueDateLine({ dueDate: null }, lang);
  return tFor(lang, "activeJobs.due", { due: fmtDueRel(iso, now, lang) });
}

function fmtDueRel(iso: string, now: Date, lang: Lang): string {
  const due = new Date(iso + "T00:00:00");
  if (Number.isNaN(due.getTime())) return iso;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const diffDays = Math.round(
    (due.getTime() - startOfToday.getTime()) / 86_400_000,
  );
  if (diffDays === 0) return tFor(lang, "dashboardPage.due.today");
  if (diffDays === 1) return tFor(lang, "dashboardPage.due.tomorrow");
  if (diffDays === -1) return tFor(lang, "dashboardPage.due.yesterday");
  if (diffDays > 1 && diffDays < 7) return shortDay(lang, due.getDay());
  return `${shortMonth(lang, due.getMonth())} ${due.getDate()}`;
}

/** "Nov 26" for an ISO yyyy-mm-dd (local calendar day, no TZ drift). */
function fmtDay(iso: string, lang: Lang): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (!Number.isFinite(d.getTime())) return iso;
  return `${shortMonth(lang, d.getMonth())} ${d.getDate()}`;
}

function fmtRel(iso: string, now: Date, lang: Lang): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const m = Math.max(1, Math.floor((now.getTime() - t) / 60_000));
  if (m < 60) return tFor(lang, "dashboardPage.rel.minAgo", { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return tFor(lang, "dashboardPage.rel.hrAgo", { n: h });
  const d = Math.floor(h / 24);
  if (d === 1) return tFor(lang, "dashboardPage.rel.yesterday");
  if (d < 7) return tFor(lang, "dashboardPage.rel.daysAgo", { n: d });
  return `${shortMonth(lang, new Date(iso).getMonth())} ${
    new Date(iso).getDate()
  }`;
}

const JOB_ROTATION: { icon: IconName; color: string }[] = [
  { icon: "hardhat", color: "var(--brand-green)" },
  { icon: "wrench", color: "var(--brand-pink)" },
  { icon: "truck", color: "var(--coffee-500)" },
  { icon: "paint", color: "var(--brand-pink)" },
  { icon: "ruler", color: "var(--green-600)" },
];

function jobToRow(j: Job, idx: number, now: Date, lang: Lang): JobRow {
  const rot = JOB_ROTATION[idx % JOB_ROTATION.length];
  const total = j.totalCents / 100;
  // REQ-473 (demo-loop cycle 3, M8): "Deposit" only when the agreed terms
  // open with a deposit — "Payment upon completion" reads "Due on completion".
  const paidKey = jobPaidLabel(j.paidCents, j.paymentTerms);
  const paidLabel = tFor(lang, paidKey.key, paidKey.params);
  const statusKind: JobRow["status"]["kind"] = j.status === "overdue"
    ? "warn"
    : j.status === "awaiting_permit"
    ? "warn"
    : j.status === "complete"
    ? "teal"
    : "green";
  return {
    client: j.customer.name,
    task: jobRowTitle(j, lang),
    amount: `$${Math.round(total).toLocaleString()}`,
    paid: paidLabel,
    pct: j.pctPaid,
    due: fmtDue(j.nextDueDate, now, lang),
    icon: rot.icon,
    color: rot.color,
    status: { kind: statusKind, txt: j.statusLabel },
  };
}

function clientFromSummary(summary: string | null | undefined): string {
  if (!summary) return "—";
  const m = summary.match(/—\s*(.+)$/);
  return m ? m[1].trim() : "—";
}

function quoteToRow(q: QuoteCard, now: Date, lang: Lang): QuoteRow {
  const sentLabel = q.sentAt
    ? `${
      tFor(lang, "dashboardPage.quote.sent", {
        rel: fmtRel(q.sentAt, now, lang),
      })
    }${
      q.opens > 0
        ? ` · ${tFor(lang, "dashboardPage.quote.viewed")}${
          q.opens > 1 ? ` ${q.opens}×` : ""
        }`
        : ""
    }`
    : tFor(lang, "dashboardPage.quote.drafted");
  return {
    client: q.customerName ?? clientFromSummary(q.summary),
    desc: quoteRowTitle(q, lang),
    amt: fmtMoney(q.estimatedTotal ?? 0),
    sent: sentLabel,
    hot: q.stage === "opened" && q.opens >= 2,
    cold: q.stage === "stale" || q.stage === "cooling",
  };
}

const NOTIF_ICON: Record<
  Notification["type"],
  { icon: IconName; bg: string; fg: string }
> = {
  quote_sent: { icon: "send", bg: "var(--pink-50)", fg: "var(--pink-700)" },
  quote_accepted: {
    icon: "check",
    bg: "var(--green-50)",
    fg: "var(--green-600)",
  },
  invoice_claimed: {
    icon: "card",
    bg: "var(--pink-50)",
    fg: "var(--pink-700)",
  },
  invoice_paid: { icon: "card", bg: "var(--green-50)", fg: "var(--green-600)" },
  invoice_overdue: {
    icon: "invoice",
    bg: "var(--pink-50)",
    fg: "var(--pink-700)",
  },
  // REQ-022 (NW-31c): a scheduled invoice's send date is here.
  invoice_nudge_due: {
    icon: "invoice",
    bg: "var(--teal-50)",
    fg: "var(--teal-600)",
  },
  // REQ-566 (demo-loop cycle 4, m11): the owner's own work in the feed.
  invoice_sent: {
    icon: "invoice",
    bg: "var(--pink-50)",
    fg: "var(--pink-700)",
  },
  task_completed: {
    icon: "hardhat",
    bg: "var(--green-50)",
    fg: "var(--green-600)",
  },
  customer_replied: {
    icon: "msg",
    bg: "var(--coffee-50)",
    fg: "var(--coffee-600)",
  },
  generic: { icon: "sparkle", bg: "var(--teal-50)", fg: "var(--teal-600)" },
};

function notifToActivity(
  n: Notification,
  now: Date,
  lang: Lang,
): ActivityEntry {
  const skin = NOTIF_ICON[n.type] ?? NOTIF_ICON.generic;
  // UX-20: feed rows link to the thing they report — an accepted quote
  // opens that quote's panel, an invoice event lands on /invoices.
  // REQ-701 (cycle 5, M21): a client's question opens the quote's questions.
  const href = notificationHref(n);
  return {
    icon: skin.icon,
    bg: skin.bg,
    fg: skin.fg,
    html: escapeHtml(n.title),
    time: fmtRel(n.createdAt, now, lang),
    ...(href ? { href } : {}),
    // REQ-031 (NW-26): a customer's question is readable in the feed.
    ...(n.body?.trim() ? { body: n.body.trim() } : {}),
  };
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      c === "&"
        ? "&amp;"
        : c === "<"
        ? "&lt;"
        : c === ">"
        ? "&gt;"
        : c === '"'
        ? "&quot;"
        : "&#39;",
  );
}

interface State {
  loading: boolean;
  error: string | null;
  stats: DashboardStats | undefined;
  jobs: Job[];
  quoteCards: QuoteCard[];
  /** REQ-798: every invoice — the money bar splits them itself (overdue /
   *  open by the REQ-397 rule, paid in the last 30 days, billed against a
   *  job); the scheduled ones feed REQ-473's "Upcoming" line. */
  invoices: Invoice[];
  customers: Customer[];
  /** REQ-566 (m11): the lists have landed. A warm start paints the cached
   *  stats before them — no list panel claims "none" until this is true. */
  listsLoaded: boolean;
}

const INITIAL: State = {
  loading: true,
  error: null,
  stats: undefined,
  jobs: [],
  quoteCards: [],
  invoices: [],
  customers: [],
  listsLoaded: false,
};

function DashboardSkeleton() {
  // No hero skeleton: the real assistant CTA (static content) always renders
  // above this, so a shimmering hero would just duplicate it during load.
  return (
    <>
      <ShimmerStyle />
      <div class="moneybar">
        <SkelBlock h={36} w="30%" />
        <SkelBlock h={44} mt={6} />
        <SkelBlock h={14} mt={4} />
        <SkelBlock h={36} mt={10} />
      </div>
      <section class="kpis">
        {[0, 1, 2, 3].map((i) => (
          <div class="kpi" key={i}>
            <SkelBlock h={36} w="36px" r={10} />
            <SkelBlock h={11} w="60%" mt={14} />
            <SkelBlock h={28} w="55%" mt={10} />
            <SkelBlock h={12} w="70%" mt={10} />
          </div>
        ))}
      </section>
      <div class="grid">
        <div class="panel">
          <SkelBlock h={20} w="40%" />
          <SkelBlock h={64} mt={18} />
          <SkelBlock h={64} mt={12} />
        </div>
        <div class="panel">
          <SkelBlock h={20} w="40%" />
          <SkelBlock h={48} mt={18} />
          <SkelBlock h={48} mt={12} />
          <SkelBlock h={48} mt={12} />
        </div>
      </div>
      <div class="panel">
        <SkelBlock h={20} w="40%" />
        <SkelBlock h={40} mt={18} />
        <SkelBlock h={40} mt={12} />
      </div>
    </>
  );
}

export default function DashboardPage(_props: { lang?: Lang } = {}) {
  // Reactive UI language — seeded from the profile cache, flipped live by
  // Settings. (The old `lang` prop is superseded by this shared signal.)
  const lang = langSignal.value;
  // Warm-start from the shared dash cache: if we already have a stats snapshot
  // (e.g. from the sidebar on a prior page), render the hero + KPIs instantly
  // and treat the mount fetch as a background refresh instead of flashing the
  // full skeleton every time the user navigates back here.
  const [s, setS] = useState<State>(() => {
    const c = readCached();
    return c?.stats ? { ...INITIAL, loading: false, stats: c.stats } : INITIAL;
  });

  // REQ-299: the Activity panel reads the one notifications feed DashTopbar's
  // poll refreshes — no fetch of its own, and it follows the ticker live.
  const [notifications, setNotifications] = useState<Notification[]>(
    readNotifications,
  );
  // REQ-757 (demo cycle 5v2, m15): the feed is empty until its first refresh
  // settles; until then the panel is a skeleton, not "Nothing yet".
  const [notifLoaded, setNotifLoaded] = useState(notificationsLoaded);
  useEffect(() => {
    const unsub = subscribeNotifications((items) => {
      setNotifications(items);
      setNotifLoaded(true);
    });
    // single-flight: shares the topbar's request if one is in flight
    refreshNotifications().catch(() => {}).finally(() => setNotifLoaded(true));
    return unsub;
  }, []);

  useEffect(() => {
    let alive = true;
    // Keep the shared cache fresh for other islands (sidebar badges, etc).
    refreshDash().catch(() => {});
    Promise.all([
      dashboardClient.stats().catch(() =>
        undefined as DashboardStats | undefined
      ),
      dashboardClient.jobs().catch(() => [] as Job[]),
      // REQ-798: every quote (the won ones size "unbilled") and every
      // invoice (overdue / open by the REQ-397 rule, recently paid, billed
      // against a job, REQ-473's scheduled installments) — the panels and
      // the money bar filter below. The server's ?status= filters were exact
      // status matches, so filtering here is the same list.
      quotesClient.list().catch(() => [] as QuoteCard[]),
      dashboardClient.invoices().catch(() => [] as Invoice[]),
      dashboardClient.customers().catch(() => [] as Customer[]),
    ]).then(
      (
        [
          stats,
          jobs,
          quoteCards,
          invoices,
          customers,
        ],
      ) => {
        if (!alive) return;
        setS({
          loading: false,
          error: null,
          stats,
          jobs,
          quoteCards,
          invoices,
          customers,
          listsLoaded: true,
        });
      },
    ).catch((err: Error) => {
      if (!alive) return;
      setS({ ...INITIAL, loading: false, error: err.message });
    });
    return () => {
      alive = false;
    };
  }, []);

  // REQ-726 (demo cycle 5, m57): the topbar pill links to /dashboard#activity,
  // but the SSR render is the skeleton (no #activity), so the browser's own
  // fragment scroll found nothing and the page stayed at the top. Scroll to the
  // panel once it mounts (hydration on a warm start, the fetch on a cold one)
  // and once more when the lists land and the content above it settles.
  // REQ-749 (cycle 5v1, m57 re-opened): one scroll per render was not enough —
  // on the first load after login the feed fills the Activity panel after the
  // lists land, so the scroll clamped at the then-bottom of the page and the
  // panel ended below the fold. Hold the panel while the layout settles (it
  // re-scrolls on every size change until the user scrolls or ~6 s pass).
  const releaseHold = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (s.loading || typeof document === "undefined") return;
    if (releaseHold.current) return;
    releaseHold.current = holdHashTarget(
      document,
      globalThis.location?.hash ?? "",
    );
  }, [s.loading, s.listsLoaded]);
  useEffect(() => () => releaseHold.current?.(), []);

  // PDF p8: "My Assistant needs to be on the dashboard at the top because on
  // mobile you have to hit the hamburger to actually see that." This block is
  // static content, so it renders in EVERY state (loading / error / loaded) —
  // the entry to the assistant never waits on the dashboard fetches, and the
  // [data-cy=assistant-cta] anchor works pre-hydration (plain href).
  const assistantCta = (
    <div class="assistant-cta">
      <div class="assistant-cta__body">
        <span class="assistant-cta__eyebrow">
          {tFor(lang, "dashHero.cta.assistant")}
        </span>
        <span class="assistant-cta__title">
          {tFor(lang, "dashAssistantCta.title")}
        </span>
        <span class="assistant-cta__sub">
          {tFor(lang, "dashAssistantCta.sub")}
        </span>
        <div class="assistant-cta__actions">
          <a
            class="assistant-cta__btn"
            data-cy="assistant-cta"
            href="/assistant"
          >
            <span class="assistant-cta__crown">
              <I d={ICN.crown} size={16} />
            </span>
            {tFor(lang, "dashHero.cta.assistant")}
            <I d={ICN.arrow} size={16} />
          </a>
          <a class="assistant-cta__call" href={SUPPORT_PHONE_HREF}>
            <I d={ICN.phone} size={15} />
            <span class="assistant-cta__call-label">
              {tFor(lang, "dashAssistantCta.callSupport")}
            </span>
            <span class="assistant-cta__call-num">{SUPPORT_PHONE_DISPLAY}</span>
          </a>
        </div>
      </div>
      <div class="assistant-cta__art">
        <span class="assistant-cta__confetti assistant-cta__confetti--1" />
        <span class="assistant-cta__confetti assistant-cta__confetti--2" />
        <span class="assistant-cta__confetti assistant-cta__confetti--3" />
        <span class="assistant-cta__blob" />
        <img src="/logo-monster.png" alt="" class="assistant-cta__monster" />
      </div>
    </div>
  );

  if (s.loading) {
    return (
      <>
        {assistantCta}
        <DashboardSkeleton />
      </>
    );
  }
  if (s.error) {
    return (
      <>
        {assistantCta}
        <div class="dashpage-error">
          {tFor(lang, "dashboardPage.loadError")}: {s.error}
        </div>
      </>
    );
  }

  const { stats, jobs, quoteCards, invoices, customers } = s;
  const now = new Date();

  // REQ-728 (cycle 5, m15): a warm start paints the cached stats before the
  // lists land; until then nothing derived from a list (the Active jobs
  // count, the jobs and invoice panels) may claim "0" or "none".
  const listsPending = !s.listsLoaded;
  const kpis = { ...pickKpis(stats), activeJobs: jobs.length };
  const customerNames = new Map(customers.map((c) => [c.id, c.name] as const));

  const safeJobs = Array.isArray(jobs) ? jobs : [];
  const jobRows: JobRow[] = safeJobs.slice(0, 5).map((j, i) =>
    jobToRow(j, i, now, lang)
  );

  const seenQuoteIds = new Set<string>();
  const safeQuoteCards = Array.isArray(quoteCards) ? quoteCards : [];
  const safeInvoices = Array.isArray(invoices) ? invoices : [];
  const quoteRows: QuoteRow[] = safeQuoteCards
    .slice()
    .sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? ""))
    .filter((q) => {
      // P-15: the onboarding sample is not a quote awaiting response — it
      // never renders (or sums) in this panel.
      if (q.isSample === true) return false;
      // REQ-798: the list is every quote now; this panel is the sent ones
      if (q.status !== "sent") return false;
      if (!q.id || seenQuoteIds.has(q.id)) return false;
      seenQuoteIds.add(q.id);
      return true;
    })
    .slice(0, 4)
    .map((q) => quoteToRow(q, now, lang));

  // REQ-798: the money bar — five buckets from every quote, job and invoice
  const moneyBar = buildMoneyBar({
    quotes: safeQuoteCards,
    jobs: safeJobs,
    invoices: safeInvoices,
    customerNames,
    now,
  });

  // REQ-473: a scheduled installment is money coming, not "No invoices yet".
  const upcomingBill = nextUpcomingBill(safeInvoices);
  const upcomingLine = upcomingBill
    ? tFor(lang, "outstanding.upcoming", {
      amt: Math.round(upcomingBill.amountCents / 100).toLocaleString("en-US"),
      date: fmtDay(upcomingBill.date, lang),
    })
    : null;
  const outstandingEmpty = outstandingEmptyKey(
    stats?.invoices.total ?? 0,
    upcomingBill,
  );

  const grouped: Notification[] = [];
  for (const n of notifications) {
    const prev = grouped[grouped.length - 1];
    if (prev && prev.title === n.title) {
      grouped[grouped.length - 1] = { ...prev, title: prev.title };
      (grouped[grouped.length - 1] as Notification & { _dupes?: number })
        ._dupes = ((prev as Notification & { _dupes?: number })._dupes ?? 1) +
          1;
    } else {
      grouped.push(n);
    }
  }
  const activityRows: ActivityEntry[] = grouped.slice(0, 4).map((n) => {
    const dupes = (n as Notification & { _dupes?: number })._dupes ?? 1;
    const entry = notifToActivity(n, now, lang);
    return dupes > 1
      ? {
        ...entry,
        html:
          `${entry.html} <span style="color:var(--fg-muted);font-weight:600">· ${dupes}×</span>`,
      }
      : entry;
  });

  return (
    <>
      {assistantCta}
      {(listsPending || !notifLoaded) && <ShimmerStyle />}
      <SetupChecklist />
      <MoneyBar
        data={moneyBar}
        lang={lang}
        now={now}
        upcoming={upcomingLine}
        emptyKey={outstandingEmpty}
        pending={listsPending}
      />
      <Kpis
        activeJobs={kpis.activeJobs}
        outstanding={kpis.outstanding}
        outstandingCount={kpis.outstandingCount}
        outstandingOverdue={kpis.outstandingOverdue}
        pendingQuotes={kpis.pendingQuotes}
        pendingTotal={kpis.pendingTotal}
        undeliveredQuotes={stats?.quotes.undelivered ?? 0}
        avgJob={kpis.avgJob}
        lang={lang}
        activeJobsPending={listsPending}
      />
      <div class="grid">
        <ActiveJobs
          jobs={jobRows}
          total={kpis.activeJobs}
          lang={lang}
          pending={listsPending}
        />
        <QuotesAwaiting
          quotes={quoteRows}
          lang={lang}
          hasDecidedHistory={(stats?.quotes.accepted ?? 0) > 0}
          draftCount={stats?.quotes.draft ?? 0}
          readyCount={stats?.quotes.readyToSend}
          undeliveredCount={stats?.quotes.undelivered ?? 0}
          pending={!s.listsLoaded}
        />
      </div>
      <Activity items={activityRows} lang={lang} pending={!notifLoaded} />
    </>
  );
}
