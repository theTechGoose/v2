import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import { getSessionId } from "../../lib/auth.ts";
import {
  dashboardClient,
  type DashboardStats,
  type Notification,
} from "../../clients/dashboard.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import { Hero, Kpis, ActiveJobs, QuotesAwaiting, Activity, Outstanding } from "../../components/DashSections.tsx";
import { SEED_JOBS, SEED_QUOTES, SEED_ACTIVITY, SEED_OUTSTANDING, SEED_KPIS } from "../../lib/dash-seed.ts";

async function settle<T>(p: Promise<T>, fallback: T): Promise<T> {
  try { return await p; } catch { return fallback; }
}

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default define.page(async function Dashboard(ctx) {
  const sessionId = getSessionId(ctx.req);
  const opts = { sessionId };
  const user = ctx.state.user;

  const [stats, notifications, unreadEnvelope] = await Promise.all([
    settle(dashboardClient.stats(opts),           undefined as DashboardStats | undefined),
    settle(dashboardClient.notifications(10, opts), [] as Notification[]),
    settle(dashboardClient.unreadCount(opts),     { count: 0 }),
  ]);

  const greetingName = (user?.name ?? user?.phoneNumber ?? "Diego").split(" ")[0];

  // Date string: "Tuesday · April 28"
  const now = new Date();
  const greetingDate = `${WEEKDAY[now.getDay()]} · ${MONTH[now.getMonth()]} ${now.getDate()}`;

  // Until the backend's domain-shaped endpoints flesh out, we render the
  // visual structure with the prototype's seed data. As real data lands,
  // wire `stats` / `quotes` / `invoices` into the same components.
  const kpis = SEED_KPIS;
  const heroBilled = stats?.thisMonthBilled ?? kpis.thisMonthBilled;

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
            <Hero thisMonthBilled={heroBilled} pendingQuotes={kpis.pendingQuotes} />
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
              <ActiveJobs jobs={SEED_JOBS} />
              <QuotesAwaiting quotes={SEED_QUOTES} />
            </div>
            <div class="grid">
              <Activity items={SEED_ACTIVITY} />
              <Outstanding
                owed={kpis.owed}
                current={kpis.current}
                mid={kpis.mid}
                overdue={kpis.overdue}
                items={SEED_OUTSTANDING}
              />
            </div>
          </div>
        </main>
      </div>
    </>
  );
});
