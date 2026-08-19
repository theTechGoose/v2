/**
 * Top-level data island for /dashboard. The SSR route renders only the
 * page shell; this island fans out the dashboard fetches in parallel and
 * assembles the hero, KPIs, jobs row, quotes row, activity feed, and
 * outstanding list.
 */
import { useEffect, useState } from "preact/hooks";
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
  Outstanding,
  type OutstandingRow,
  type QuoteRow,
  QuotesAwaiting,
} from "../components/DashSections.tsx";
import { I, ICN, type IconName } from "../lib/dash-icons.tsx";
import { fmtMoney } from "../lib/format.ts";
import { dueDateLine } from "../../shared/quote-flow/pipeline-stats.ts";
import { readCached, refreshDash } from "../lib/dash-cache.ts";
import { ShimmerStyle, SkelBlock } from "../components/Skeletons.tsx";
import SetupChecklist from "./SetupChecklist.tsx";
import { type Lang, langSignal, tFor } from "../lib/i18n.ts";

// Toll-free support line (TWILIO_SUPPORT_NUMBER). Public number, safe to ship.
// A call here hits the Twilio Studio Flow that texts a heads-up, plays a brief
// hold, then forwards to the support cell.
const SUPPORT_PHONE = "+18667678399";
const SUPPORT_PHONE_DISPLAY = "(866) 767-8399";

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
  const paid = j.paidCents / 100;
  const paidLabel = paid > 0
    ? tFor(lang, "dashboardPage.job.amountPaid", {
      amount: `$${Math.round(paid).toLocaleString()}`,
    })
    : (j.contract?.status === "signed"
      ? tFor(lang, "dashboardPage.job.deposit")
      : tFor(lang, "dashboardPage.job.quoted"));
  const statusKind: JobRow["status"]["kind"] = j.status === "overdue"
    ? "warn"
    : j.status === "awaiting" || j.status === "awaiting_permit"
    ? "warn"
    : j.status === "complete"
    ? "teal"
    : "green";
  return {
    client: j.customer.name,
    task: j.quote.summary,
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
    desc: q.summary ?? "",
    amt: fmtMoney(q.estimatedTotal ?? 0),
    sent: sentLabel,
    hot: q.stage === "opened" && q.opens >= 2,
    cold: q.stage === "stale" || q.stage === "cooling",
  };
}

function shortInv(id: string, idx: number): string {
  const tail = id.replace(/[^0-9]/g, "").slice(-3);
  return tail || String(200 + idx);
}

function invoiceToRow(
  inv: Invoice,
  customerNames: Map<string, string>,
  now: Date,
  idx: number,
  lang: Lang,
): OutstandingRow {
  const due = new Date(inv.dueDate + "T00:00:00");
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  const num = shortInv(inv.id, idx);
  let meta: string;
  let metaColor: string;
  let metaWeight = 600;
  if (days < 0) {
    const overdueDays = -days;
    meta = tFor(
      lang,
      `dashboardPage.invoice.overdue.${overdueDays === 1 ? "one" : "other"}`,
      { n: overdueDays, num },
    );
    metaColor = "var(--pink-700)";
    metaWeight = 700;
  } else if (days <= 5) {
    meta = tFor(
      lang,
      `dashboardPage.invoice.dueIn.${days === 1 ? "one" : "other"}`,
      { n: days, num },
    );
    metaColor = "var(--coffee-500)";
  } else {
    meta = tFor(lang, "dashboardPage.invoice.dueOn", {
      date: `${shortMonth(lang, due.getMonth())} ${due.getDate()}`,
      num,
    });
    metaColor = "var(--green-600)";
  }
  const name = (inv.customerId && customerNames.get(inv.customerId)) || "—";
  return {
    client: name,
    meta,
    metaColor,
    metaWeight,
    amount: fmtMoney(inv.amount ?? 0),
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
  contract_signed: {
    icon: "contract",
    bg: "var(--teal-50)",
    fg: "var(--teal-600)",
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
  const href = n.entityType === "quote" && n.entityId
    ? `/quotes?open=${encodeURIComponent(n.entityId)}`
    : n.entityType === "invoice"
    ? "/invoices"
    : undefined;
  return {
    icon: skin.icon,
    bg: skin.bg,
    fg: skin.fg,
    html: escapeHtml(n.title),
    time: fmtRel(n.createdAt, now, lang),
    ...(href ? { href } : {}),
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

function pickKpis(stats: DashboardStats | undefined) {
  const buckets = stats?.invoices.agingBuckets;
  const current = (buckets?.current ?? 0) / 100;
  const mid = (buckets?.aging1_14d ?? 0) / 100;
  const overdue =
    ((buckets?.overdue15_30d ?? 0) + (buckets?.overdue30plus ?? 0)) / 100;
  const owed = current + mid + overdue;
  const sparkline = stats?.revenue.sparkline12mo ?? [];
  const thisMonthBilled =
    (sparkline.length > 0 ? sparkline[sparkline.length - 1] : 0) / 100;

  const paidCount = stats?.invoices.paid ?? 0;
  const ytd = (stats?.revenue.ytdCents ?? 0) / 100;
  const avgJob = paidCount > 0 ? Math.round(ytd / paidCount) : 0;

  // When there are no pending invoices, clamp Outstanding to exactly $0 — the
  // aging buckets can carry stray sub-dollar cents that otherwise surface as a
  // nonsense "$0.09 · 0 invoices".
  const pending = stats?.invoices.pending ?? 0;

  return {
    thisMonthBilled,
    activeJobs: 0,
    outstanding: pending === 0 ? 0 : owed,
    outstandingCount: pending,
    outstandingOverdue: stats?.invoices.overdue ?? 0,
    pendingQuotes: stats?.quotes.sent ?? 0,
    // INTEGER CENTS end to end (P-36) — the KPI formats via
    // formatMoneyCompact, so no /100 dollars conversion here.
    pendingTotal: stats?.quotedValueCents ?? 0,
    avgJob,
    owed,
    current,
    mid,
    overdue,
  };
}

interface State {
  loading: boolean;
  error: string | null;
  stats: DashboardStats | undefined;
  jobs: Job[];
  quoteCards: QuoteCard[];
  pendingInvoices: Invoice[];
  customers: Customer[];
  notifications: Notification[];
}

const INITIAL: State = {
  loading: true,
  error: null,
  stats: undefined,
  jobs: [],
  quoteCards: [],
  pendingInvoices: [],
  customers: [],
  notifications: [],
};

function DashboardSkeleton() {
  // No hero skeleton: the real assistant CTA (static content) always renders
  // above this, so a shimmering hero would just duplicate it during load.
  return (
    <>
      <ShimmerStyle />
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
      <div class="grid">
        <div class="panel">
          <SkelBlock h={20} w="40%" />
          <SkelBlock h={40} mt={18} />
          <SkelBlock h={40} mt={12} />
        </div>
        <div class="money">
          <SkelBlock h={28} w="50%" />
          <SkelBlock h={10} mt={14} />
          <SkelBlock h={36} mt={18} />
          <SkelBlock h={36} mt={12} />
        </div>
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

  useEffect(() => {
    let alive = true;
    // Keep the shared cache fresh for other islands (sidebar badges, etc).
    refreshDash().catch(() => {});
    Promise.all([
      dashboardClient.stats().catch(() =>
        undefined as DashboardStats | undefined
      ),
      dashboardClient.jobs().catch(() => [] as Job[]),
      quotesClient.list("sent").catch(() => [] as QuoteCard[]),
      dashboardClient.invoices("pending").catch(() => [] as Invoice[]),
      dashboardClient.customers().catch(() => [] as Customer[]),
      dashboardClient.notifications(10).catch(() => [] as Notification[]),
    ]).then(
      (
        [stats, jobs, quoteCards, pendingInvoices, customers, notifications],
      ) => {
        if (!alive) return;
        setS({
          loading: false,
          error: null,
          stats,
          jobs,
          quoteCards,
          pendingInvoices,
          customers,
          notifications,
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
          <a class="assistant-cta__call" href={`tel:${SUPPORT_PHONE}`}>
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

  const { stats, jobs, quoteCards, pendingInvoices, customers, notifications } =
    s;
  const now = new Date();

  const kpis = { ...pickKpis(stats), activeJobs: jobs.length };
  const customerNames = new Map(customers.map((c) => [c.id, c.name] as const));

  const safeJobs = Array.isArray(jobs) ? jobs : [];
  const jobRows: JobRow[] = safeJobs.slice(0, 5).map((j, i) =>
    jobToRow(j, i, now, lang)
  );

  const seenQuoteIds = new Set<string>();
  const safeQuoteCards = Array.isArray(quoteCards) ? quoteCards : [];
  const safePendingInvoices = Array.isArray(pendingInvoices)
    ? pendingInvoices
    : [];
  const quoteRows: QuoteRow[] = safeQuoteCards
    .slice()
    .sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? ""))
    .filter((q) => {
      // P-15: the onboarding sample is not a quote awaiting response — it
      // never renders (or sums) in this panel.
      if (q.isSample === true) return false;
      if (!q.id || seenQuoteIds.has(q.id)) return false;
      seenQuoteIds.add(q.id);
      return true;
    })
    .slice(0, 4)
    .map((q) => quoteToRow(q, now, lang));

  const outstandingRows: OutstandingRow[] = safePendingInvoices
    .slice()
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
    .slice(0, 5)
    .map((inv, i) => invoiceToRow(inv, customerNames, now, i, lang));

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
      <SetupChecklist />
      <Kpis
        activeJobs={kpis.activeJobs}
        outstanding={kpis.outstanding}
        outstandingCount={kpis.outstandingCount}
        outstandingOverdue={kpis.outstandingOverdue}
        pendingQuotes={kpis.pendingQuotes}
        pendingTotal={kpis.pendingTotal}
        avgJob={kpis.avgJob}
        lang={lang}
      />
      <div class="grid">
        <ActiveJobs jobs={jobRows} total={kpis.activeJobs} lang={lang} />
        <QuotesAwaiting
          quotes={quoteRows}
          lang={lang}
          hasDecidedHistory={(stats?.quotes.accepted ?? 0) > 0}
        />
      </div>
      <div class="grid">
        <Activity items={activityRows} lang={lang} />
        <Outstanding
          owed={kpis.owed}
          current={kpis.current}
          mid={kpis.mid}
          overdue={kpis.overdue}
          items={outstandingRows}
          lang={lang}
        />
      </div>
    </>
  );
}
