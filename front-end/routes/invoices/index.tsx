import { asset, Head } from "fresh/runtime";
import { greetingFirstName } from "../../../shared/person-name/mod.ts"; // REQ-624
import { define } from "../../utils.ts";
import { resolveSsrLang } from "../../lib/ssr-lang.ts";
import type { Lang } from "../../lib/lang.ts";
import DocTitle from "../../components/DocTitle.tsx";
import SiteFooter from "../../components/SiteFooter.tsx";
import { tFor } from "../../lib/i18n.ts";
import { greetingDate as greetingDateIn } from "../../lib/greeting-date.ts"; // REQ-944
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import InvoicesPage from "../../islands/InvoicesPage.tsx";

export default define.page(function InvoicesRoute(ctx) {
  const user = ctx.state.user;
  // REQ-709 (demo-loop c5, m4): the islands' language (?lang= > account >
  // pm_lang), so the tab title and footer match the page they sit on.
  const lang: Lang = resolveSsrLang(ctx) ?? "es";
  const greetingName = greetingFirstName(user);
  // REQ-944: today in the business's zone, not the server's
  const greetingDate = greetingDateIn(lang, user?.businessTimezone);

  return (
    <>
      <Head>
        <DocTitle lang={lang} title={(l) => tFor(l, "invoicesPage.docTitle")} />
        <link
          key="css-dashboard"
          rel="stylesheet"
          href={asset("/dashboard.css")}
        />
        <link key="css-quotes" rel="stylesheet" href={asset("/quotes.css")} />
        <link
          key="css-search-select"
          rel="stylesheet"
          href={asset("/search-select.css")}
        />
      </Head>
      <div class="app">
        <DashSidebar active="invoices" />
        <main class="main">
          <DashTopbar
            pageTitleKey="nav.invoices"
            greetingDate={greetingDate}
            greetingName={greetingName}
          />
          <div class="content">
            <InvoicesPage />
            <SiteFooter lang={lang} compact />
          </div>
        </main>
      </div>
    </>
  );
});
