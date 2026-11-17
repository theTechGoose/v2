/**
 * REQ-839 — /field/services. The dashboard shell around the FieldServicesPage island;
 * data comes from /api/field/task-types (clients/field.ts). The sidebar's active tab is "services".
 */
import { asset, Head } from "fresh/runtime";
import { greetingFirstName } from "../../../shared/person-name/mod.ts"; // REQ-624
import { define } from "../../utils.ts";
import { resolveSsrLang } from "../../lib/ssr-lang.ts";
import { getSessionId } from "../../lib/auth.ts";
import { loadFieldServicesSeed } from "../../lib/field-ssr.ts";
import DocTitle from "../../components/DocTitle.tsx";
import SiteFooter from "../../components/SiteFooter.tsx";
import { type Lang, tFor } from "../../lib/i18n.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import FieldServicesPage from "../../islands/FieldServicesPage.tsx";

export default define.page(
  async function FieldServicesPageRoute(ctx) {
    const user = ctx.state.user;
    // REQ-730 (demo-loop c5, c2-p13-p): read the lists here so the first HTML
    // carries the rows, not a "Loading…" line; null → the island fetches on hydration.
    const seed = await loadFieldServicesSeed(getSessionId(ctx.req));
    // REQ-709 (demo-loop c5, m4): the islands' language (?lang= > account >
    // pm_lang), so the tab title and footer match the page they sit on.
    const lang: Lang = resolveSsrLang(ctx) ?? "es";
    const greetingName = greetingFirstName(user);

    return (
      <>
        <Head>
          <DocTitle
            lang={lang}
            title={(l) => tFor(l, "field.svc.docTitle")}
          />
          <link
            key="css-dashboard"
            rel="stylesheet"
            href={asset("/dashboard.css")}
          />
          <link key="css-field" rel="stylesheet" href={asset("/field.css")} />
        </Head>
        <div class="app">
          <DashSidebar active="services" />
          <main class="main">
            <DashTopbar
              pageTitleKey="nav.services"
              greetingName={greetingName}
            />
            <div class="content">
              <FieldServicesPage seed={seed} />
              <SiteFooter lang={lang} compact />
            </div>
          </main>
        </div>
      </>
    );
  },
);
