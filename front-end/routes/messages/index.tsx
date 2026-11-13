/**
 * REQ-784 — /messages is the Outbox (demo-loop cycle dv1, issue d12; Raphael:
 * "And yes to a sent message outbox."). It used to 302 to /assistant (P6.14),
 * which left no way to check what was sent or in which language (cycle 1
 * m33). The dashboard shell around the OutboxPage island; the sidebar's
 * active row is "outbox" (lib/nav-tree.ts, on the root).
 */
import { asset, Head } from "fresh/runtime";
import { greetingFirstName } from "../../../shared/person-name/mod.ts"; // REQ-624
import { define } from "../../utils.ts";
import { resolveSsrLang } from "../../lib/ssr-lang.ts";
import DocTitle from "../../components/DocTitle.tsx";
import SiteFooter from "../../components/SiteFooter.tsx";
import { type Lang, tFor } from "../../lib/i18n.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import OutboxPage from "../../islands/OutboxPage.tsx";

export default define.page(function MessagesRoute(ctx) {
  const user = ctx.state.user;
  // REQ-709: the islands' language (?lang= > account > pm_lang)
  const lang: Lang = resolveSsrLang(ctx) ?? "es";
  const greetingName = greetingFirstName(user);

  return (
    <>
      <Head>
        <DocTitle lang={lang} title={(l) => tFor(l, "outbox.docTitle")} />
        <link
          key="css-dashboard"
          rel="stylesheet"
          href={asset("/dashboard.css")}
        />
        <link key="css-field" rel="stylesheet" href={asset("/field.css")} />
      </Head>
      <div class="app">
        <DashSidebar active="outbox" />
        <main class="main">
          <DashTopbar pageTitleKey="nav.outbox" greetingName={greetingName} />
          <div class="content">
            <OutboxPage />
            <SiteFooter lang={lang} compact />
          </div>
        </main>
      </div>
    </>
  );
});
