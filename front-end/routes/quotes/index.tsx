import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
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
import { QPIPELINE } from "../../lib/quotes-seed.ts";

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const STAGE_ORDER = { opened: 0, sent: 1, cooling: 2, stale: 3 } as const;

export default define.page(function QuotesRoute(ctx) {
  const user = ctx.state.user;
  const greetingName = (user?.name ?? user?.phoneNumber ?? "Diego").split(" ")[0];
  const now = new Date();
  const greetingDate = `${WEEKDAY[now.getDay()]} · ${MONTH[now.getMonth()]} ${now.getDate()}`;

  const open = QPIPELINE.filter((q) => ["draft", "sent", "opened", "cooling", "stale"].includes(q.stage));
  const openTotal = open.reduce((s, q) => s + q.value, 0);
  const stale = QPIPELINE.filter((q) => q.stage === "stale");

  const out = QPIPELINE.filter((q) => ["sent", "opened", "cooling", "stale"].includes(q.stage));
  const outVal = out.reduce((s, q) => s + q.value, 0);
  const drafts = QPIPELINE.filter((q) => q.stage === "draft");
  const decided = QPIPELINE.filter((q) => ["won", "lost"].includes(q.stage));
  const won = decided.filter((q) => q.stage === "won");
  const winRate = decided.length ? Math.round((won.length / decided.length) * 100) : 0;

  const outSorted = [...out].sort((a, b) => {
    const av = STAGE_ORDER[a.stage as keyof typeof STAGE_ORDER] ?? 9;
    const bv = STAGE_ORDER[b.stage as keyof typeof STAGE_ORDER] ?? 9;
    return av - bv;
  });

  return (
    <>
      <Head>
        <title>Quotes · Paperwork Monsters</title>
        <link rel="stylesheet" href="/dashboard.css" />
        <link rel="stylesheet" href="/quotes.css" />
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
              decidedCount={decided.length}
              wonCount={won.length}
              lostCount={decided.length - won.length}
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
                <QSideRate won={won.length} lost={decided.length - won.length} />
                <QSideTip />
              </aside>
            </div>
          </div>
        </main>
      </div>
    </>
  );
});
