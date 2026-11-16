/**
 * REQ-856 — /roof. The dashboard shell around the RoofMeasurePage island: an
 * address → the free aerial window → traced facets → sqft and squares, kept on
 * the account through /api/roof/*. The sidebar's active row is "roof".
 */
import { asset, Head } from "fresh/runtime";
import { greetingFirstName } from "../../../shared/person-name/mod.ts"; // REQ-624
import { define } from "../../utils.ts";
import { resolveSsrLang } from "../../lib/ssr-lang.ts";
import DocTitle from "../../components/DocTitle.tsx";
import SiteFooter from "../../components/SiteFooter.tsx";
import { type Lang, tFor } from "../../lib/i18n.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import RoofMeasurePage from "../../islands/RoofMeasurePage.tsx";

export default define.page(function RoofRoute(ctx) {
  const user = ctx.state.user;
  // REQ-709: the islands' language (?lang= > account > pm_lang)
  const lang: Lang = resolveSsrLang(ctx) ?? "es";
  const greetingName = greetingFirstName(user);

  return (
    <>
      <Head>
        <DocTitle lang={lang} title={(l) => tFor(l, "roof.docTitle")} />
        <link
          key="css-dashboard"
          rel="stylesheet"
          href={asset("/dashboard.css")}
        />
        <link key="css-field" rel="stylesheet" href={asset("/field.css")} />
        <link key="css-roof" rel="stylesheet" href={asset("/roof.css")} />
      </Head>
      <div class="app">
        <DashSidebar active="roof" />
        <main class="main">
          <DashTopbar pageTitleKey="nav.roof" greetingName={greetingName} />
          <div class="content">
            <RoofMeasurePage initialLang={lang} />
            <SiteFooter lang={lang} compact />
          </div>
        </main>
      </div>
    </>
  );
});
