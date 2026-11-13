/**
 * REQ-143 — /field/tasks. The dashboard shell around the FieldTasksPage island;
 * data comes from /api/field/* (clients/field.ts). The sidebar's active tab is "tasks".
 */
import { asset, Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import { resolveSsrLang } from "../../lib/ssr-lang.ts";
import { getSessionId } from "../../lib/auth.ts";
import { loadFieldTasksSeed } from "../../lib/field-ssr.ts";
import { todayIso } from "../../lib/field.ts";
import DocTitle from "../../components/DocTitle.tsx";
import SiteFooter from "../../components/SiteFooter.tsx";
import { type Lang, tFor } from "../../lib/i18n.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import FieldTasksPage from "../../islands/FieldTasksPage.tsx";
import { greetingFirstName } from "../../../shared/quote-flow/outbound-identity.ts";

export default define.page(async function FieldFieldTasksPageRoute(ctx) {
  const user = ctx.state.user;
  // REQ-730 (demo-loop c5, c2-p13-p): read the lists here so the first HTML
  // carries the rows, not a "Loading…" line; null → the island fetches on hydration.
  const seed = await loadFieldTasksSeed(getSessionId(ctx.req), todayIso());
  // REQ-709 (demo-loop c5, m4): the islands' language (?lang= > account >
  // pm_lang), so the tab title and footer match the page they sit on.
  const lang: Lang = resolveSsrLang(ctx) ?? "es";
  const greetingName = greetingFirstName(user?.name);

  return (
    <>
      <Head>
        <DocTitle lang={lang} title={(l) => tFor(l, "field.tk.docTitle")} />
        <link
          key="css-dashboard"
          rel="stylesheet"
          href={asset("/dashboard.css")}
        />
        <link key="css-field" rel="stylesheet" href={asset("/field.css")} />
        <link
          key="css-search-select"
          rel="stylesheet"
          href={asset("/search-select.css")}
        />
      </Head>
      <div class="app">
        <DashSidebar active="tasks" />
        <main class="main">
          <DashTopbar
            pageTitleKey="nav.tasks"
            greetingName={greetingName}
          />
          <div class="content">
            <FieldTasksPage seed={seed} />
            <SiteFooter lang={lang} compact />
          </div>
        </main>
      </div>
    </>
  );
});
