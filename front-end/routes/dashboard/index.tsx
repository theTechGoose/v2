import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import { tFor } from "../../lib/i18n.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import DashboardPage from "../../islands/DashboardPage.tsx";
import AssistantCoachmark from "../../islands/AssistantCoachmark.tsx";
import WelcomeBackToast from "../../islands/WelcomeBackToast.tsx";

const WEEKDAY_KEYS = [
  "dashboardPage.weekday.sunday",
  "dashboardPage.weekday.monday",
  "dashboardPage.weekday.tuesday",
  "dashboardPage.weekday.wednesday",
  "dashboardPage.weekday.thursday",
  "dashboardPage.weekday.friday",
  "dashboardPage.weekday.saturday",
];
const MONTH_KEYS = [
  "dashboardPage.month.january",
  "dashboardPage.month.february",
  "dashboardPage.month.march",
  "dashboardPage.month.april",
  "dashboardPage.month.may",
  "dashboardPage.month.june",
  "dashboardPage.month.july",
  "dashboardPage.month.august",
  "dashboardPage.month.september",
  "dashboardPage.month.october",
  "dashboardPage.month.november",
  "dashboardPage.month.december",
];

export default define.page(function Dashboard(ctx) {
  const user = ctx.state.user;
  const lang = user?.language === "es" ? "es" : "en";
  const greetingName =
    (user?.name?.trim() || tFor(lang, "common.thereFallback"))
      .split(" ")[0];
  const now = new Date();
  const greetingDate = `${tFor(lang, WEEKDAY_KEYS[now.getDay()])} · ${
    tFor(lang, MONTH_KEYS[now.getMonth()])
  } ${now.getDate()}`;

  return (
    <>
      <Head>
        <title>
          {tFor(lang, "dashboardPage.docTitle", {
            brand: tFor(lang, "brand.name"),
          })}
        </title>
        <link rel="stylesheet" href="/dashboard.css" />
      </Head>

      <div class="app">
        {
          /* Main precedes the sidebar in the DOM (CSS `.sb { order: -1 }`
            keeps it visually left) so on phones the first "My Assistant"
            link in document order is the visible in-page CTA, not the
            same-named pill inside the off-canvas drawer (PDF p8). */
        }
        <main class="main">
          <DashTopbar
            greetingDate={greetingDate}
            greetingName={greetingName}
          />
          <div class="content">
            <DashboardPage />
          </div>
        </main>
        <DashSidebar active="home" />
      </div>
      {
        /* One-shot coachmark — self-gates on localStorage so SSR is
          unaffected and the overlay only appears on a user's first
          visit after onboarding. */
      }
      <AssistantCoachmark />
      {
        /* Welcome-back pill — self-gates on ?welcome=back; renders
          nothing for fresh users or already-on-page navigation. */
      }
      <WelcomeBackToast />
    </>
  );
});
