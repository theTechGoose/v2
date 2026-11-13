/**
 * REQ-143 — /field/batches. The dashboard shell around the FieldBatchesPage island;
 * data comes from /api/field/* (clients/field.ts). The sidebar's active tab is "batches".
 */
import { asset, Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import { resolveSsrLang } from "../../lib/ssr-lang.ts";
import DocTitle from "../../components/DocTitle.tsx";
import SiteFooter from "../../components/SiteFooter.tsx";
import { type Lang, tFor } from "../../lib/i18n.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import FieldBatchesPage from "../../islands/FieldBatchesPage.tsx";
import { greetingFirstName } from "../../../shared/quote-flow/outbound-identity.ts";

export default define.page(function FieldFieldBatchesPageRoute(ctx) {
  const user = ctx.state.user;
  // REQ-709 (demo-loop c5, m4): the islands' language (?lang= > account >
  // pm_lang), so the tab title and footer match the page they sit on.
  const lang: Lang = resolveSsrLang(ctx) ?? "es";
  const greetingName = greetingFirstName(user?.name);

  return (
    <>
      <Head>
        <DocTitle lang={lang} title={(l) => tFor(l, "field.lt.docTitle")} />
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
          <DashTopbar
            pageTitleKey="nav.batches"
            greetingName={greetingName}
          />
          <div class="content">
            <FieldBatchesPage />
            <SiteFooter lang={lang} compact />
          </div>
        </main>
      </div>
    </>
  );
});
