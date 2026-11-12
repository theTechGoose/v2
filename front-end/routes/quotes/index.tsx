import { asset, Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import DocTitle from "../../components/DocTitle.tsx";
import SiteFooter from "../../components/SiteFooter.tsx";
import { tFor } from "../../lib/i18n.ts";
import { getSessionId } from "../../lib/auth.ts";
import { loadQuotesSeed } from "../../lib/quotes-ssr.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import QuotesPage from "../../islands/QuotesPage.tsx";
import { greetingFirstName } from "../../../shared/quote-flow/outbound-identity.ts";

export default define.page(async function QuotesRoute(ctx) {
  const user = ctx.state.user;
  // REQ-471 (demo-loop c3, p8-pair2-d): read the pipeline here so the first
  // HTML carries the quote cards; null → the island fetches on hydration.
  const seed = await loadQuotesSeed(getSessionId(ctx.req));
  const lang = user?.language === "es" ? "es" : "en";
  // The greeting date is computed reactively inside DashTopbar now; here we
  // only supply the name, with a localized "there" fallback.
  const greetingName = greetingFirstName(user?.name);

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
          <DashTopbar greetingName={greetingName} />
          <div class="content">
            <QuotesPage seed={seed} />
            <SiteFooter lang={lang} compact />
          </div>
        </main>
      </div>
    </>
  );
});
