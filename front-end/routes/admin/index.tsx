import { asset, Head } from "fresh/runtime";
import {
  greetingFirstName,
  personLanguage,
} from "../../../shared/person-name/mod.ts"; // REQ-624
import { define } from "../../utils.ts";
import SiteFooter from "../../components/SiteFooter.tsx";
import { type Lang, tFor } from "../../lib/i18n.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import AdminPage from "../../islands/AdminPage.tsx";

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

export default define.page(function AdminRoute(ctx) {
  const user = ctx.state.user;
  const lang: Lang = personLanguage(user) === "es" ? "es" : "en";
  const greetingName = greetingFirstName(user) ||
    tFor(lang, "common.thereFallback");
  const now = new Date();
  const greetingDate = `${tFor(lang, WEEKDAY_KEYS[now.getDay()])} · ${
    tFor(lang, MONTH_KEYS[now.getMonth()])
  } ${now.getDate()}`;

  return (
    <>
      <Head>
        <title>Admin · {tFor(lang, "brand.name")}</title>
        <link rel="stylesheet" href={asset("/dashboard.css")} />
      </Head>
      <div class="app">
        <DashSidebar active="admin" />
        <main class="main">
          <DashTopbar greetingDate={greetingDate} greetingName={greetingName} />
          <div class="content">
            <AdminPage />
            <SiteFooter lang={lang} />
          </div>
        </main>
      </div>
    </>
  );
});
