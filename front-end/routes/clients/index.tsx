import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import { getSessionId } from "../../lib/auth.ts";
import {
  clientsClient,
  type ClientSegmentsResponse,
  type CustomerCard,
  type TopClientsResponse,
} from "../../clients/clients.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import {
  ClientsHero,
  ClientsSegments,
  LoopBar,
  TopClients,
} from "../../components/ClientsSections.tsx";
import ClientsBoard from "../../islands/ClientsBoard.tsx";

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

async function settle<T>(p: Promise<T>, fallback: T): Promise<T> {
  try { return await p; } catch { return fallback; }
}

/**
 * Pick 3 cards for "today's loop": the most stale leads + accounts that owe.
 * Deterministic order so SSR/CSR agree without an extra round-trip to the
 * backend's (future) loop endpoint.
 */
function pickLoop(cards: CustomerCard[]): CustomerCard[] {
  const candidates = cards.filter((c) => c.status === "lead" || c.status === "owes");
  candidates.sort((a, b) => b.daysSinceContact - a.daysSinceContact);
  return candidates.slice(0, 3);
}

export default define.page(async function ClientsRoute(ctx) {
  const sessionId = getSessionId(ctx.req);
  const opts = { sessionId };
  const user = ctx.state.user;
  const greetingName = (user?.name ?? user?.phoneNumber ?? "Diego").split(" ")[0];
  const now = new Date();
  const greetingDate = `${WEEKDAY[now.getDay()]} · ${MONTH[now.getMonth()]} ${now.getDate()}`;

  const [cards, topResp, segmentsResp] = await Promise.all([
    settle(clientsClient.list(opts),       [] as CustomerCard[]),
    settle(clientsClient.top(5, opts),     { results: [] } as TopClientsResponse),
    settle(clientsClient.segments(opts),   { segments: [] } as ClientSegmentsResponse),
  ]);

  const activeJobs  = cards.filter((c) => c.status === "active").length;
  const owedTotal   = cards.reduce((sum, c) => sum + (c.balanceCents > 0 ? c.balanceCents : 0), 0) / 100;
  const quietCount  = cards.filter((c) => c.status === "cold").length;
  const loopPicks   = pickLoop(cards);

  return (
    <>
      <Head>
        <title>Clients · Paperwork Monsters</title>
        <link key="css-dashboard" rel="stylesheet" href="/dashboard.css" />
        <link key="css-clients" rel="stylesheet" href="/clients.css" />
      </Head>

      <div class="app">
        <DashSidebar
          active="clients"
          user={user ? { name: user.name, phoneNumber: user.phoneNumber } : undefined}
        />
        <main class="main">
          <DashTopbar
            greetingDate={greetingDate}
            greetingName={greetingName}
          />
          <div class="content">
            <ClientsHero
              totalClients={cards.length}
              activeJobs={activeJobs}
              owedTotal={owedTotal}
              quietCount={quietCount}
            />
            <LoopBar picks={loopPicks} />
            <ClientsBoard cards={cards}>
              <TopClients rows={topResp.results} />
              <ClientsSegments rows={segmentsResp.segments} />
            </ClientsBoard>
          </div>
        </main>
      </div>
    </>
  );
});
