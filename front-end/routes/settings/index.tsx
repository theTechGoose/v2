import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import SettingsPage from "../../islands/SettingsPage.tsx";

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

export default define.page(function SettingsRoute(ctx) {
  const user = ctx.state.user;
  const greetingName = (user?.name?.trim() || "there").split(" ")[0];
  const now = new Date();
  const greetingDate = `${WEEKDAY[now.getDay()]} · ${
    MONTH[now.getMonth()]
  } ${now.getDate()}`;

  return (
    <>
      <Head>
        <title>Settings · Paperwork Monsters</title>
        <link rel="stylesheet" href="/dashboard.css" />
      </Head>
      <div class="app">
        <DashSidebar active="settings" />
        <main class="main">
          <DashTopbar greetingDate={greetingDate} greetingName={greetingName} />
          <div class="content">
            <SettingsPage />
          </div>
        </main>
      </div>
    </>
  );
});
