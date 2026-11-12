/**
 * REQ-210 — /work-orders. The dashboard shell around the WorkOrdersPage
 * island (the account's numbered WO- documents); data comes from
 * /api/work-orders (clients/work-orders.ts). The sidebar's active tab is
 * "workOrders" (lib/nav-tree.ts, Billing folder).
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
import WorkOrdersPage from "../../islands/WorkOrdersPage.tsx";

export default define.page(function WorkOrdersRoute(ctx) {
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
            <WorkOrdersPage />
            <SiteFooter lang={lang} />
          </div>
        </main>
      </div>
    </>
  );
});
