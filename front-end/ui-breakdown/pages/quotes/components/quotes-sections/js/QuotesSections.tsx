/**
 * Server-rendered sections for /quotes. Ported from the prototype's
 * QuotesHero, QuotesKpis, DecidedRow, QSideBig, QSideRate, QSideTip.
 * The interactive Track collapse + QuoteCard flip live in islands/.
 */
import { I, ICN } from "../lib/dash-icons.tsx";
import { fmtMoney } from "../lib/format.ts";
import { type Lang, tFor } from "../lib/i18n.ts";
import { type Quote } from "../lib/quotes-seed.ts";
import DeleteQuoteButton from "../islands/DeleteQuoteButton.tsx";

/** Explicit-language plural picker for SSR components (mirrors tn() but
 *  honors the resolved `lang` prop instead of the reactive langSignal). */
function tnFor(lang: Lang, key: string, n: number, vars?: Record<string, string | number>): string {
  return tFor(lang, `${key}.${n === 1 ? "one" : "other"}`, { n, ...vars });
}

interface HeroProps {
  openCount: number;
  openTotal: number;
  staleCount: number;
  clientCount: number;
  lang?: Lang;
}

export function QuotesHero(
  { openCount, openTotal, staleCount, clientCount, lang = "en" }: HeroProps,
) {
  const empty = openCount === 0;
  const allWarm = !empty && staleCount === 0;
  const openQuotes = tnFor(lang, "quotesHero.openQuotes", openCount);
  const clients = tnFor(lang, "quotesHero.clients", clientCount);
  return (
    <div class="qph">
      <div>
        <div class="qph__eyebrow">
          <span class="qph__eyebrow-dot" />
          {tFor(lang, "quotesHero.eyebrow")}
        </div>
        {empty
          ? (
            <>
              <h1 class="qph__title">
                <em>{tFor(lang, "quotesHero.emptyTitleLine1")}</em>
                <br />
                {tFor(lang, "quotesHero.emptyTitleLine2")}
              </h1>
              <p class="qph__sub">
                {tFor(lang, "quotesHero.emptySub")}
              </p>
            </>
          )
          : allWarm
          ? (
            <>
              <h1 class="qph__title">
                <em>{fmtMoney(openTotal)}</em>{" "}
                {tFor(lang, "quotesHero.warmTitle")}
              </h1>
              <p class="qph__sub">
                {tFor(lang, "quotesHero.warmSub", { openQuotes, clients })}
              </p>
            </>
          )
          : (
            <>
              <h1 class="qph__title">
                <em>{fmtMoney(openTotal)}</em>{" "}
                {tFor(lang, "quotesHero.staleTitle", {
                  quotes: tnFor(lang, "quotesHero.staleQuotes", staleCount),
                  verb: tFor(
                    lang,
                    staleCount === 1
                      ? "quotesHero.needsSingular"
                      : "quotesHero.needsPlural",
                  ),
                })}
              </h1>
              <p class="qph__sub">
                {tFor(lang, "quotesHero.staleSubPre", { openQuotes, clients })}
                {" "}
                <strong>{staleCount}</strong>{" "}
                {tFor(lang, "quotesHero.staleSubPost")}
              </p>
            </>
          )}
      </div>
      <button class="qph__cta" type="button">
        <I d={ICN.plus} size={14} sw={2.5} /> {tFor(lang, "quotesHero.cta")}
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
  lang?: Lang;
}

/** Below this threshold the win-rate percentage is mathematically true but
 *  operationally meaningless (one accept becomes "100%"). Show only the
 *  breakdown until enough quotes have decided. */
const WIN_RATE_MIN_N = 5;

export function QuotesKpis(
  {
    outValue,
    outCount,
    draftCount,
    decidedCount,
    wonCount,
    lostCount,
    winRate,
    lang = "en",
  }: KpisProps,
) {
  const winRateConfident = decidedCount >= WIN_RATE_MIN_N;
  return (
    <div class="qkpi">
      <div class="qkpi__cell qkpi__cell--accent">
        <div class="qkpi__lbl">{tFor(lang, "quotesKpi.outLbl")}</div>
        <div class="qkpi__val">{fmtMoney(outValue)}</div>
        <div class="qkpi__sub">
          {tnFor(lang, "quotesKpi.outWaiting", outCount)}
        </div>
      </div>
      <div class="qkpi__cell">
        <div class="qkpi__lbl">{tFor(lang, "quotesKpi.draftingLbl")}</div>
        <div class="qkpi__val">{draftCount}</div>
        <div class="qkpi__sub">{tFor(lang, "quotesKpi.draftingSub")}</div>
      </div>
      <div class="qkpi__cell">
        <div class="qkpi__lbl">{tFor(lang, "quotesKpi.decidedLbl")}</div>
        <div class="qkpi__val">{decidedCount}</div>
        <div class="qkpi__sub">
          {tFor(lang, "quotesKpi.wonLost", { won: wonCount, lost: lostCount })}
        </div>
      </div>
      <div class="qkpi__cell">
        <div class="qkpi__lbl">{tFor(lang, "quotesKpi.winRateLbl")}</div>
        <div class="qkpi__val">
          {winRateConfident
            ? tFor(lang, "quotesKpi.winRateValue", { pct: winRate })
            : "—"}
        </div>
        <div class="qkpi__sub">
          {decidedCount === 0
            ? tFor(lang, "quotesKpi.notEnough")
            : winRateConfident
            ? tFor(lang, "quotesKpi.decidedN", { n: decidedCount })
            : tFor(lang, "quotesKpi.needMore", {
              won: wonCount,
              lost: lostCount,
              n: WIN_RATE_MIN_N - decidedCount,
            })}
        </div>
      </div>
    </div>
  );
}

export function DecidedRow({ q, lang = "en" }: { q: Quote; lang?: Lang }) {
  const decidedDays = q.decidedDays ?? 0;
  const when = decidedDays === 1
    ? tFor(lang, "quotesDecided.yesterday")
    : tFor(lang, "quotesDecided.daysAgo", { n: decidedDays });
  return (
    <div class="qdone__row">
      <div class={`qdone__badge qdone__badge--${q.stage}`}>
        <I d={q.stage === "won" ? ICN.check : ICN.x} size={16} sw={2.5} />
      </div>
      <div>
        <div class="qdone__title">{q.title}</div>
        <div class="qdone__client">{q.client}</div>
      </div>
      <div class={`qdone__amt ${q.stage === "lost" ? "qdone__amt--lost" : ""}`}>
        {fmtMoney(q.value)}
      </div>
      <div class="qdone__when">{when}</div>
      <DeleteQuoteButton id={q.id} variant="icon" />
    </div>
  );
}

interface QSideBigProps {
  open: Quote[];
  lang?: Lang;
}

export function QSideBig({ open, lang = "en" }: QSideBigProps) {
  const top4 = [...open].sort((a, b) => b.value - a.value).slice(0, 4);
  const max = top4[0]?.value ?? 1;
  return (
    <div class="qside__card">
      <div class="qside__head">
        <div>
          <div class="qside__title">{tFor(lang, "quotesSide.topTitle")}</div>
          <div class="qside__sub">{tFor(lang, "quotesSide.topSub")}</div>
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
              <span class="qbig__amt">{fmtMoney(q.value)}</span>
            </div>
            <div class="qbar">
              <div
                class="qbar__fill"
                style={`width: ${(q.value / max) * 100}%`}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface QSideRateProps {
  won: number;
  lost: number;
  lang?: Lang;
}

export function QSideRate({ won, lost, lang = "en" }: QSideRateProps) {
  const decided = won + lost;
  const confident = decided >= WIN_RATE_MIN_N;
  const pct = decided > 0 ? Math.round((won / decided) * 100) : 0;
  const C = Math.PI * 42;
  const dash = confident ? (pct / 100) * C : 0;
  return (
    <div class="qside__card">
      <div class="qside__head">
        <div>
          <div class="qside__title">{tFor(lang, "quotesSide.rateTitle")}</div>
          <div class="qside__sub">{tFor(lang, "quotesSide.rateSub")}</div>
        </div>
      </div>
      <div class="qrate">
        <svg class="qrate__svg" viewBox="0 0 110 70">
          <path
            d="M 13 60 A 42 42 0 0 1 97 60"
            fill="none"
            stroke="var(--mint-200)"
            stroke-width="10"
            stroke-linecap="round"
          />
          {confident && (
            <path
              d="M 13 60 A 42 42 0 0 1 97 60"
              fill="none"
              stroke="url(#qg)"
              stroke-width="10"
              stroke-linecap="round"
              stroke-dasharray={`${dash} ${C}`}
            />
          )}
          <defs>
            <linearGradient id="qg" x1="0" x2="1">
              <stop offset="0%" stop-color="#5FA34F" />
              <stop offset="100%" stop-color="#3F7A33" />
            </linearGradient>
          </defs>
        </svg>
        <div>
          {confident
            ? (
              <>
                <div class="qrate__num">
                  {pct}
                  <span class="qrate__num-pct">%</span>
                </div>
                <div class="qrate__lbl">
                  {tFor(lang, "quotesRate.wonLost", { won, lost })}
                  <br />
                  {tFor(lang, "quotesRate.ofDecided", { decided })}
                </div>
              </>
            )
            : (
              <>
                <div
                  class="qrate__num"
                  style="font-size:32px;color:var(--fg-muted)"
                >
                  —
                </div>
                <div class="qrate__lbl">
                  {decided === 0
                    ? <>{tFor(lang, "quotesRate.noneDecided")}</>
                    : (
                      <>
                        {tFor(lang, "quotesRate.wonLost", { won, lost })}
                        <br />
                        {tFor(lang, "quotesRate.needMore", {
                          n: WIN_RATE_MIN_N - decided,
                        })}
                      </>
                    )}
                </div>
              </>
            )}
        </div>
      </div>
    </div>
  );
}

export function QSideTip(
  { text, lang = "en" }: { text?: string; lang?: Lang } = {},
) {
  return (
    <div
      class="qside__card"
      style="background:linear-gradient(135deg,#1A535C,#0F3A40);color:#fff;border:none"
    >
      <div class="qside__title" style="color:#fff;margin-bottom:8px">
        {tFor(lang, "quotesTip.title")}
      </div>
      <p style="font:400 13.5px/1.5 var(--font-body);color:rgba(255,255,255,0.85);margin:0;text-wrap:pretty">
        {text ?? tFor(lang, "quotesTip.default")}
      </p>
    </div>
  );
}
