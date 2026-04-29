import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import { getSessionId } from "../../lib/auth.ts";
import {
  dashboardClient,
  type Customer,
  type DashboardStats,
  type Invoice,
  type Job,
  type Notification,
} from "../../clients/dashboard.ts";
import type { QuoteCard } from "../../clients/quotes.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import {
  Activity,
  ActiveJobs,
  Hero,
  Kpis,
  Outstanding,
  QuotesAwaiting,
  type ActivityEntry,
  type JobRow,
  type OutstandingRow,
  type QuoteRow,
} from "../../components/DashSections.tsx";
import { type IconName } from "../../lib/dash-icons.tsx";

async function settle<T>(p: Promise<T>, fallback: T): Promise<T> {
  try { return await p; } catch { return fallback; }
}

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT_MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SHORT_DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const fmtUsd = (cents: number) => `$${Math.round(cents / 100).toLocaleString()}`;

function fmtDue(iso: string | null, now: Date): string {
  if (!iso) return "—";
  const due = new Date(iso + "T00:00:00");
  if (Number.isNaN(due.getTime())) return iso;
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due.getTime() - startOfToday.getTime()) / 86_400_000);
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
  { icon: "wrench",  color: "var(--brand-pink)" },
  { icon: "truck",   color: "var(--coffee-500)" },
  { icon: "paint",   color: "var(--brand-pink)" },
  { icon: "ruler",   color: "var(--green-600)" },
];

function jobToRow(j: Job, idx: number, now: Date): JobRow {
  const rot = JOB_ROTATION[idx % JOB_ROTATION.length];
  const total = j.totalCents / 100;
  const paid  = j.paidCents / 100;
  const paidLabel = paid > 0
    ? `$${Math.round(paid).toLocaleString()} paid`
    : (j.contract?.status === "signed" ? "Deposit" : "Quoted");
  const statusKind: JobRow["status"]["kind"] =
    j.status === "overdue"  ? "warn"
    : j.status === "awaiting" || j.status === "awaiting_permit" ? "warn"
    : j.status === "complete" ? "teal"
    : "green";
  return {
    client: j.customer.name,
    task:   j.quote.summary,
    amount: `$${Math.round(total).toLocaleString()}`,
    paid:   paidLabel,
    pct:    j.pctPaid,
    due:    fmtDue(j.nextDueDate, now),
    icon:   rot.icon,
    color:  rot.color,
    status: { kind: statusKind, txt: j.statusLabel },
  };
}

function quoteToRow(q: QuoteCard, now: Date): QuoteRow {
  const sentLabel = q.sentAt
    ? `Sent ${fmtRel(q.sentAt, now)}${q.opens > 0 ? ` · Viewed${q.opens > 1 ? ` ${q.opens}×` : ""}` : ""}`
    : "Drafted";
  return {
    client: q.customerName ?? "Unknown",
    desc:   q.summary ?? "",
    amt:    `$${Math.round(q.estimatedTotal ?? 0).toLocaleString()}`,
    sent:   sentLabel,
    hot:    q.stage === "opened" && q.opens >= 2,
    cold:   q.stage === "stale" || q.stage === "cooling",
  };
}

function invoiceToRow(inv: Invoice, customerNames: Map<string, string>, now: Date, idx: number): OutstandingRow {
  const due = new Date(inv.dueDate + "T00:00:00");
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  let meta: string;
  let metaColor: string;
  let metaWeight = 600;
  if (days < 0) {
    meta = `${-days} day${-days === 1 ? "" : "s"} overdue · #INV-${shortInv(inv.id, idx)}`;
    metaColor = "var(--pink-700)";
    metaWeight = 700;
  } else if (days <= 5) {
    meta = `Due in ${days} day${days === 1 ? "" : "s"} · #INV-${shortInv(inv.id, idx)}`;
    metaColor = "var(--coffee-500)";
  } else {
    meta = `Due ${SHORT_MONTH[due.getMonth()]} ${due.getDate()} · #INV-${shortInv(inv.id, idx)}`;
    metaColor = "var(--green-600)";
  }
  const name = inv.customerId ? customerNames.get(inv.customerId) ?? "Unknown" : "Unknown";
  return {
    client: name,
    meta,
    metaColor,
    metaWeight,
    amount: `$${Math.round(inv.amount ?? 0).toLocaleString()}`,
  };
}

function shortInv(id: string, idx: number): string {
  const tail = id.replace(/[^0-9]/g, "").slice(-3);
  return tail || String(200 + idx);
}

const NOTIF_ICON: Record<Notification["type"], { icon: IconName; bg: string; fg: string }> = {
  quote_sent:       { icon: "send",     bg: "var(--pink-50)",   fg: "var(--pink-700)"  },
  quote_accepted:   { icon: "check",    bg: "var(--green-50)",  fg: "var(--green-600)" },
  contract_signed:  { icon: "contract", bg: "var(--teal-50)",   fg: "var(--teal-600)"  },
  invoice_paid:     { icon: "card",     bg: "var(--green-50)",  fg: "var(--green-600)" },
  invoice_overdue:  { icon: "invoice",  bg: "var(--pink-50)",   fg: "var(--pink-700)"  },
  customer_replied: { icon: "msg",      bg: "var(--coffee-50)", fg: "var(--coffee-600)" },
  generic:          { icon: "sparkle",  bg: "var(--teal-50)",   fg: "var(--teal-600)"  },
};

function notifToActivity(n: Notification, now: Date): ActivityEntry {
  const skin = NOTIF_ICON[n.type] ?? NOTIF_ICON.generic;
  return {
    icon: skin.icon,
    bg:   skin.bg,
    fg:   skin.fg,
    html: escapeHtml(n.title),
    time: fmtRel(n.createdAt, now),
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" :
    c === "<" ? "&lt;" :
    c === ">" ? "&gt;" :
    c === '"' ? "&quot;" : "&#39;");
}

function pickKpis(stats: DashboardStats | undefined) {
  const buckets = stats?.invoices.agingBuckets;
  const current  = (buckets?.current ?? 0) / 100;
  const mid      = (buckets?.aging1_14d ?? 0) / 100;
  const overdue  = ((buckets?.overdue15_30d ?? 0) + (buckets?.overdue30plus ?? 0)) / 100;
  const owed     = current + mid + overdue;
  const sparkline = stats?.revenue.sparkline12mo ?? [];
  const thisMonthBilled = (sparkline.length > 0 ? sparkline[sparkline.length - 1] : 0) / 100;

  // Avg job size: trailing-12mo paid revenue / paid invoice count, falling
  // back to YTD when no monthly data yet.
  const paidCount = stats?.invoices.paid ?? 0;
  const ytd = (stats?.revenue.ytdCents ?? 0) / 100;
  const avgJob = paidCount > 0 ? Math.round(ytd / paidCount) : 0;

  return {
    thisMonthBilled,
    activeJobs: 0, // filled in by the caller from the jobs list
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

export default define.page(async function Dashboard(ctx) {
  const sessionId = getSessionId(ctx.req);
  const opts = { sessionId };
  const user = ctx.state.user;

  const [stats, jobs, quoteCards, pendingInvoices, customers, notifications, unreadEnvelope] = await Promise.all([
    settle(dashboardClient.stats(opts),                  undefined as DashboardStats | undefined),
    settle(dashboardClient.jobs(opts),                   [] as Job[]),
    settle(dashboardClient.quotes("sent", opts),         [] as QuoteCard[]),
    settle(dashboardClient.invoices("pending", opts),    [] as Invoice[]),
    settle(dashboardClient.customers(opts),              [] as Customer[]),
    settle(dashboardClient.notifications(10, opts),      [] as Notification[]),
    settle(dashboardClient.unreadCount(opts),            { count: 0 }),
  ]);

  const greetingName = (user?.name ?? user?.phoneNumber ?? "Diego").split(" ")[0];
  const now = new Date();
  const greetingDate = `${WEEKDAY[now.getDay()]} · ${MONTH[now.getMonth()]} ${now.getDate()}`;

  const kpis = { ...pickKpis(stats), activeJobs: jobs.length };

  const customerNames = new Map(customers.map((c) => [c.id, c.name] as const));

  const jobRows: JobRow[] = jobs.slice(0, 5).map((j, i) => jobToRow(j, i, now));

  const quoteRows: QuoteRow[] = quoteCards
    .slice()
    .sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? ""))
    .slice(0, 4)
    .map((q) => quoteToRow(q, now));

  const outstandingRows: OutstandingRow[] = pendingInvoices
    .slice()
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
    .slice(0, 5)
    .map((inv, i) => invoiceToRow(inv, customerNames, now, i));

  const activityRows: ActivityEntry[] = notifications.slice(0, 4).map((n) => notifToActivity(n, now));

  return (
    <>
      <Head>
        <title>Dashboard · Paperwork Monsters</title>
        <link rel="stylesheet" href="/dashboard.css" />
      </Head>

      <div class="app">
        <DashSidebar active="home" />
        <main class="main">
          <DashTopbar
            greetingDate={greetingDate}
            greetingName={greetingName}
            initialUnread={unreadEnvelope.count}
            initialNotifications={notifications}
          />
          <div class="content">
            <Hero thisMonthBilled={kpis.thisMonthBilled} pendingQuotes={kpis.pendingQuotes} />
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
          </div>
        </main>
      </div>
    </>
  );
});
