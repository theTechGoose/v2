import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import InvoicesPage from "../../islands/InvoicesPage.tsx";

const WEEKDAY = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MONTH = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export default define.page(function InvoicesRoute(ctx) {
  const user = ctx.state.user;
  const greetingName = (user?.name?.trim() || "there").split(" ")[0];
  const now = new Date();
  const greetingDate = `${WEEKDAY[now.getDay()]} · ${
    MONTH[now.getMonth()]
  } ${now.getDate()}`;

  return (
    <>
      <Head>
        <title>Invoices · Paperwork Monsters</title>
        <link key="css-dashboard" rel="stylesheet" href="/dashboard.css" />
        <link key="css-quotes" rel="stylesheet" href="/quotes.css" />
      </Head>
      <div class="app">
        <DashSidebar active="invoices" />
        <main class="main">
          <DashTopbar greetingDate={greetingDate} greetingName={greetingName} />
          <div class="content">
            <InvoicesPage />
          </div>
        </main>
      </div>
    </>
  );
});
