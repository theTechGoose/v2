import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import { type Lang, tFor } from "../../lib/i18n.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import ClientsPage from "../../islands/ClientsPage.tsx";

const WEEKDAY_KEYS = [
  "date.weekday.sunday",
  "date.weekday.monday",
  "date.weekday.tuesday",
  "date.weekday.wednesday",
  "date.weekday.thursday",
  "date.weekday.friday",
  "date.weekday.saturday",
];
const MONTH_KEYS = [
  "date.month.january",
  "date.month.february",
  "date.month.march",
  "date.month.april",
  "date.month.may",
  "date.month.june",
  "date.month.july",
  "date.month.august",
  "date.month.september",
  "date.month.october",
  "date.month.november",
  "date.month.december",
];

export default define.page(function ClientsRoute(ctx) {
  const user = ctx.state.user;
  const lang: Lang = user?.language === "es" ? "es" : "en";
  const greetingName =
    (user?.name?.trim() || tFor(lang, "common.thereFallback")).split(" ")[0];
  const now = new Date();
  const greetingDate = `${tFor(lang, WEEKDAY_KEYS[now.getDay()])} · ${
    tFor(lang, MONTH_KEYS[now.getMonth()])
  } ${now.getDate()}`;

  return (
    <>
      <Head>
        <title>{tFor(lang, "clientsRoute.docTitle")}</title>
        <link key="css-dashboard" rel="stylesheet" href="/dashboard.css" />
        <link key="css-clients" rel="stylesheet" href="/clients.css" />
      </Head>

      <div class="app">
        <DashSidebar active="clients" />
        <main class="main">
          <DashTopbar
            greetingDate={greetingDate}
            greetingName={greetingName}
          />
          <div class="content">
            <ClientsPage />
          </div>
        </main>
      </div>
    </>
  );
});
