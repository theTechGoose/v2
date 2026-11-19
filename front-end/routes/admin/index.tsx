import { asset, Head } from "fresh/runtime";
import { greetingFirstName } from "../../../shared/person-name/mod.ts"; // REQ-624
import { define } from "../../utils.ts";
import DocTitle from "../../components/DocTitle.tsx";
import { type Lang, tFor } from "../../lib/i18n.ts";
import { greetingDate as greetingDateIn } from "../../lib/greeting-date.ts"; // REQ-944
import { resolveSsrLang } from "../../lib/ssr-lang.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import AdminPage from "../../islands/AdminPage.tsx";
import SiteFooter from "../../components/SiteFooter.tsx";
import StaffNamePrompt from "../../islands/StaffNamePrompt.tsx";
import { isPlaceholderName } from "../../../shared/quote-flow/outbound-identity.ts";

export default define.page(function AdminRoute(ctx) {
  const user = ctx.state.user;
  // REQ-592 (demo-loop cycle 4, m5): the same language the islands render in
  // (?lang= > the account's language > pm_lang), not user.language alone — an
  // es staff account on /admin?lang=en got a Spanish footer under English.
  const lang: Lang = resolveSsrLang(ctx) ?? "es";
  const greetingName = greetingFirstName(user);
  // REQ-355 — staff never meet the customer wizard's name question (REQ-227): ask here
  const askName = user?.superAdmin === true && isPlaceholderName(user?.name);
  // REQ-944: today in the business's zone, not the server's
  const greetingDate = greetingDateIn(lang, user?.businessTimezone);

  return (
    <>
      <Head>
        {/* "Admin" is the role's name in both languages (REQ-191) */}
        <DocTitle
          lang={lang}
          title={(l) => `Admin · ${tFor(l, "brand.name")}`}
        />
        <link rel="stylesheet" href={asset("/dashboard.css")} />
      </Head>
      <div class="app">
        {/* REQ-908 AMENDMENT (dm18, p2) — the rail is this session's from the first paint */}
        <DashSidebar
          active="admin"
          seed={{
            superAdmin: user?.superAdmin === true,
            name: user?.name ?? null,
          }}
        />
        <main class="main">
          {
            /* REQ-507 (demo m25): the account search would search the staff account's own
              customers — on /admin the users search below is the only one */
          }
          <DashTopbar
            greetingDate={greetingDate}
            greetingName={greetingName}
            search={false}
          />
          <div class="content">
            {askName && <StaffNamePrompt />}
            <AdminPage selfId={user?.id} />
            {/* REQ-269/367: the footer follows the topbar's EN/ES toggle */}
            <SiteFooter lang={lang} compact />
          </div>
        </main>
      </div>
    </>
  );
});
