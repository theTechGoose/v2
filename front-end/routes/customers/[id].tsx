/**
 * REQ-924 — `/customers/<id>`: one customer's page, in the app's shell (left bar, top bar, main
 * screen). The sidebar rests on the Customers context with her row active; the top bar keeps only the
 * menu button, the search (scoped to Customers, her results first) and EN/ES; the main screen is the
 * workspace island, which reads GET /customers/:id/workspace.
 */
import { asset, Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import { resolveSsrLang } from "../../lib/ssr-lang.ts";
import DocTitle from "../../components/DocTitle.tsx";
import { appTitle } from "../../lib/doc-title.ts";
import { type Lang, tFor } from "../../lib/i18n.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import CustomerWorkspace from "../../islands/CustomerWorkspace.tsx";
import { getSessionId } from "../../lib/auth.ts";
import { clientsClient } from "../../clients/clients.ts";

export default define.page(async function CustomerRoute(ctx) {
  const id = ctx.params.id;
  const lang: Lang = resolveSsrLang(ctx) ?? "es";
  // the name for the tab title and the search's "In <name>" — the island reads everything else
  const customer = await clientsClient.get(id, {
    sessionId: getSessionId(ctx.req),
  })
    .catch(() => null);
  const name = customer?.name ?? "";
  return (
    <>
      <Head>
        <DocTitle
          lang={lang}
          title={(l) => appTitle(l, name, tFor(l, "nav.customers"))}
        />
        <link
          key="css-dashboard"
          rel="stylesheet"
          href={asset("/dashboard.css")}
        />
        <link key="css-clients" rel="stylesheet" href={asset("/clients.css")} />
        {/* the reused flows' own styles: the new-invoice form, the payment form, the send sheet */}
        <link key="css-quotes" rel="stylesheet" href={asset("/quotes.css")} />
        <link
          key="css-payments"
          rel="stylesheet"
          href={asset("/payments.css")}
        />
        <link
          key="css-search-select"
          rel="stylesheet"
          href={asset("/search-select.css")}
        />
        <link
          key="css-customer-workspace"
          rel="stylesheet"
          href={asset("/customer-workspace.css")}
        />
      </Head>
      <div class="app">
        <DashSidebar active={`customer:${id}`} />
        <main class="main">
          <DashTopbar
            minimal
            searchScope={{ customerId: id, customerName: name }}
          />
          <div class="content">
            <CustomerWorkspace customerId={id} />
          </div>
        </main>
      </div>
    </>
  );
});
// the auth gate is routes/customers/_middleware.ts (the whole folder)
