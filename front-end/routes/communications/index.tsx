/**
 * REQ-915/916 — /communications, the Phone page: the account's line, its
 * inbox, the number shop, the softphone and the call log. The dashboard shell
 * around the PhonePage island; the sidebar's active row is "phone" (the
 * Communications folder, REQ-914).
 */
import { asset, Head } from "fresh/runtime";
import { greetingFirstName } from "../../../shared/person-name/mod.ts"; // REQ-624
import { define } from "../../utils.ts";
import { resolveSsrLang } from "../../lib/ssr-lang.ts";
import DocTitle from "../../components/DocTitle.tsx";
import { appTitle } from "../../lib/doc-title.ts";
import SiteFooter from "../../components/SiteFooter.tsx";
import { type Lang, tFor } from "../../lib/i18n.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import PhonePage from "../../islands/PhonePage.tsx";

export default define.page(function CommunicationsRoute(ctx) {
  const user = ctx.state.user;
  // REQ-709: the islands' language (?lang= > account > pm_lang)
  const lang: Lang = resolveSsrLang(ctx) ?? "es";
  const greetingName = greetingFirstName(user);

  return (
    <>
      <Head>
        <DocTitle
          lang={lang}
          title={(l) =>
            appTitle(
              l,
              tFor(l, "comms.docTitle"),
              tFor(l, "nav.communications"),
            )}
        />
        <link
          key="css-dashboard"
          rel="stylesheet"
          href={asset("/dashboard.css")}
        />
        <link key="css-field" rel="stylesheet" href={asset("/field.css")} />
        <link key="css-phone" rel="stylesheet" href={asset("/phone.css")} />
      </Head>
      <div class="app">
        <DashSidebar active="phone" />
        <main class="main">
          <DashTopbar pageTitleKey="nav.phone" greetingName={greetingName} />
          <div class="content">
            <PhonePage />
            <SiteFooter lang={lang} compact />
          </div>
        </main>
      </div>
    </>
  );
});
