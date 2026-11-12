/**
 * REQ-146 — /admins. The dashboard shell around the AdminsPage island; data
 * comes from /api/me/admins (clients/admins.ts). The sidebar's active tab is "admins".
 */
import { asset, Head } from "fresh/runtime";
import { greetingFirstName } from "../../../shared/person-name/mod.ts"; // REQ-624
import { define } from "../../utils.ts";
import SiteFooter from "../../components/SiteFooter.tsx";
import { type Lang, tFor } from "../../lib/i18n.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import AdminsPage from "../../islands/AdminsPage.tsx";

export default define.page(function AdminsPageRoute(ctx) {
  const user = ctx.state.user;
  const lang: Lang = user?.language === "es" ? "es" : "en";
  const greetingName = greetingFirstName(user) ||
    tFor(lang, "common.thereFallback");

  return (
    <>
      <Head>
        <title>{tFor(lang, "admins.docTitle")}</title>
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
          <DashTopbar greetingName={greetingName} />
          <div class="content">
            <AdminsPage />
            <SiteFooter lang={lang} />
          </div>
        </main>
      </div>
    </>
  );
});
