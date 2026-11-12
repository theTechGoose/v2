/**
 * REQ-210 — /wo/:id. The dashboard shell around one work order
 * (WorkOrderPage island): status walk, edit, version history, delete.
 * Contractor-only; the sidebar stays on "workOrders".
 */
import { asset, Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import DocTitle from "../../components/DocTitle.tsx";
import SiteFooter from "../../components/SiteFooter.tsx";
import { type Lang, tFor } from "../../lib/i18n.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import WorkOrderPage from "../../islands/WorkOrderPage.tsx";
import { greetingFirstName } from "../../../shared/quote-flow/outbound-identity.ts";

export default define.page(function WorkOrderRoute(ctx) {
  const user = ctx.state.user;
  const lang: Lang = user?.language === "es" ? "es" : "en";
  const greetingName = greetingFirstName(user?.name);

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
          <DashTopbar
            pageTitleKey="nav.workOrders"
            greetingName={greetingName}
          />
          <div class="content">
            <WorkOrderPage id={ctx.params.id} />
            <SiteFooter lang={lang} />
          </div>
        </main>
      </div>
    </>
  );
});
