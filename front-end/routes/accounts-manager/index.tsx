import { asset, Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import { resolveSsrLang } from "../../lib/ssr-lang.ts";
import type { Lang } from "../../lib/lang.ts";
import DocTitle from "../../components/DocTitle.tsx";
import SiteFooter from "../../components/SiteFooter.tsx";
import { tFor } from "../../lib/i18n.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import { greetingFirstName } from "../../../shared/quote-flow/outbound-identity.ts";

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
  // REQ-709 (demo-loop c5, m4): the islands' language (?lang= > account >
  // pm_lang), so the tab title and footer match the page they sit on.
  const lang: Lang = resolveSsrLang(ctx) ?? "es";
  const greetingName = greetingFirstName(user?.name);

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
            <SiteFooter lang={lang} compact />
          </div>
        </main>
      </div>
    </>
  );
});
