import { asset, Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import DocTitle from "../../components/DocTitle.tsx";
import { type Lang, tFor } from "../../lib/i18n.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import AdminPage from "../../islands/AdminPage.tsx";
import SiteFooter from "../../components/SiteFooter.tsx";
import StaffNamePrompt from "../../islands/StaffNamePrompt.tsx";
import {
  greetingFirstName,
  isPlaceholderName,
} from "../../../shared/quote-flow/outbound-identity.ts";

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
  const lang: Lang = user?.language === "es" ? "es" : "en";
  const greetingName = greetingFirstName(user?.name);
  // REQ-355 — staff never meet the customer wizard's name question (REQ-227): ask here
  const askName = user?.superAdmin === true && isPlaceholderName(user?.name);
  const now = new Date();
  const greetingDate = `${tFor(lang, WEEKDAY_KEYS[now.getDay()])} · ${
    tFor(lang, MONTH_KEYS[now.getMonth()])
  } ${now.getDate()}`;

  return (
    <>
      <Head>
        {/* "Admin" is the role's name in both languages (REQ-191) */}
        <DocTitle
          lang={lang}
          title={(l) => `Admin · ${tFor(l, "brand.name")}`}
        />
        <link rel="stylesheet" href={asset("/dashboard.css")} />
      </Head>
      <div class="app">
        <DashSidebar active="admin" />
        <main class="main">
          {
            /* REQ-507 (demo m25): the account search would search the staff account's own
              customers — on /admin the users search below is the only one */
          }
          <DashTopbar
            greetingDate={greetingDate}
            greetingName={greetingName}
            search={false}
          />
          <div class="content">
            {askName && <StaffNamePrompt />}
            <AdminPage selfId={user?.id} />
            {/* REQ-269/367: the footer follows the topbar's EN/ES toggle */}
            <SiteFooter lang={lang} compact />
          </div>
        </main>
      </div>
    </>
  );
});
