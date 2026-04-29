import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import { getSessionId } from "../../lib/auth.ts";
import {
  quotesClient,
  type Insight,
  type QuoteCard as BackendQuoteCard,
  type WinRate,
} from "../../clients/quotes.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import {
  DecidedRow,
  QSideBig,
  QSideRate,
  QSideTip,
  QuotesHero,
  QuotesKpis,
} from "../../components/QuotesSections.tsx";
import QuoteTrack from "../../islands/QuoteTrack.tsx";
import QuoteCard from "../../islands/QuoteCard.tsx";
import type { Quote } from "../../lib/quotes-seed.ts";

async function settle<T>(p: Promise<T>, fallback: T): Promise<T> {
  try { return await p; } catch { return fallback; }
}

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const STAGE_ORDER = { opened: 0, sent: 1, cooling: 2, stale: 3 } as const;

function initialsFromName(name: string | null | undefined): string {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Map the backend's enriched QuoteCard into the seed-shaped Quote the UI
 * components consume. `band`/`shadow` are vestigial — the rendered colour comes
 * from `moodForQuote(stage, opens)` at render time.
 */
function mapCard(c: BackendQuoteCard): Quote {
  const client = c.customerName ?? "Unknown client";
  return {
    id:           c.id,
    title:        c.summary ?? "Untitled quote",
    client,
    initials:     initialsFromName(c.customerName),
    stage:        c.stage,
    value:        c.estimatedTotal ?? 0,
    daysIn:       c.daysIn,
    opens:        c.opens,
    sentDays:     c.sentDays,
    decidedDays:  c.decidedDays ?? undefined,
    band:         ["#FFB3B3", "#FF6B6B"],
    shadow:       "rgba(255,107,107,0.35)",
  };
}

export default define.page(async function QuotesRoute(ctx) {
  const sessionId = getSessionId(ctx.req);
  const opts = { sessionId };
  const user = ctx.state.user;

  const [cards, winRateResp, insightResp] = await Promise.all([
    settle(quotesClient.list(undefined, opts),  [] as BackendQuoteCard[]),
    settle(quotesClient.winRate(90, opts),       null as WinRate | null),
    settle(quotesClient.insight(opts),           null as Insight | null),
  ]);

  const greetingName = (user?.name ?? user?.phoneNumber ?? "Diego").split(" ")[0];
  const now = new Date();
  const greetingDate = `${WEEKDAY[now.getDay()]} · ${MONTH[now.getMonth()]} ${now.getDate()}`;

  const quotes = cards.map(mapCard);

  const open = quotes.filter((q) => ["draft", "sent", "opened", "cooling", "stale"].includes(q.stage));
  const openTotal = open.reduce((s, q) => s + q.value, 0);
  const stale = quotes.filter((q) => q.stage === "stale");

  const out = quotes.filter((q) => ["sent", "opened", "cooling", "stale"].includes(q.stage));
  const outVal = out.reduce((s, q) => s + q.value, 0);
  const drafts = quotes.filter((q) => q.stage === "draft");
  const decided = quotes.filter((q) => ["won", "lost"].includes(q.stage));

  const won  = winRateResp?.won  ?? decided.filter((q) => q.stage === "won").length;
  const lost = winRateResp?.lost ?? (decided.length - (winRateResp?.won ?? decided.filter((q) => q.stage === "won").length));
  const decidedCount = winRateResp?.decided ?? decided.length;
  const winRate = winRateResp?.winRate ?? (decidedCount ? Math.round((won / decidedCount) * 100) : 0);

  const outSorted = [...out].sort((a, b) => {
    const av = STAGE_ORDER[a.stage as keyof typeof STAGE_ORDER] ?? 9;
    const bv = STAGE_ORDER[b.stage as keyof typeof STAGE_ORDER] ?? 9;
    return av - bv;
  });

  return (
    <>
      <Head>
        <title>Quotes · Paperwork Monsters</title>
        <link key="css-dashboard" rel="stylesheet" href="/dashboard.css" />
        <link key="css-quotes" rel="stylesheet" href="/quotes.css" />
      </Head>

      <div class="app">
        <DashSidebar active="quotes" />
        <main class="main">
          <DashTopbar
            greetingDate={greetingDate}
            greetingName={greetingName}
          />
          <div class="content">
            <QuotesHero
              openCount={open.length}
              openTotal={openTotal}
              staleCount={stale.length}
              clientCount={new Set(open.map((q) => q.client)).size}
            />
            <QuotesKpis
              outValue={outVal}
              outCount={out.length}
              draftCount={drafts.length}
              decidedCount={decidedCount}
              wonCount={won}
              lostCount={lost}
              winRate={winRate}
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
                <QSideTip text={insightResp?.text} />
              </aside>
            </div>
          </div>
        </main>
      </div>
    </>
  );
});
