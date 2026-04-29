/**
 * Server-rendered sections for /quotes. Ported from the prototype's
 * QuotesHero, QuotesKpis, DecidedRow, QSideBig, QSideRate, QSideTip.
 * The interactive Track collapse + QuoteCard flip live in islands/.
 */
import { I, ICN } from "../lib/dash-icons.tsx";
import { fmtMoney } from "../lib/format.ts";
import { type Quote } from "../lib/quotes-seed.ts";
import DeleteQuoteButton from "../islands/DeleteQuoteButton.tsx";

interface HeroProps {
  openCount: number;
  openTotal: number;
  staleCount: number;
  clientCount: number;
}

export function QuotesHero({ openCount, openTotal, staleCount, clientCount }: HeroProps) {
  return (
    <div class="qph">
      <div>
        <div class="qph__eyebrow">
          <span class="qph__eyebrow-dot" />
          The pipeline this week
        </div>
        <h1 class="qph__title">
          <em>${fmtMoney(openTotal)}</em> of work sitting with clients,<br />
          {staleCount} {staleCount === 1 ? "quote" : "quotes"} that need a nudge.
        </h1>
        <p class="qph__sub">
          {openCount} open quotes across {clientCount} clients. The monsters
          flagged <strong>{staleCount}</strong> as cooling off — start there, then hit the hot ones while they're still warm.
        </p>
      </div>
      <button class="qph__cta" type="button">
        <I d={ICN.plus} size={14} sw={2.5} /> New quote
      </button>
    </div>
  );
}

interface KpisProps {
  outValue: number;
  outCount: number;
  draftCount: number;
  decidedCount: number;
  wonCount: number;
  lostCount: number;
  winRate: number;
}

export function QuotesKpis({ outValue, outCount, draftCount, decidedCount, wonCount, lostCount, winRate }: KpisProps) {
  return (
    <div class="qkpi">
      <div class="qkpi__cell qkpi__cell--accent">
        <div class="qkpi__lbl">Out for response</div>
        <div class="qkpi__val">${fmtMoney(outValue)}</div>
        <div class="qkpi__sub">{outCount} quotes waiting</div>
      </div>
      <div class="qkpi__cell">
        <div class="qkpi__lbl">Drafting</div>
        <div class="qkpi__val">{draftCount}</div>
        <div class="qkpi__sub">finish + send</div>
      </div>
      <div class="qkpi__cell">
        <div class="qkpi__lbl">Decided this month</div>
        <div class="qkpi__val">{decidedCount}</div>
        <div class="qkpi__sub">{wonCount} won · {lostCount} lost</div>
      </div>
      <div class="qkpi__cell">
        <div class="qkpi__lbl">Win rate (90d)</div>
        <div class="qkpi__val">{winRate}%</div>
        <div class="qkpi__sub">↑ 8 pts vs Q1</div>
      </div>
    </div>
  );
}

export function DecidedRow({ q }: { q: Quote }) {
  const decidedDays = q.decidedDays ?? 0;
  const when = decidedDays === 1 ? "yesterday" : `${decidedDays}d ago`;
  return (
    <div class="qdone__row">
      <div class={`qdone__badge qdone__badge--${q.stage}`}>
        <I d={q.stage === "won" ? ICN.check : ICN.x} size={16} sw={2.5} />
      </div>
      <div>
        <div class="qdone__title">{q.title}</div>
        <div class="qdone__client">{q.client} · {q.id}</div>
      </div>
      <div class={`qdone__amt ${q.stage === "lost" ? "qdone__amt--lost" : ""}`}>${fmtMoney(q.value)}</div>
      <div class="qdone__when">{when}</div>
      <DeleteQuoteButton id={q.id} variant="icon" />
    </div>
  );
}

interface QSideBigProps { open: Quote[] }

export function QSideBig({ open }: QSideBigProps) {
  const top4 = [...open].sort((a, b) => b.value - a.value).slice(0, 4);
  const max = top4[0]?.value ?? 1;
  return (
    <div class="qside__card">
      <div class="qside__head">
        <div>
          <div class="qside__title">Top of the pipeline</div>
          <div class="qside__sub">biggest open quotes</div>
        </div>
      </div>
      <div class="qbig">
        {top4.map((q, i) => (
          <div key={q.id}>
            <div class="qbig__row">
              <span class="qbig__rank">{String(i + 1).padStart(2, "0")}</span>
              <div style="min-width:0">
                <div class="qbig__name">{q.client}</div>
                <div class="qbig__sub">{q.title}</div>
              </div>
              <span class="qbig__amt">${fmtMoney(q.value)}</span>
            </div>
            <div class="qbar"><div class="qbar__fill" style={`width: ${(q.value / max) * 100}%`} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface QSideRateProps { won: number; lost: number }

export function QSideRate({ won, lost }: QSideRateProps) {
  const decided = won + lost;
  const pct = decided > 0 ? Math.round((won / decided) * 100) : 0;
  const C = Math.PI * 42;
  const dash = (pct / 100) * C;
  return (
    <div class="qside__card">
      <div class="qside__head">
        <div>
          <div class="qside__title">Win rate</div>
          <div class="qside__sub">last 90 days</div>
        </div>
      </div>
      <div class="qrate">
        <svg class="qrate__svg" viewBox="0 0 110 70">
          <path d="M 13 60 A 42 42 0 0 1 97 60" fill="none" stroke="var(--mint-200)" stroke-width="10" stroke-linecap="round" />
          <path d="M 13 60 A 42 42 0 0 1 97 60" fill="none" stroke="url(#qg)" stroke-width="10" stroke-linecap="round" stroke-dasharray={`${dash} ${C}`} />
          <defs>
            <linearGradient id="qg" x1="0" x2="1">
              <stop offset="0%" stop-color="#5FA34F" />
              <stop offset="100%" stop-color="#3F7A33" />
            </linearGradient>
          </defs>
        </svg>
        <div>
          <div class="qrate__num">{pct}<span class="qrate__num-pct">%</span></div>
          <div class="qrate__lbl">{won} won · {lost} lost<br />of {decided} decided</div>
        </div>
      </div>
    </div>
  );
}

const DEFAULT_TIP = "Quotes opened 3+ times within 24 hours close 78% of the time when followed up the same day.";

export function QSideTip({ text }: { text?: string } = {}) {
  return (
    <div class="qside__card" style="background:linear-gradient(135deg,#1A535C,#0F3A40);color:#fff;border:none">
      <div class="qside__title" style="color:#fff;margin-bottom:8px">Monster tip</div>
      <p style="font:400 13.5px/1.5 var(--font-body);color:rgba(255,255,255,0.85);margin:0;text-wrap:pretty">
        {text ?? DEFAULT_TIP}
      </p>
    </div>
  );
}
