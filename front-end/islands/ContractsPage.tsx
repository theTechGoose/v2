/**
 * Top-level data island for /contracts. The SSR route renders only the
 * page shell; this island fetches contracts + customers + quotes from the
 * backend on mount, derives the moods, and renders the schedule strip and
 * tracks.
 */
import { useEffect, useState } from "preact/hooks";
import { type Contract, contractsClient } from "../clients/contracts.ts";
import { clientsClient, type CustomerCard } from "../clients/clients.ts";
import { type QuoteCard, quotesClient } from "../clients/quotes.ts";
import {
  ContractsHero,
  ContractsKpis,
  ScheduleStrip,
} from "../components/ContractsSections.tsx";
import ContractTrack from "./ContractTrack.tsx";
import ContractCard from "./ContractCard.tsx";
import { toContractCard } from "../lib/contracts-shape.ts";
import {
  CardGridSkeleton,
  PageHeaderSkeleton,
  ShimmerStyle,
} from "../components/Skeletons.tsx";

interface State {
  loading: boolean;
  error: string | null;
  contracts: Contract[];
  customers: CustomerCard[];
  quotes: QuoteCard[];
}

const INITIAL: State = {
  loading: true,
  error: null,
  contracts: [],
  customers: [],
  quotes: [],
};

function parseMoney(s: string): number {
  const n = Number(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export default function ContractsPage() {
  const [s, setS] = useState<State>(INITIAL);

  useEffect(() => {
    let alive = true;
    Promise.all([
      contractsClient.list().catch(() => [] as Contract[]),
      clientsClient.list().catch(() => [] as CustomerCard[]),
      quotesClient.list().catch(() => [] as QuoteCard[]),
    ]).then(([contracts, customers, quotes]) => {
      if (!alive) return;
      setS({ loading: false, error: null, contracts, customers, quotes });
    }).catch((err: Error) => {
      if (!alive) return;
      setS({ ...INITIAL, loading: false, error: err.message });
    });
    return () => {
      alive = false;
    };
  }, []);

  if (s.loading) {
    return (
      <>
        <ShimmerStyle />
        <PageHeaderSkeleton />
        <CardGridSkeleton rows={3} />
      </>
    );
  }
  if (s.error) {
    return <div class="kpage-error">Couldn't load contracts: {s.error}</div>;
  }

  const { contracts, customers, quotes } = s;
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

  return (
    <>
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
        count={`${inProgress.length} ${
          inProgress.length === 1 ? "job" : "jobs"
        } · crew on site`}
        defaultOpen
        storageKey="contracts:track:01"
      >
        {inProgress.length > 0
          ? (
            <div class="kcards">
              {inProgress.map((c, i) => (
                <ContractCard key={c.id} c={c} idx={i} />
              ))}
            </div>
          )
          : (
            <div class="kempty">
              Nothing in flight today. As soon as a customer signs a contract
              from the assistant, it lands here.
            </div>
          )}
      </ContractTrack>

      <ContractTrack
        num="02"
        title="Starting soon"
        count={`${startingSoon.length} ${
          startingSoon.length === 1 ? "job" : "jobs"
        } · next 14 days`}
        defaultOpen={false}
        storageKey="contracts:track:02"
      >
        {startingSoon.length > 0
          ? (
            <div class="kcards">
              {startingSoon.map((c, i) => (
                <ContractCard key={c.id} c={c} idx={i} />
              ))}
            </div>
          )
          : <div class="kempty">No jobs scheduled in the next 14 days.</div>}
      </ContractTrack>

      <ContractTrack
        num="03"
        title="Wrapping up"
        count={`${wrappingUp.length} ${
          wrappingUp.length === 1 ? "job" : "jobs"
        } · final invoice next`}
        defaultOpen={false}
        storageKey="contracts:track:03"
      >
        {wrappingUp.length > 0
          ? (
            <div class="kcards">
              {wrappingUp.map((c, i) => (
                <ContractCard key={c.id} c={c} idx={i} />
              ))}
            </div>
          )
          : (
            <div class="kempty">
              Nothing within a week of completion right now.
            </div>
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
    </>
  );
}
