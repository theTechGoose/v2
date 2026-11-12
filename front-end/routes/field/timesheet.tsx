/**
 * REQ-192 — /field/timesheet. The dashboard shell around the TimesheetPage island; data comes
 * from /api/timeclock/* (clients/timeclock.ts). The sidebar's active tab is "timesheet".
 */
import { asset, Head } from "fresh/runtime";
import {
  greetingFirstName,
  personLanguage,
} from "../../../shared/person-name/mod.ts"; // REQ-624/631
import { define } from "../../utils.ts";
import SiteFooter from "../../components/SiteFooter.tsx";
import { type Lang, tFor } from "../../lib/i18n.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import TimesheetPage from "../../islands/TimesheetPage.tsx";

export default define.page(function TimesheetRoute(ctx) {
  const user = ctx.state.user;
  const lang: Lang = personLanguage(user) === "es" ? "es" : "en";
  const greetingName = greetingFirstName(user) ||
    tFor(lang, "common.thereFallback");
  return (
    <>
      <Head>
        <title>{tFor(lang, "ts.docTitle")}</title>
        <link
          key="css-dashboard"
          rel="stylesheet"
          href={asset("/dashboard.css")}
        />
        <link key="css-field" rel="stylesheet" href={asset("/field.css")} />
      </Head>
      <div class="app">
        <DashSidebar active="timesheet" />
        <main class="main">
          <DashTopbar greetingName={greetingName} />
          <div class="content">
            <TimesheetPage />
            <SiteFooter lang={lang} />
          </div>
        </main>
      </div>
    </>
  );
});
