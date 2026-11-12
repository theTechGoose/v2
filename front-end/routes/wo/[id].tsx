/**
 * REQ-210 — /wo/:id. The dashboard shell around one work order
 * (WorkOrderPage island): status walk, edit, version history, delete.
 * Contractor-only; the sidebar stays on "workOrders".
 */
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
import WorkOrderPage from "../../islands/WorkOrderPage.tsx";

export default define.page(function WorkOrderRoute(ctx) {
  const user = ctx.state.user;
  const lang: Lang = personLanguage(user) === "es" ? "es" : "en";
  const greetingName = greetingFirstName(user) ||
    tFor(lang, "common.thereFallback");

  return (
    <>
      <Head>
        <title>{tFor(lang, "workOrders.docTitle")}</title>
        <link
          key="css-dashboard"
          rel="stylesheet"
          href={asset("/dashboard.css")}
        />
        <link key="css-field" rel="stylesheet" href={asset("/field.css")} />
      </Head>
      <div class="app">
        <DashSidebar active="workOrders" />
        <main class="main">
          <DashTopbar greetingName={greetingName} />
          <div class="content">
            <WorkOrderPage id={ctx.params.id} />
            <SiteFooter lang={lang} />
          </div>
        </main>
      </div>
    </>
  );
});
