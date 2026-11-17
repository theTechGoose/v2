/**
 * REQ-192 — /field/timesheet. The dashboard shell around the TimesheetPage island; data comes
 * from /api/timeclock/* (clients/timeclock.ts). The sidebar's active tab is "timesheet".
 * Merged onto demo-fixes: the language is the islands' (REQ-709 resolveSsrLang, which reads the
 * person's language — REQ-631), the tab title follows the EN/ES switch (REQ-367 DocTitle), and a
 * nameless person is greeted namelessly (REQ-423) — like its sibling field routes.
 */
import { asset, Head } from "fresh/runtime";
import { greetingFirstName } from "../../../shared/person-name/mod.ts"; // REQ-624
import { define } from "../../utils.ts";
import { resolveSsrLang } from "../../lib/ssr-lang.ts";
import DocTitle from "../../components/DocTitle.tsx";
import SiteFooter from "../../components/SiteFooter.tsx";
import { type Lang, tFor } from "../../lib/i18n.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import TimesheetPage from "../../islands/TimesheetPage.tsx";

export default define.page(function TimesheetRoute(ctx) {
  const user = ctx.state.user;
  const lang: Lang = resolveSsrLang(ctx) ?? "es";
  const greetingName = greetingFirstName(user);
  return (
    <>
      <Head>
        <DocTitle lang={lang} title={(l) => tFor(l, "ts.docTitle")} />
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
          <DashTopbar
            pageTitleKey="nav.timesheet"
            greetingName={greetingName}
          />
          <div class="content">
            <TimesheetPage />
            <SiteFooter lang={lang} />
          </div>
        </main>
      </div>
    </>
  );
});
