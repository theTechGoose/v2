/**
 * REQ-210 — /work-orders. The dashboard shell around the WorkOrdersPage
 * island (the account's numbered WO- documents); data comes from
 * /api/work-orders (clients/work-orders.ts). The sidebar's active tab is
 * "workOrders" (lib/nav-tree.ts, Billing folder).
 */
import { asset, Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import DocTitle from "../../components/DocTitle.tsx";
import SiteFooter from "../../components/SiteFooter.tsx";
import { type Lang, tFor } from "../../lib/i18n.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import WorkOrdersPage from "../../islands/WorkOrdersPage.tsx";
import { greetingFirstName } from "../../../shared/quote-flow/outbound-identity.ts";

export default define.page(function WorkOrdersRoute(ctx) {
  const user = ctx.state.user;
  const lang: Lang = user?.language === "es" ? "es" : "en";
  const greetingName = greetingFirstName(user?.name) ??
    tFor(lang, "common.thereFallback");

  return (
    <>
      <Head>
        <DocTitle lang={lang} title={(l) => tFor(l, "workOrders.docTitle")} />
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
