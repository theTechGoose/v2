import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import { tFor } from "../../lib/i18n.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import QuotesPage from "../../islands/QuotesPage.tsx";

export default define.page(function QuotesRoute(ctx) {
  const user = ctx.state.user;
  const lang = user?.language === "es" ? "es" : "en";
  // The greeting date is computed reactively inside DashTopbar now; here we
  // only supply the name, with a localized "there" fallback.
  const greetingName =
    (user?.name?.trim() || tFor(lang, "common.thereFallback")).split(" ")[0];

  return (
    <>
      <Head>
        {/* UX-16: dictionary-driven like dashboard/invoices/settings. */}
        <title>{tFor(lang, "quotesPage.docTitle")}</title>
        <link key="css-dashboard" rel="stylesheet" href="/dashboard.css" />
        <link key="css-quotes" rel="stylesheet" href="/quotes.css" />
      </Head>

      <div class="app">
        <DashSidebar active="quotes" />
        <main class="main">
          <DashTopbar greetingName={greetingName} />
          <div class="content">
            <QuotesPage />
          </div>
        </main>
      </div>
    </>
  );
});
