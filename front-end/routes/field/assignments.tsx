/**
 * REQ-143 — /field/assignments. The dashboard shell around the FieldAssignmentsPage island;
 * data comes from /api/field/* (clients/field.ts). The sidebar's active tab is "assignments".
 */
import { asset, Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import { getSessionId } from "../../lib/auth.ts";
import { loadFieldAssignmentsSeed } from "../../lib/field-ssr.ts";
import DocTitle from "../../components/DocTitle.tsx";
import SiteFooter from "../../components/SiteFooter.tsx";
import { type Lang, tFor } from "../../lib/i18n.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import FieldAssignmentsPage from "../../islands/FieldAssignmentsPage.tsx";
import { greetingFirstName } from "../../../shared/quote-flow/outbound-identity.ts";

export default define.page(async function FieldFieldAssignmentsPageRoute(ctx) {
  const user = ctx.state.user;
  // REQ-730 (demo-loop c5, c2-p13-p): read the lists here so the first HTML
  // carries the rows, not a "Loading…" line; null → the island fetches on hydration.
  const seed = await loadFieldAssignmentsSeed(getSessionId(ctx.req));
  const lang: Lang = user?.language === "es" ? "es" : "en";
  const greetingName = greetingFirstName(user?.name);

  return (
    <>
      <Head>
        <DocTitle lang={lang} title={(l) => tFor(l, "field.asg.docTitle")} />
        <link
          key="css-dashboard"
          rel="stylesheet"
          href={asset("/dashboard.css")}
        />
        <link key="css-field" rel="stylesheet" href={asset("/field.css")} />
      </Head>
      <div class="app">
        <DashSidebar active="assignments" />
        <main class="main">
          <DashTopbar
            pageTitleKey="nav.assignments"
            greetingName={greetingName}
          />
          <div class="content">
            <FieldAssignmentsPage seed={seed} />
            <SiteFooter lang={lang} compact />
          </div>
        </main>
      </div>
    </>
  );
});
