/**
 * REQ-856 / REQ-891 — /tools/satellite (was /roof, which 302s here). The
 * dashboard shell around the SatelliteMeasurePage island: an address → the
 * free aerial window → traced sections (roof or flat) → sqft and squares, kept
 * on the account through /api/roof/*. The sidebar's active row is "satellite"
 * inside the Tools folder.
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
import SatelliteMeasurePage from "../../islands/SatelliteMeasurePage.tsx";

export default define.page(function SatelliteRoute(ctx) {
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
        <DashSidebar active="satellite" />
        <main class="main">
          <DashTopbar
            pageTitleKey="nav.satellite"
            greetingName={greetingName}
          />
          <div class="content">
            <SatelliteMeasurePage initialLang={lang} />
            <SiteFooter lang={lang} compact />
          </div>
        </main>
      </div>
    </>
  );
});
