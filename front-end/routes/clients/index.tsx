import { asset, Head } from "fresh/runtime";
import { greetingFirstName } from "../../../shared/person-name/mod.ts"; // REQ-624
import { define } from "../../utils.ts";
import { resolveSsrLang } from "../../lib/ssr-lang.ts";
import DocTitle from "../../components/DocTitle.tsx";
import SiteFooter from "../../components/SiteFooter.tsx";
import { type Lang, tFor } from "../../lib/i18n.ts";
import { greetingDate as greetingDateIn } from "../../lib/greeting-date.ts"; // REQ-944
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import ClientsPage from "../../islands/ClientsPage.tsx";
import { getSessionId } from "../../lib/auth.ts";
import { profileClient } from "../../clients/profile.ts";
import { tradeKindFor } from "../../../shared/quote-flow/trade-fit.ts"; // REQ-743

export default define.page(async function ClientsRoute(ctx) {
  const user = ctx.state.user;
  // REQ-743 (cycle 5, p18-6c): the trade decides whether an empty
  // repeat-visits panel shows on a customer card (service trades only)
  const profile = await profileClient.get({ sessionId: getSessionId(ctx.req) })
    .catch(() => null);
  const tradeKind = tradeKindFor(
    profile?.identity?.businessName ?? profile?.identity?.displayName,
  );
  // REQ-709 (demo-loop c5, m4): the islands' language (?lang= > account >
  // pm_lang), so the tab title and footer match the page they sit on.
  const lang: Lang = resolveSsrLang(ctx) ?? "es";
  // REQ-1075: the customer page's Delete customer lands on ?deleted=<name> — "<name> deleted"
  // is in the first paint
  const deletedName = ctx.url.searchParams.get("deleted") ?? undefined;
  const greetingName = greetingFirstName(user);
  // REQ-944: today in the business's zone, not the server's
  const greetingDate = greetingDateIn(lang, user?.businessTimezone);

  return (
    <>
      <Head>
        <DocTitle lang={lang} title={(l) => tFor(l, "clientsRoute.docTitle")} />
        <link
          key="css-dashboard"
          rel="stylesheet"
          href={asset("/dashboard.css")}
        />
        <link key="css-clients" rel="stylesheet" href={asset("/clients.css")} />
      </Head>

      <div class="app">
        <DashSidebar active="customers" />
        <main class="main">
          <DashTopbar
            // REQ-924: the Customers context — the search is scoped to Customers (the board keeps its title, REQ-619)
            searchScope={{}}
            pageTitleKey="nav.clients"
            greetingDate={greetingDate}
            greetingName={greetingName}
          />
          <div class="content">
            <ClientsPage tradeKind={tradeKind} deletedName={deletedName} />
            <SiteFooter lang={lang} compact />
          </div>
        </main>
      </div>
    </>
  );
});
