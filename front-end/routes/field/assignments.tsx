/**
 * REQ-143 — /field/assignments. The dashboard shell around the FieldAssignmentsPage island;
 * data comes from /api/field/* (clients/field.ts). The sidebar's active tab is "assignments".
 */
import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import SiteFooter from "../../components/SiteFooter.tsx";
import { type Lang, tFor } from "../../lib/i18n.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import FieldAssignmentsPage from "../../islands/FieldAssignmentsPage.tsx";

export default define.page(function FieldFieldAssignmentsPageRoute(ctx) {
  const user = ctx.state.user;
  const lang: Lang = user?.language === "es" ? "es" : "en";
  const greetingName =
    (user?.name?.trim() || tFor(lang, "common.thereFallback")).split(" ")[0];

  return (
    <>
      <Head>
        <title>{tFor(lang, "field.asg.docTitle")}</title>
        <link key="css-dashboard" rel="stylesheet" href="/dashboard.css" />
        <link key="css-field" rel="stylesheet" href="/field.css" />
      </Head>
      <div class="app">
        <DashSidebar active="assignments" />
        <main class="main">
          <DashTopbar greetingName={greetingName} />
          <div class="content">
            <FieldAssignmentsPage />
            <SiteFooter lang={lang} />
          </div>
        </main>
      </div>
    </>
  );
});
