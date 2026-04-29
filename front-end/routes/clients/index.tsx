import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import {
  ClientsHero,
  ClientsSegments,
  LoopBar,
  TopClients,
} from "../../components/ClientsSections.tsx";
import ClientsBoard from "../../islands/ClientsBoard.tsx";
import { CLIENTS, SEGMENTS, TOP_CLIENTS } from "../../lib/clients-seed.ts";

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default define.page(function ClientsRoute(ctx) {
  const user = ctx.state.user;
  const greetingName = (user?.name ?? user?.phoneNumber ?? "Diego").split(" ")[0];
  const now = new Date();
  const greetingDate = `${WEEKDAY[now.getDay()]} · ${MONTH[now.getMonth()]} ${now.getDate()}`;

  // Aggregates for the hero — derived from seed until backend rolls these up.
  const activeJobs = CLIENTS.filter((c) => c.status === "active").length;
  const owedTotal = CLIENTS.reduce((sum, c) => sum + (c.balance > 0 ? c.balance : 0), 0);
  const quietCount = CLIENTS.filter((c) => c.status === "cold").length;

  return (
    <>
      <Head>
        <title>Clients · Paperwork Monsters</title>
        <link rel="stylesheet" href="/dashboard.css" />
        <link rel="stylesheet" href="/clients.css" />
      </Head>

      <div class="app">
        <DashSidebar active="clients" />
        <main class="main">
          <DashTopbar
            greetingDate={greetingDate}
            greetingName={greetingName}
          />
          <div class="content">
            <ClientsHero
              totalClients={CLIENTS.length}
              activeJobs={activeJobs}
              owedTotal={owedTotal}
              quietCount={quietCount}
            />
            <LoopBar />
            <ClientsBoard>
              <TopClients rows={TOP_CLIENTS} />
              <ClientsSegments rows={SEGMENTS} />
            </ClientsBoard>
          </div>
        </main>
      </div>
    </>
  );
});
