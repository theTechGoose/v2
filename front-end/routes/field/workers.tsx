/**
 * REQ-143 — /field/workers. The dashboard shell around the FieldWorkersPage island;
 * data comes from /api/field/* (clients/field.ts). The sidebar's active tab is "workers".
 */
import { asset, Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import DocTitle from "../../components/DocTitle.tsx";
import SiteFooter from "../../components/SiteFooter.tsx";
import { type Lang, tFor } from "../../lib/i18n.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import FieldWorkersPage from "../../islands/FieldWorkersPage.tsx";
import { greetingFirstName } from "../../../shared/quote-flow/outbound-identity.ts";

export default define.page(function FieldFieldWorkersPageRoute(ctx) {
  const user = ctx.state.user;
  const lang: Lang = user?.language === "es" ? "es" : "en";
  const greetingName = greetingFirstName(user?.name);

  return (
    <>
      <Head>
        <DocTitle lang={lang} title={(l) => tFor(l, "field.wk.docTitle")} />
        <link
          key="css-dashboard"
          rel="stylesheet"
          href={asset("/dashboard.css")}
        />
        <link key="css-field" rel="stylesheet" href={asset("/field.css")} />
      </Head>
      <div class="app">
        <DashSidebar active="workers" />
        <main class="main">
          <DashTopbar
            pageTitleKey="nav.workers"
            greetingName={greetingName}
          />
          <div class="content">
            <FieldWorkersPage />
            <SiteFooter lang={lang} compact />
          </div>
        </main>
      </div>
    </>
  );
});
