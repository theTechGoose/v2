/**
 * Server-rendered sections for /quotes. Ported from the prototype's
 * QuotesHero, QuotesKpis, DecidedRow, QSideBig, QSideRate, QSideTip.
 * The interactive Track collapse + QuoteCard flip live in islands/.
 */
import { I, ICN } from "../lib/dash-icons.tsx";
import { fmtMoney } from "../lib/format.ts";
import { type Lang, tFor } from "../lib/i18n.ts";
import { type Quote } from "../lib/quotes-seed.ts";
import {
  QUOTE_LIMIT_UPGRADE_HREF,
  quoteLimitMessage,
} from "../lib/quote-limit.ts";
import DeleteQuoteButton from "../islands/DeleteQuoteButton.tsx";
import {
  heroCoWaiting,
  quotesHeroMode,
  quotesSideTopEmpty,
} from "../lib/headline-counts.ts";

/** Explicit-language plural picker for SSR components (mirrors tn() but
 *  honors the resolved `lang` prop instead of the reactive langSignal). */
function tnFor(
  lang: Lang,
  key: string,
  n: number,
  vars?: Record<string, string | number>,
): string {
  return tFor(lang, `${key}.${n === 1 ? "one" : "other"}`, { n, ...vars });
}

/** REQ-350: "1 ganada · 0 perdidas" — each count agrees with its noun. */
function wonLostLine(lang: Lang, won: number, lost: number): string {
  return `${tnFor(lang, "quotesKpi.won", won)} · ${
    tnFor(lang, "quotesKpi.lost", lost)
  }`;
}

interface HeroProps {
  /** REQ-404 (m13): quotes that actually went OUT (OUT_STAGES) — never
   *  drafts; openTotal is their value, clientCount their clients. */
  openCount: number;
  openTotal: number;
  /** REQ-404: unsent real drafts, reported apart from the money with
   *  clients ("$X drafting"); with nothing out they ARE the headline. */
  draftCount?: number;
  draftTotal?: number;
  staleCount: number;
  clientCount: number;
  /** REAL quotes total (open + resolved). The empty-state hero renders only
   *  when the user has zero quotes, period — never above a resolved card
   *  (P-37). Defaults to openCount for legacy call sites. */
  totalCount?: number;
  /** REQ-481 (m10): signed + lost quotes — with any, drafts never read
   *  "Nothing sent yet". */
  decidedCount?: number;
  /** REQ-481 (m10): the part of draftCount whose send reached nobody. */
  undeliveredCount?: number;
  /** REQ-481: the value of those undelivered quotes (part of draftTotal). */
  undeliveredTotal?: number;
  /** REQ-760 (cycle 5v2, m14): of the drafts, those the server marks ready
   *  to send (terms wizard done). Absent: every draft counts as ready. */
  readyCount?: number;
  /** REQ-481 (m10): change orders waiting on the customer. */
  pendingChangeOrders?: ReadonlyArray<{ number: string; client: string }>;
  /** REQ-778 (cycle dv1, d8): the month's quotes are used up (Monster Free:
   *  five) — the hero says so and where to upgrade. Absent: under the cap. */
  quoteLimit?: { limit: number } | null;
  lang?: Lang;
}

export function QuotesHero(
  {
    openCount,
    openTotal,
    draftCount = 0,
    draftTotal = 0,
    staleCount,
    clientCount,
    totalCount,
    decidedCount = 0,
    undeliveredCount = 0,
    undeliveredTotal = 0,
    readyCount,
    pendingChangeOrders = [],
    quoteLimit,
    lang = "en",
  }: HeroProps,
) {
  // P-37: the giant empty-state hero used to shout over an APROBADA card
  // because it only counted OPEN quotes. REQ-404 (m13): nothing sent, but
  // drafts are ready — say exactly that, never "$X of work sitting with
  // clients" over unsent drafts. REQ-481 (m10): only with no signed/lost
  // history — otherwise it is the settled headline plus the drafting note.
  const mode = quotesHeroMode({
    total: totalCount ?? openCount,
    out: openCount,
    stale: staleCount,
    drafts: draftCount,
    decided: decidedCount,
  });
  const empty = mode === "empty";
  const draftsOnly = mode === "draftsOnly";
  const settled = mode === "settled";
  const allWarm = mode === "warm";
  const openQuotes = tnFor(lang, "quotesHero.openQuotes", openCount);
  const clients = tnFor(lang, "quotesHero.clients", clientCount);
  // REQ-481 (m10): a send that reached nobody is "Not delivered", not a draft.
  const readyDrafts = Math.max(0, draftCount - undeliveredCount);
  const onlyUndelivered = undeliveredCount > 0 && readyDrafts === 0;
  // REQ-760 (cycle 5v2, m14): "ready to send" only for drafts whose thread
  // finished its terms (the verifier's Q-002 was only drafted); the rest are
  // "in progress".
  const readyToSend = Math.min(readyCount ?? readyDrafts, readyDrafts);
  // REQ-404: drafts beside an out pipeline get their own line.
  const draftingNote = readyDrafts > 0
    ? (
      <p class="qph__sub" data-cy="quotes-hero-drafting">
        {tFor(lang, "quotesHero.draftingNote", {
          amount: fmtMoney(Math.max(0, draftTotal - undeliveredTotal)),
          drafts: tnFor(lang, "quotesHero.drafts", readyDrafts),
        })}
      </p>
    )
    : null;
  const undeliveredNote = undeliveredCount > 0
    ? (
      <p class="qph__sub" data-cy="quotes-hero-undelivered">
        {tnFor(lang, "quotesHero.undeliveredNote", undeliveredCount)}
      </p>
    )
    : null;
  // REQ-481 (m10): a change order waiting on the customer is named.
  const coWaiting = heroCoWaiting(pendingChangeOrders);
  const coLine = coWaiting
    ? (
      <p class="qph__sub" data-cy="quotes-hero-co-waiting">
        <strong>{tFor(lang, coWaiting.key, coWaiting.vars)}</strong>
      </p>
    )
    : null;
  // REQ-778 (cycle dv1, d8): "The free plan limit is five quotes." At the
  // cap, /quotes says it before New quote is tapped (the API refuses the
  // sixth either way, REQ-766).
  const limitNote = quoteLimit
    ? (
      <p class="qph__sub qph__limit" data-cy="quote-limit-note" role="status">
        <strong>{quoteLimitMessage(lang, quoteLimit.limit)}</strong>{" "}
        <a href={QUOTE_LIMIT_UPGRADE_HREF} data-cy="quote-limit-upgrade">
          {tFor(lang, "quoteLimit.upgrade")}
        </a>
      </p>
    )
    : null;
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
          : draftsOnly && onlyUndelivered
          ? (
            <>
              <h1 class="qph__title" data-cy="quotes-hero-undelivered">
                <em>
                  {tnFor(lang, "quotesHero.undeliveredTitle", undeliveredCount)}
                </em>
              </h1>
              <p class="qph__sub">
                {tFor(lang, "quotesHero.undeliveredSub")}
              </p>
            </>
          )
          : draftsOnly
          ? (
            <>
              <h1 class="qph__title" data-cy="quotes-hero-drafts-only">
                <em>
                  {readyToSend > 0
                    ? tnFor(lang, "quotesHero.draftsOnlyTitle", readyToSend)
                    : tnFor(
                      lang,
                      "quotesHero.draftsInProgressTitle",
                      readyDrafts,
                    )}
                </em>
              </h1>
              <p class="qph__sub">
                {tFor(lang, "quotesHero.draftsOnlySub", {
                  amount: fmtMoney(Math.max(0, draftTotal - undeliveredTotal)),
                })}
              </p>
              {undeliveredNote}
            </>
          )
          : settled
          ? (
            <>
              {coWaiting
                ? (
                  <h1 class="qph__title" data-cy="quotes-hero-co-waiting">
                    <em>{tFor(lang, coWaiting.key, coWaiting.vars)}</em>
                  </h1>
                )
                : (
                  <h1 class="qph__title">
                    <em>{tFor(lang, "quotesHero.settledTitle")}</em>
                  </h1>
                )}
              <p class="qph__sub">
                {tFor(lang, "quotesHero.settledSub")}
              </p>
              {draftingNote}
              {undeliveredNote}
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
              {draftingNote}
              {undeliveredNote}
              {coLine}
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
              {draftingNote}
              {undeliveredNote}
              {coLine}
            </>
          )}
        {limitNote}
      </div>
      {
        /* REQ-307 (demo M11): a real link — this is a plain SSR component, so
          the CTA must work without hydration. /assistant is the assistant's
          new-conversation route, i.e. the quote composer. */
      }
      <a class="qph__cta" data-cy="quote-new" href="/assistant">
        <I d={ICN.plus} size={14} sw={2.5} /> {tFor(lang, "quotesHero.cta")}
      </a>
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
          {wonLostLine(lang, wonCount, lostCount)}
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
            : `${wonLostLine(lang, wonCount, lostCount)} · ${
              tnFor(
                lang,
                "quotesKpi.needMore",
                WIN_RATE_MIN_N - decidedCount,
              )
            }`}
        </div>
      </div>
    </div>
  );
}

export function DecidedRow(
  { q, lang = "en", onOpen }: {
    q: Quote;
    lang?: Lang;
    /** UX-08: tapping the row opens the quote's detail panel. */
    onOpen?: (id: string) => void;
  },
) {
  const decidedDays = q.decidedDays ?? 0;
  // REQ-499 (demo p6): a quote decided today reads "today", never "0d ago".
  const when = decidedDays < 1
    ? tFor(lang, "quotesDecided.today")
    : decidedDays === 1
    ? tFor(lang, "quotesDecided.yesterday")
    : tFor(lang, "quotesDecided.daysAgo", { n: decidedDays });
  return (
    <div
      class="qdone__row"
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      style={onOpen ? "cursor:pointer" : undefined}
      onClick={onOpen
        ? (e) => {
          // The delete icon keeps its own action — a tap there never opens.
          if ((e.target as HTMLElement).closest("button")) return;
          onOpen(q.id);
        }
        : undefined}
    >
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
      {/* REQ-485 (m22): a signed quote is the agreement — no Delete. */}
      {q.stage !== "won" && <DeleteQuoteButton id={q.id} variant="icon" />}
    </div>
  );
}

interface QSideBigProps {
  open: Quote[];
  /** REQ-740: real unsent drafts — the empty line points at them. */
  draftCount?: number;
  lang?: Lang;
}

export function QSideBig(
  { open, draftCount = 0, lang = "en" }: QSideBigProps,
) {
  const empty = quotesSideTopEmpty(draftCount);
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
        {
          /* UX-20: an empty pipeline explains itself instead of rendering a
            bare shell under the header. */
        }
        {top4.length === 0 && (
          <div
            class="qbig__empty"
            style="font-size:13px;color:var(--fg-muted);line-height:1.5;padding:6px 0"
          >
            {tFor(lang, empty.key, { n: empty.n })}
          </div>
        )}
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
                  {wonLostLine(lang, won, lost)}
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
                        {wonLostLine(lang, won, lost)}
                        <br />
                        {tnFor(
                          lang,
                          "quotesRate.needMore",
                          WIN_RATE_MIN_N - decided,
                        )}
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
