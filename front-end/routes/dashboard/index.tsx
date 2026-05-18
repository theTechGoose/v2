import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import DashboardPage from "../../islands/DashboardPage.tsx";
import AssistantCoachmark from "../../islands/AssistantCoachmark.tsx";
import WelcomeBackToast from "../../islands/WelcomeBackToast.tsx";

const WEEKDAY = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MONTH = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export default define.page(function Dashboard(ctx) {
  const user = ctx.state.user;
  const greetingName = (user?.name?.trim() || "there").split(" ")[0];
  const now = new Date();
  const greetingDate = `${WEEKDAY[now.getDay()]} · ${
    MONTH[now.getMonth()]
  } ${now.getDate()}`;

  return (
    <>
      <Head>
        <title>Dashboard · Paperwork Monster</title>
        <link rel="stylesheet" href="/dashboard.css" />
      </Head>

      <div class="app">
        <DashSidebar active="home" />
        <main class="main">
          <DashTopbar
            greetingDate={greetingDate}
            greetingName={greetingName}
          />
          <div class="content">
            <DashboardPage />
          </div>
        </main>
      </div>
      {/* One-shot coachmark — self-gates on localStorage so SSR is
          unaffected and the overlay only appears on a user's first
          visit after onboarding. */}
      <AssistantCoachmark />
      {/* Welcome-back pill — self-gates on ?welcome=back; renders
          nothing for fresh users or already-on-page navigation. */}
      <WelcomeBackToast />
    </>
  );
});
