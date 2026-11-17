/**
 * REQ-883 — /hr/departments. The dashboard shell around the HrDepartmentsPage island; data comes
 * from /api/hr/* (clients/hr.ts). The sidebar's active tab is "departments".
 */
import { asset, Head } from "fresh/runtime";
import { greetingFirstName } from "../../../shared/person-name/mod.ts";
import { define } from "../../utils.ts";
import { resolveSsrLang } from "../../lib/ssr-lang.ts";
import DocTitle from "../../components/DocTitle.tsx";
import SiteFooter from "../../components/SiteFooter.tsx";
import { type Lang, tFor } from "../../lib/i18n.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import HrDepartmentsPage from "../../islands/HrDepartmentsPage.tsx";

export default define.page(function HrRoute(ctx) {
  const user = ctx.state.user;
  const lang: Lang = resolveSsrLang(ctx) ?? "es";
  const greetingName = greetingFirstName(user);
  const deptId = new URL(ctx.req.url).searchParams.get("dept") ?? undefined;
  return (
    <>
      <Head>
        <DocTitle lang={lang} title={(l) => tFor(l, "hr.depts.docTitle")} />
        <link
          key="css-dashboard"
          rel="stylesheet"
          href={asset("/dashboard.css")}
        />
        <link key="css-field" rel="stylesheet" href={asset("/field.css")} />
        <link key="css-hr" rel="stylesheet" href={asset("/hr.css")} />
      </Head>
      <div class="app">
        <DashSidebar active="departments" />
        <main class="main">
          <DashTopbar
            pageTitleKey="nav.departments"
            greetingName={greetingName}
          />
          <div class="content">
            <HrDepartmentsPage initialDeptId={deptId} />
            <SiteFooter lang={lang} />
          </div>
        </main>
      </div>
    </>
  );
});
