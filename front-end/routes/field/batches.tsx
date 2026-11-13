/**
 * REQ-143 — /field/batches. The dashboard shell around the FieldBatchesPage island;
 * data comes from /api/field/* (clients/field.ts). The sidebar's active tab is "batches".
 */
import { asset, Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import { getSessionId } from "../../lib/auth.ts";
import { loadFieldBatchesSeed } from "../../lib/field-ssr.ts";
import DocTitle from "../../components/DocTitle.tsx";
import SiteFooter from "../../components/SiteFooter.tsx";
import { type Lang, tFor } from "../../lib/i18n.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import FieldBatchesPage from "../../islands/FieldBatchesPage.tsx";
import { greetingFirstName } from "../../../shared/quote-flow/outbound-identity.ts";

export default define.page(async function FieldFieldBatchesPageRoute(ctx) {
  const user = ctx.state.user;
  // REQ-730 (demo-loop c5, c2-p13-p): read the lists here so the first HTML
  // carries the rows, not a "Loading…" line; null → the island fetches on hydration.
  const seed = await loadFieldBatchesSeed(getSessionId(ctx.req));
  const lang: Lang = user?.language === "es" ? "es" : "en";
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
            <FieldBatchesPage seed={seed} />
            <SiteFooter lang={lang} compact />
          </div>
        </main>
      </div>
    </>
  );
});
