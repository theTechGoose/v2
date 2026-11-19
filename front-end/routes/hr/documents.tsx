/**
 * REQ-883 — /hr/documents. The dashboard shell around the HrDocumentsPage island; data comes
 * from /api/hr/* (clients/hr.ts). The sidebar's active tab is "hrDocuments".
 */
import { asset, Head } from "fresh/runtime";
import { greetingFirstName } from "../../../shared/person-name/mod.ts";
import { define } from "../../utils.ts";
import { resolveSsrLang } from "../../lib/ssr-lang.ts";
import DocTitle from "../../components/DocTitle.tsx";
import { appTitle } from "../../lib/doc-title.ts";
import SiteFooter from "../../components/SiteFooter.tsx";
import { type Lang, tFor } from "../../lib/i18n.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import HrDocumentsPage from "../../islands/HrDocumentsPage.tsx";

export default define.page(function HrRoute(ctx) {
  const user = ctx.state.user;
  const lang: Lang = resolveSsrLang(ctx) ?? "es";
  const greetingName = greetingFirstName(user);
  const docId = new URL(ctx.req.url).searchParams.get("doc") ?? undefined;
  return (
    <>
      <Head>
        <DocTitle
          lang={lang}
          title={(l) =>
            appTitle(l, tFor(l, "hr.docs.docTitle"), tFor(l, "nav.hr"))}
        />
        <link
          key="css-dashboard"
          rel="stylesheet"
          href={asset("/dashboard.css")}
        />
        <link key="css-field" rel="stylesheet" href={asset("/field.css")} />
        <link key="css-hr" rel="stylesheet" href={asset("/hr.css")} />
      </Head>
      <div class="app">
        <DashSidebar active="hrDocuments" />
        <main class="main">
          <DashTopbar
            pageTitleKey="nav.hrDocuments"
            greetingName={greetingName}
          />
          <div class="content">
            <HrDocumentsPage initialDocId={docId} />
            <SiteFooter lang={lang} />
          </div>
        </main>
      </div>
    </>
  );
});
