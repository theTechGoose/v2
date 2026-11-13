import { asset, Head } from "fresh/runtime";
import { greetingFirstName } from "../../../shared/person-name/mod.ts"; // REQ-624
import { define } from "../../utils.ts";
import { resolveSsrLang } from "../../lib/ssr-lang.ts";
import type { Lang } from "../../lib/lang.ts";
import DocTitle from "../../components/DocTitle.tsx";
import SiteFooter from "../../components/SiteFooter.tsx";
import { tFor } from "../../lib/i18n.ts";
import { getSessionId } from "../../lib/auth.ts";
import { loadQuotesSeed } from "../../lib/quotes-ssr.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import QuotesPage from "../../islands/QuotesPage.tsx";

export default define.page(async function QuotesRoute(ctx) {
  const user = ctx.state.user;
  // REQ-471 (demo-loop c3, p8-pair2-d): read the pipeline here so the first
  // HTML carries the quote cards; null → the island fetches on hydration.
  const seed = await loadQuotesSeed(getSessionId(ctx.req));
  // REQ-709 (demo-loop c5, m4): the islands' language (?lang= > account >
  // pm_lang), so the tab title and footer match the page they sit on.
  const lang: Lang = resolveSsrLang(ctx) ?? "es";
  // The greeting date is computed reactively inside DashTopbar now; here we
  // only supply the name, with a localized "there" fallback.
  const greetingName = greetingFirstName(user);

  return (
    <>
      <Head>
        {/* UX-16: dictionary-driven like dashboard/invoices/settings. */}
        <DocTitle lang={lang} title={(l) => tFor(l, "quotesPage.docTitle")} />
        <link
          key="css-dashboard"
          rel="stylesheet"
          href={asset("/dashboard.css")}
        />
        <link key="css-quotes" rel="stylesheet" href={asset("/quotes.css")} />
      </Head>

      <div class="app">
        <DashSidebar active="quotes" />
        <main class="main">
          <DashTopbar
            pageTitleKey="nav.quotes"
            greetingName={greetingName}
          />
          <div class="content">
            <QuotesPage seed={seed} />
            <SiteFooter lang={lang} compact />
          </div>
        </main>
      </div>
    </>
  );
});
