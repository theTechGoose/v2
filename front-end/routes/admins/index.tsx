/**
 * REQ-146 — /admins. The dashboard shell around the AdminsPage island; data
 * comes from /api/me/admins (clients/admins.ts). The sidebar's active tab is "admins".
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
import AdminsPage from "../../islands/AdminsPage.tsx";

export default define.page(function AdminsPageRoute(ctx) {
  const user = ctx.state.user;
  // REQ-709 (demo-loop c5, m4): the islands' language (?lang= > account >
  // pm_lang), so the tab title and footer match the page they sit on.
  const lang: Lang = resolveSsrLang(ctx) ?? "es";
  const greetingName = greetingFirstName(user);

  return (
    <>
      <Head>
        <DocTitle lang={lang} title={(l) => tFor(l, "admins.docTitle")} />
        <link
          key="css-dashboard"
          rel="stylesheet"
          href={asset("/dashboard.css")}
        />
        <link key="css-field" rel="stylesheet" href={asset("/field.css")} />
      </Head>
      <div class="app">
        <DashSidebar active="admins" />
        <main class="main">
          <DashTopbar
            pageTitleKey="nav.admins"
            greetingName={greetingName}
          />
          <div class="content">
            <AdminsPage />
            <SiteFooter lang={lang} compact />
          </div>
        </main>
      </div>
    </>
  );
});
