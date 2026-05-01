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
  Hero,
  type JobRow,
  Kpis,
  Outstanding,
  type OutstandingRow,
  type QuoteRow,
  QuotesAwaiting,
} from "../components/DashSections.tsx";
import { type IconName } from "../lib/dash-icons.tsx";
import { fmtMoney } from "../lib/format.ts";
import { ShimmerStyle, SkelBlock } from "../components/Skeletons.tsx";

const SHORT_MONTH = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const SHORT_DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmtDue(iso: string | null, now: Date): string {
  if (!iso) return "—";
  const due = new Date(iso + "T00:00:00");
  if (Number.isNaN(due.getTime())) return iso;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const diffDays = Math.round(
    (due.getTime() - startOfToday.getTime()) / 86_400_000,
  );
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";
  if (diffDays > 1 && diffDays < 7) return SHORT_DAY[due.getDay()];
  return `${SHORT_MONTH[due.getMonth()]} ${due.getDate()}`;
}

function fmtRel(iso: string, now: Date): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const m = Math.max(1, Math.floor((now.getTime() - t) / 60_000));
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "Yesterday";
  if (d < 7) return `${d} days ago`;
  return `${SHORT_MONTH[new Date(iso).getMonth()]} ${new Date(iso).getDate()}`;
}

const JOB_ROTATION: { icon: IconName; color: string }[] = [
  { icon: "hardhat", color: "var(--brand-green)" },
  { icon: "wrench", color: "var(--brand-pink)" },
  { icon: "truck", color: "var(--coffee-500)" },
  { icon: "paint", color: "var(--brand-pink)" },
  { icon: "ruler", color: "var(--green-600)" },
];

function jobToRow(j: Job, idx: number, now: Date): JobRow {
  const rot = JOB_ROTATION[idx % JOB_ROTATION.length];
  const total = j.totalCents / 100;
  const paid = j.paidCents / 100;
  const paidLabel = paid > 0
    ? `$${Math.round(paid).toLocaleString()} paid`
    : (j.contract?.status === "signed" ? "Deposit" : "Quoted");
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
    due: fmtDue(j.nextDueDate, now),
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

function quoteToRow(q: QuoteCard, now: Date): QuoteRow {
  const sentLabel = q.sentAt
    ? `Sent ${fmtRel(q.sentAt, now)}${
      q.opens > 0 ? ` · Viewed${q.opens > 1 ? ` ${q.opens}×` : ""}` : ""
    }`
    : "Drafted";
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
): OutstandingRow {
  const due = new Date(inv.dueDate + "T00:00:00");
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  let meta: string;
  let metaColor: string;
  let metaWeight = 600;
  if (days < 0) {
    meta = `${-days} day${-days === 1 ? "" : "s"} overdue · #INV-${
      shortInv(inv.id, idx)
    }`;
    metaColor = "var(--pink-700)";
    metaWeight = 700;
  } else if (days <= 5) {
    meta = `Due in ${days} day${days === 1 ? "" : "s"} · #INV-${
      shortInv(inv.id, idx)
    }`;
    metaColor = "var(--coffee-500)";
  } else {
    meta = `Due ${SHORT_MONTH[due.getMonth()]} ${due.getDate()} · #INV-${
      shortInv(inv.id, idx)
    }`;
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

function notifToActivity(n: Notification, now: Date): ActivityEntry {
  const skin = NOTIF_ICON[n.type] ?? NOTIF_ICON.generic;
  return {
    icon: skin.icon,
    bg: skin.bg,
    fg: skin.fg,
    html: escapeHtml(n.title),
    time: fmtRel(n.createdAt, now),
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

  return {
    thisMonthBilled,
    activeJobs: 0,
    outstanding: owed,
    outstandingCount: stats?.invoices.pending ?? 0,
    outstandingOverdue: stats?.invoices.overdue ?? 0,
    pendingQuotes: stats?.quotes.sent ?? 0,
    pendingTotal: (stats?.quotedValueCents ?? 0) / 100,
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
  return (
    <>
      <ShimmerStyle />
      <section class="hero" style="min-height:200px">
        <div class="hero__copy">
          <SkelBlock h={36} w="80%" />
          <SkelBlock h={16} w="60%" mt={14} />
          <SkelBlock h={16} w="45%" mt={8} />
          <SkelBlock h={44} w="220px" r={12} mt={22} />
        </div>
      </section>
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

export default function DashboardPage() {
  const [s, setS] = useState<State>(INITIAL);

  useEffect(() => {
    let alive = true;
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

  if (s.loading) return <DashboardSkeleton />;
  if (s.error) {
    return <div class="dashpage-error">Couldn't load dashboard: {s.error}</div>;
  }

  const { stats, jobs, quoteCards, pendingInvoices, customers, notifications } =
    s;
  const now = new Date();

  const kpis = { ...pickKpis(stats), activeJobs: jobs.length };
  const customerNames = new Map(customers.map((c) => [c.id, c.name] as const));

  const jobRows: JobRow[] = jobs.slice(0, 5).map((j, i) => jobToRow(j, i, now));

  const seenQuoteIds = new Set<string>();
  const quoteRows: QuoteRow[] = quoteCards
    .slice()
    .sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? ""))
    .filter((q) => {
      if (!q.id || seenQuoteIds.has(q.id)) return false;
      seenQuoteIds.add(q.id);
      return true;
    })
    .slice(0, 4)
    .map((q) => quoteToRow(q, now));

  const outstandingRows: OutstandingRow[] = pendingInvoices
    .slice()
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
    .slice(0, 5)
    .map((inv, i) => invoiceToRow(inv, customerNames, now, i));

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
    const entry = notifToActivity(n, now);
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
      <Hero
        thisMonthBilled={kpis.thisMonthBilled}
        pendingQuotes={kpis.pendingQuotes}
        outstandingOverdue={kpis.outstandingOverdue}
      />
      <Kpis
        activeJobs={kpis.activeJobs}
        outstanding={kpis.outstanding}
        outstandingCount={kpis.outstandingCount}
        outstandingOverdue={kpis.outstandingOverdue}
        pendingQuotes={kpis.pendingQuotes}
        pendingTotal={kpis.pendingTotal}
        avgJob={kpis.avgJob}
      />
      <div class="grid">
        <ActiveJobs jobs={jobRows} />
        <QuotesAwaiting quotes={quoteRows} />
      </div>
      <div class="grid">
        <Activity items={activityRows} />
        <Outstanding
          owed={kpis.owed}
          current={kpis.current}
          mid={kpis.mid}
          overdue={kpis.overdue}
          items={outstandingRows}
        />
      </div>
    </>
  );
}
