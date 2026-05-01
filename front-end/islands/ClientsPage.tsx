/**
 * Top-level data island for /clients. The SSR route renders only the page
 * shell (sidebar + topbar); this island fetches the full payload from the
 * backend on mount and renders the editorial board.
 */
import { useEffect, useState } from "preact/hooks";
import {
  clientsClient,
  type ClientSegmentsResponse,
  type CustomerCard,
  type TopClientsResponse,
} from "../clients/clients.ts";
import {
  ClientsHero,
  ClientsSegments,
  LoopBar,
  TopClients,
} from "../components/ClientsSections.tsx";
import ClientsBoard from "./ClientsBoard.tsx";
import {
  CardGridSkeleton,
  PageHeaderSkeleton,
  ShimmerStyle,
} from "../components/Skeletons.tsx";

interface State {
  loading: boolean;
  error: string | null;
  cards: CustomerCard[];
  top: TopClientsResponse;
  segments: ClientSegmentsResponse;
}

const INITIAL: State = {
  loading: true,
  error: null,
  cards: [],
  top: { results: [] },
  segments: { segments: [] },
};

function pickLoop(cards: CustomerCard[]): CustomerCard[] {
  const candidates = cards.filter((c) =>
    c.status === "lead" || c.status === "owes"
  );
  candidates.sort((a, b) => b.daysSinceContact - a.daysSinceContact);
  return candidates.slice(0, 3);
}

export default function ClientsPage() {
  const [s, setS] = useState<State>(INITIAL);

  useEffect(() => {
    let alive = true;
    Promise.all([
      clientsClient.list().catch(() => [] as CustomerCard[]),
      clientsClient.top(5).catch(() => ({ results: [] } as TopClientsResponse)),
      clientsClient.segments().catch(
        () => ({ segments: [] } as ClientSegmentsResponse),
      ),
    ]).then(([cards, top, segments]) => {
      if (!alive) return;
      setS({ loading: false, error: null, cards, top, segments });
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
    return <div class="cpage-error">Couldn't load clients: {s.error}</div>;
  }

  const { cards, top, segments } = s;
  const activeJobs = cards.filter((c) => c.status === "active").length;
  const owedTotal = cards.reduce(
    (sum, c) => sum + (c.balanceCents > 0 ? c.balanceCents : 0),
    0,
  ) / 100;
  const quietCount = cards.filter((c) => c.status === "cold").length;
  const loopPicks = pickLoop(cards);

  return (
    <>
      <ClientsHero
        totalClients={cards.length}
        activeJobs={activeJobs}
        owedTotal={owedTotal}
        quietCount={quietCount}
      />
      <LoopBar picks={loopPicks} />
      <ClientsBoard cards={cards}>
        <TopClients rows={top.results} />
        <ClientsSegments rows={segments.segments} />
      </ClientsBoard>
    </>
  );
}
