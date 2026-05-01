/**
 * Top-level data island for /quotes. The SSR route renders only the page
 * shell; this island fetches the pipeline + win-rate + insight from the
 * backend on mount.
 */
import { useEffect, useState } from "preact/hooks";
import {
  type Insight,
  type QuoteCard as BackendQuoteCard,
  quotesClient,
  type WinRate,
} from "../clients/quotes.ts";
import {
  DecidedRow,
  QSideBig,
  QSideRate,
  QSideTip,
  QuotesHero,
  QuotesKpis,
} from "../components/QuotesSections.tsx";
import QuoteTrack from "./QuoteTrack.tsx";
import QuoteCard from "./QuoteCard.tsx";
import type { Quote } from "../lib/quotes-seed.ts";
import {
  CardGridSkeleton,
  PageHeaderSkeleton,
  ShimmerStyle,
} from "../components/Skeletons.tsx";

// Inner sort order for the "Out for response" track — most engaged
// (opened) at top, then sent, cooling, stale. Mirrors the reference's
// pipeline layout.
const STAGE_ORDER = { opened: 0, sent: 1, cooling: 2, stale: 3 } as const;

function initialsFromName(name: string | null | undefined): string {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function clientFromSummary(summary: string | null | undefined): string {
  if (!summary) return "—";
  const m = summary.match(/—\s*(.+)$/);
  return m ? m[1].trim() : "—";
}

function mapCard(c: BackendQuoteCard): Quote {
  const fallbackClient = clientFromSummary(c.summary);
  const client = c.customerName ?? fallbackClient;
  return {
    id: c.id,
    title: c.summary ?? "Untitled quote",
    client,
    customerId: c.customerId,
    initials: initialsFromName(c.customerName ?? fallbackClient),
    stage: c.stage,
    value: c.estimatedTotal ?? 0,
    daysIn: c.daysIn,
    opens: c.opens,
    sentDays: c.sentDays,
    decidedDays: c.decidedDays ?? undefined,
    band: ["#FFB3B3", "#FF6B6B"],
    shadow: "rgba(255,107,107,0.35)",
  };
}

interface State {
  loading: boolean;
  error: string | null;
  quotes: Quote[];
  winRate: WinRate | null;
  insight: Insight | null;
}

const INITIAL: State = {
  loading: true,
  error: null,
  quotes: [],
  winRate: null,
  insight: null,
};

export default function QuotesPage() {
  const [s, setS] = useState<State>(INITIAL);

  useEffect(() => {
    let alive = true;
    Promise.all([
      quotesClient.list().catch(() => [] as BackendQuoteCard[]),
      quotesClient.winRate(90).catch(() => null as WinRate | null),
      quotesClient.insight().catch(() => null as Insight | null),
    ]).then(([cards, winRate, insight]) => {
      if (!alive) return;
      const safeCards = Array.isArray(cards) ? cards : [];
      setS({
        loading: false,
        error: null,
        quotes: safeCards.map(mapCard),
        winRate,
        insight,
      });
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
    return <div class="qpage-error">Couldn't load quotes: {s.error}</div>;
  }

  const { quotes, winRate, insight } = s;

  const open = quotes.filter((q) =>
    ["draft", "sent", "opened", "cooling", "stale"].includes(q.stage)
  );
  const openTotal = open.reduce((acc, q) => acc + q.value, 0);
  const stale = quotes.filter((q) => q.stage === "stale");

  const out = quotes.filter((q) =>
    ["sent", "opened", "cooling", "stale"].includes(q.stage)
  );
  const outVal = out.reduce((acc, q) => acc + q.value, 0);
  const drafts = quotes.filter((q) => q.stage === "draft");
  const decided = quotes.filter((q) => ["won", "lost"].includes(q.stage));

  // Inner sort: opened > sent > cooling > stale within "Out for response".
  const outSorted = [...out].sort((a, b) => {
    const av = STAGE_ORDER[a.stage as keyof typeof STAGE_ORDER] ?? 9;
    const bv = STAGE_ORDER[b.stage as keyof typeof STAGE_ORDER] ?? 9;
    return av - bv;
  });

  const won = winRate?.won ?? decided.filter((q) => q.stage === "won").length;
  const lost = winRate?.lost ??
    (decided.length -
      (winRate?.won ?? decided.filter((q) => q.stage === "won").length));
  const decidedCount = winRate?.decided ?? decided.length;
  const winRatePct = winRate?.winRate ??
    (decidedCount ? Math.round((won / decidedCount) * 100) : 0);

  return (
    <>
      <QuotesHero
        openCount={open.length}
        openTotal={openTotal}
        staleCount={stale.length}
        // Only count quotes with a real customer link. Two unlinked quotes
        // shouldn't collapse into a single phantom "—" client (#31).
        clientCount={new Set(
          open.map((q) => q.customerId).filter((id): id is string => Boolean(id)),
        ).size}
      />
      <QuotesKpis
        outValue={outVal}
        outCount={out.length}
        draftCount={drafts.length}
        decidedCount={decidedCount}
        wonCount={won}
        lostCount={lost}
        winRate={winRatePct}
      />
      <div class="qlay">
        <div>
          <QuoteTrack
            num="01"
            title="Out for response"
            count={out.length}
            defaultOpen
            storageKey="quotes:track:01"
          >
            <div class="qcards">
              {outSorted.map((q, i) => <QuoteCard key={q.id} q={q} idx={i} />)}
            </div>
          </QuoteTrack>

          <QuoteTrack
            num="02"
            title="Drafting"
            count={drafts.length}
            defaultOpen={false}
            storageKey="quotes:track:02"
          >
            <div class="qcards">
              {drafts.map((q, i) => <QuoteCard key={q.id} q={q} idx={i} />)}
            </div>
          </QuoteTrack>

          <QuoteTrack
            num="03"
            title="Decided this month"
            count={decided.length}
            defaultOpen={false}
            storageKey="quotes:track:03"
          >
            <div class="qdone">
              {decided.map((q) => <DecidedRow key={q.id} q={q} />)}
            </div>
          </QuoteTrack>
        </div>

        <aside class="qside">
          <QSideBig open={out} />
          <QSideRate won={won} lost={lost} />
          <QSideTip text={insight?.text} />
        </aside>
      </div>
    </>
  );
}
