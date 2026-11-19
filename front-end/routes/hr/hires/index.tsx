/**
 * REQ-883 — /hr/hires. The dashboard shell around the HrHiresPage island; data comes
 * from /api/hr/* (clients/hr.ts). The sidebar's active tab is "hires".
 */
import { asset, Head } from "fresh/runtime";
import { greetingFirstName } from "../../../../shared/person-name/mod.ts";
import { define } from "../../../utils.ts";
import { resolveSsrLang } from "../../../lib/ssr-lang.ts";
import DocTitle from "../../../components/DocTitle.tsx";
import { appTitle } from "../../../lib/doc-title.ts";
import SiteFooter from "../../../components/SiteFooter.tsx";
import { type Lang, tFor } from "../../../lib/i18n.ts";
import DashSidebar from "../../../islands/DashSidebar.tsx";
import DashTopbar from "../../../islands/DashTopbar.tsx";
import HrHiresPage from "../../../islands/HrHiresPage.tsx";

export default define.page(function HrRoute(ctx) {
  const user = ctx.state.user;
  const lang: Lang = resolveSsrLang(ctx) ?? "es";
  const greetingName = greetingFirstName(user);

  return (
    <>
      <Head>
        <DocTitle
          lang={lang}
          title={(l) =>
            appTitle(l, tFor(l, "hr.hires.docTitle"), tFor(l, "nav.hr"))}
        />
        <link
          key="css-dashboard"
          rel="stylesheet"
          href={asset("/dashboard.css")}
        />
        <link key="css-field" rel="stylesheet" href={asset("/field.css")} />
        <link key="css-hr" rel="stylesheet" href={asset("/hr.css")} />
      </Head>
      <div class="app">
        <DashSidebar active="hires" />
        <main class="main">
          <DashTopbar pageTitleKey="nav.hires" greetingName={greetingName} />
          <div class="content">
            <HrHiresPage />
            <SiteFooter lang={lang} />
          </div>
        </main>
      </div>
    </>
  );
});
