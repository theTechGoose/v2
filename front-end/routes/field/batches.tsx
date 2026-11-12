/**
 * REQ-143 — /field/batches. The dashboard shell around the FieldBatchesPage island;
 * data comes from /api/field/* (clients/field.ts). The sidebar's active tab is "batches".
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
import FieldBatchesPage from "../../islands/FieldBatchesPage.tsx";

export default define.page(function FieldFieldBatchesPageRoute(ctx) {
  const user = ctx.state.user;
  const lang: Lang = personLanguage(user) === "es" ? "es" : "en";
  const greetingName = greetingFirstName(user) ||
    tFor(lang, "common.thereFallback");

  return (
    <>
      <Head>
        <title>{tFor(lang, "field.lt.docTitle")}</title>
        <link
          key="css-dashboard"
          rel="stylesheet"
          href={asset("/dashboard.css")}
        />
        <link key="css-field" rel="stylesheet" href={asset("/field.css")} />
      </Head>
      <div class="app">
        <DashSidebar active="batches" />
        <main class="main">
          <DashTopbar greetingName={greetingName} />
          <div class="content">
            <FieldBatchesPage />
            <SiteFooter lang={lang} />
          </div>
        </main>
      </div>
    </>
  );
});
