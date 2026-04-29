import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import { getSessionId } from "../../lib/auth.ts";
import {
  contractsClient,
  type Contract,
} from "../../clients/contracts.ts";
import { clientsClient, type CustomerCard } from "../../clients/clients.ts";
import { quotesClient, type QuoteCard } from "../../clients/quotes.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import {
  ContractsHero,
  ContractsKpis,
  ScheduleStrip,
} from "../../components/ContractsSections.tsx";
import ContractTrack from "../../islands/ContractTrack.tsx";
import ContractCard from "../../islands/ContractCard.tsx";
import { toContractCard } from "../../lib/contracts-shape.ts";

async function settle<T>(p: Promise<T>, fallback: T): Promise<T> {
  try { return await p; } catch { return fallback; }
}

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default define.page(async function ContractsRoute(ctx) {
  const sessionId = getSessionId(ctx.req);
  const opts = { sessionId };
  const user = ctx.state.user;

  const [contracts, customers, quotes] = await Promise.all([
    settle(contractsClient.list(undefined, opts), [] as Contract[]),
    settle(clientsClient.list(opts),               [] as CustomerCard[]),
    settle(quotesClient.list(undefined, opts),     [] as QuoteCard[]),
  ]);

  const customerNames = new Map(customers.map((c) => [c.id, c.name]));
  const quoteSummaries = new Map(
    quotes
      .filter((q) => typeof q.summary === "string" && q.summary)
      .map((q) => [q.id, q.summary as string]),
  );

  const now = new Date();
  const cards = contracts.map((contract, index) =>
    toContractCard({ contract, customerNames, quoteSummaries, now, index })
  );

  const inProgress = cards.filter((c) => c.mood === "active");
  const startingSoon = cards.filter((c) => c.mood === "starting-soon");
  const wrappingUp = cards.filter((c) => c.mood === "wrapping-up");
  const closed = cards.filter((c) => c.mood === "completed");
  const drafts = cards.filter((c) => c.mood === "draft" || c.mood === "stale");

  const liveCards = [...inProgress, ...startingSoon, ...wrappingUp];

  const dollarsOf = (xs: typeof cards) =>
    xs.reduce((sum, c) => sum + parseMoney(c.total), 0);
  const leftOf = (xs: typeof cards) =>
    xs.reduce((sum, c) => sum + parseMoney(c.left), 0);

  const totalCommitted = dollarsOf(liveCards);
  const inProgressValue = dollarsOf(inProgress);
  const startingSoonValue = dollarsOf(startingSoon);
  const wrappingUpLeft = leftOf(wrappingUp);
  const closedValue = dollarsOf(closed);
  const pendingDeposits = leftOf(startingSoon);

  const greetingName = (user?.name ?? user?.phoneNumber ?? "Diego").split(" ")[0];
  const greetingDate = `${WEEKDAY[now.getDay()]} · ${MONTH[now.getMonth()]} ${now.getDate()}`;

  return (
    <>
      <Head>
        <title>Contracts · Paperwork Monsters</title>
        <link key="css-dashboard" rel="stylesheet" href="/dashboard.css" />
        <link key="css-contracts" rel="stylesheet" href="/contracts.css" />
      </Head>

      <div class="app">
        <DashSidebar active="contracts" />
        <main class="main">
          <DashTopbar greetingDate={greetingDate} greetingName={greetingName} />
          <div class="content">
            <ContractsHero
              totalValue={totalCommitted}
              contractCount={liveCards.length}
              inFlightCount={inProgress.length}
              inFlightValue={inProgressValue}
              startingSoonCount={startingSoon.length}
              pendingDeposits={pendingDeposits}
            />
            <ContractsKpis
              inProgressCount={inProgress.length}
              inProgressValue={inProgressValue}
              startingSoonCount={startingSoon.length}
              startingSoonValue={startingSoonValue}
              wrappingUpCount={wrappingUp.length}
              wrappingUpLeft={wrappingUpLeft}
              closedCount={closed.length}
              closedValue={closedValue}
            />

            <ScheduleStrip cards={liveCards} />

            <ContractTrack
              num="01"
              title="In progress"
              count={`${inProgress.length} ${inProgress.length === 1 ? "job" : "jobs"} · crew on site`}
              defaultOpen
              storageKey="contracts:track:01"
            >
              {inProgress.length > 0 ? (
                <div class="kcards">
                  {inProgress.map((c, i) => <ContractCard key={c.id} c={c} idx={i} />)}
                </div>
              ) : (
                <div class="kempty">
                  Nothing in flight today. As soon as a customer signs a contract from
                  the assistant, it lands here.
                </div>
              )}
            </ContractTrack>

            <ContractTrack
              num="02"
              title="Starting soon"
              count={`${startingSoon.length} ${startingSoon.length === 1 ? "job" : "jobs"} · next 14 days`}
              defaultOpen={false}
              storageKey="contracts:track:02"
            >
              {startingSoon.length > 0 ? (
                <div class="kcards">
                  {startingSoon.map((c, i) => <ContractCard key={c.id} c={c} idx={i} />)}
                </div>
              ) : (
                <div class="kempty">No jobs scheduled in the next 14 days.</div>
              )}
            </ContractTrack>

            <ContractTrack
              num="03"
              title="Wrapping up"
              count={`${wrappingUp.length} ${wrappingUp.length === 1 ? "job" : "jobs"} · final invoice next`}
              defaultOpen={false}
              storageKey="contracts:track:03"
            >
              {wrappingUp.length > 0 ? (
                <div class="kcards">
                  {wrappingUp.map((c, i) => <ContractCard key={c.id} c={c} idx={i} />)}
                </div>
              ) : (
                <div class="kempty">Nothing within a week of completion right now.</div>
              )}
            </ContractTrack>

            {drafts.length > 0 && (
              <ContractTrack
                num="04"
                title="Drafts"
                count={`${drafts.length} ${drafts.length === 1 ? "draft" : "drafts"}`}
                defaultOpen={false}
                storageKey="contracts:track:04"
              >
                <div class="kcards">
                  {drafts.map((c, i) => <ContractCard key={c.id} c={c} idx={i} />)}
                </div>
              </ContractTrack>
            )}
          </div>
        </main>
      </div>
    </>
  );
});

/** "$1,200" or "$0" → 1200 / 0. Robust to commas + leading $. */
function parseMoney(s: string): number {
  const n = Number(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
