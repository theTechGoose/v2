/**
 * REQ-143 — /field/workers. The dashboard shell around the FieldWorkersPage island;
 * data comes from /api/field/* (clients/field.ts). The sidebar's active tab is "workers".
 */
import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import SiteFooter from "../../components/SiteFooter.tsx";
import { type Lang, tFor } from "../../lib/i18n.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import FieldWorkersPage from "../../islands/FieldWorkersPage.tsx";

export default define.page(function FieldFieldWorkersPageRoute(ctx) {
  const user = ctx.state.user;
  const lang: Lang = user?.language === "es" ? "es" : "en";
  const greetingName =
    (user?.name?.trim() || tFor(lang, "common.thereFallback")).split(" ")[0];

  return (
    <>
      <Head>
        <title>{tFor(lang, "field.wk.docTitle")}</title>
        <link key="css-dashboard" rel="stylesheet" href="/dashboard.css" />
        <link key="css-field" rel="stylesheet" href="/field.css" />
      </Head>
      <div class="app">
        <DashSidebar active="workers" />
        <main class="main">
          <DashTopbar greetingName={greetingName} />
          <div class="content">
            <FieldWorkersPage />
            <SiteFooter lang={lang} />
          </div>
        </main>
      </div>
    </>
  );
});
