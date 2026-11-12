import { asset, Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import DocTitle from "../../components/DocTitle.tsx";
import SiteFooter from "../../components/SiteFooter.tsx";
import { tFor } from "../../lib/i18n.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";

/** Accounts-manager view.
 *
 *  Separate from the contractor view (/dashboard). Uses the regular app
 *  shell — sidebar rail + topbar + main content — but the sidebar carries
 *  NO nav tabs yet (showNav={false}) and the content area is a blank slate.
 *  Build the accounts-manager surface out from the <div class="content">
 *  below, and add tabs back to the rail when there are pages to point at.
 */
export default define.page(function AccountsManager(ctx) {
  const user = ctx.state.user;
  const lang = user?.language === "es" ? "es" : "en";
  const greetingName =
    (user?.name?.trim() || tFor(lang, "common.thereFallback"))
      .split(" ")[0];

  return (
    <>
      <Head>
        <DocTitle
          lang={lang}
          title={(l) => tFor(l, "accountsManager.docTitle")}
        />
        <link rel="stylesheet" href={asset("/dashboard.css")} />
      </Head>

      <div class="app">
        <DashSidebar showNav={false} />
        <main class="main">
          <DashTopbar greetingName={greetingName} />
          <div class="content">
            {/* Blank slate — build the accounts-manager view here. */}
            <SiteFooter lang={lang} />
          </div>
        </main>
      </div>
    </>
  );
});
