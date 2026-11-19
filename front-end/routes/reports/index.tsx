import { asset, Head } from "fresh/runtime";
import { greetingFirstName } from "../../../shared/person-name/mod.ts"; // REQ-624
import { define } from "../../utils.ts";
import { resolveSsrLang } from "../../lib/ssr-lang.ts";
import DocTitle from "../../components/DocTitle.tsx";
import SiteFooter from "../../components/SiteFooter.tsx";
import { type Lang, tFor } from "../../lib/i18n.ts";
import { greetingDate as greetingDateIn } from "../../lib/greeting-date.ts"; // REQ-944
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import ReportsPage from "../../islands/ReportsPage.tsx";

export default define.page(function ReportsRoute(ctx) {
  const user = ctx.state.user;
  // REQ-709 (demo-loop c5, m4): the islands' language (?lang= > account >
  // pm_lang), so the tab title and footer match the page they sit on.
  const lang: Lang = resolveSsrLang(ctx) ?? "es";
  const greetingName = greetingFirstName(user);
  // REQ-944: today in the business's zone, not the server's
  const greetingDate = greetingDateIn(lang, user?.businessTimezone);

  return (
    <>
      <Head>
        <DocTitle
          lang={lang}
          title={(l) => tFor(l, "reportsPage.docTitle")}
        />
        <link
          key="css-dashboard"
          rel="stylesheet"
          href={asset("/dashboard.css")}
        />
        <link key="css-quotes" rel="stylesheet" href={asset("/quotes.css")} />
        <link key="css-reports" rel="stylesheet" href={asset("/reports.css")} />
      </Head>
      <div class="app">
        <DashSidebar active="reports" />
        <main class="main">
          <DashTopbar
            pageTitleKey="nav.reports"
            greetingDate={greetingDate}
            greetingName={greetingName}
          />
          <div class="content">
            <ReportsPage initialLang={lang} />
            <SiteFooter lang={lang} compact />
          </div>
        </main>
      </div>
    </>
  );
});
