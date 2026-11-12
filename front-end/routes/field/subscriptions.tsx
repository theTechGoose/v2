/**
 * REQ-143 — /field/subscriptions. The dashboard shell around the FieldSubscriptionsPage island;
 * data comes from /api/field/* (clients/field.ts). The sidebar's active tab is "subscriptions".
 */
import { asset, Head } from "fresh/runtime";
import { greetingFirstName } from "../../../shared/person-name/mod.ts"; // REQ-624
import { define } from "../../utils.ts";
import SiteFooter from "../../components/SiteFooter.tsx";
import { type Lang, tFor } from "../../lib/i18n.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import FieldSubscriptionsPage from "../../islands/FieldSubscriptionsPage.tsx";

export default define.page(function FieldFieldSubscriptionsPageRoute(ctx) {
  const user = ctx.state.user;
  const lang: Lang = user?.language === "es" ? "es" : "en";
  const greetingName = greetingFirstName(user) ||
    tFor(lang, "common.thereFallback");

  return (
    <>
      <Head>
        <title>{tFor(lang, "field.subs.docTitle")}</title>
        <link
          key="css-dashboard"
          rel="stylesheet"
          href={asset("/dashboard.css")}
        />
        <link key="css-field" rel="stylesheet" href={asset("/field.css")} />
        <link
          key="css-search-select"
          rel="stylesheet"
          href={asset("/search-select.css")}
        />
      </Head>
      <div class="app">
        <DashSidebar active="subscriptions" />
        <main class="main">
          <DashTopbar greetingName={greetingName} />
          <div class="content">
            <FieldSubscriptionsPage />
            <SiteFooter lang={lang} />
          </div>
        </main>
      </div>
    </>
  );
});
