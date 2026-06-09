import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import { tFor } from "../../lib/i18n.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import ContractsPage from "../../islands/ContractsPage.tsx";

export default define.page(function ContractsRoute(ctx) {
  const user = ctx.state.user;
  const lang = user?.language ?? "en";
  const greetingName =
    (user?.name?.trim() || tFor(lang, "common.greetingFallbackName")).split(
      " ",
    )[0];
  const now = new Date();
  const greetingDate = `${tFor(lang, `common.weekday.${now.getDay()}`)} · ${
    tFor(lang, `common.month.${now.getMonth()}`)
  } ${now.getDate()}`;

  return (
    <>
      <Head>
        <title>{tFor(lang, "contractsPage.docTitle")}</title>
        <link key="css-dashboard" rel="stylesheet" href="/dashboard.css" />
        <link key="css-contracts" rel="stylesheet" href="/contracts.css" />
      </Head>

      <div class="app">
        <DashSidebar active="contracts" />
        <main class="main">
          <DashTopbar greetingDate={greetingDate} greetingName={greetingName} />
          <div class="content">
            <ContractsPage />
          </div>
        </main>
      </div>
    </>
  );
});
