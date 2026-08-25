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
import { api } from "../lib/api.ts";
import { fmtMoney } from "../lib/format.ts";
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
import { langSignal, tFor } from "../lib/i18n.ts";
import {
  buildViewedReceipt,
  classifyReceipts,
  type CustomerReceipt,
  type TrailMessage,
  type ViewedReceipt,
} from "../../shared/quote-flow/receipts.ts";

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

function mapCard(c: BackendQuoteCard, lang: "en" | "es"): Quote {
  // UX-17: the customer-less onboarding sample explains itself instead of
  // rendering bare "—" placeholders in the avatar tile and client line.
  const sampleClient = c.isSample === true
    ? tFor(lang, "quoteCard.sampleClient")
    : null;
  const fallbackClient = sampleClient ?? clientFromSummary(c.summary);
  const client = c.customerName ?? fallbackClient;
  return {
    id: c.id,
    // Prefer the ≤3-word Job Name (roadmap p.10) so cards read the same as
    // the quote, agreement, and invoice headings; summary is the fallback.
    title: c.jobName?.trim() || c.summary ||
      tFor(lang, "quotesPage.untitledQuote"),
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
    ...(c.isSample === true ? { isSample: true } : {}),
  };
}

interface State {
  loading: boolean;
  error: string | null;
  quotes: Quote[];
  winRate: WinRate | null;
  insight: Insight | null;
}

/** Lifecycle badge on the open-quote surface (roadmap p.10): the RAW quote
 *  `status` walks draft → sent → viewed → accepted on the backend;
 *  "lost" renders as declined. */
type BadgeStatus = "draft" | "sent" | "viewed" | "accepted" | "declined";

function badgeStatusFor(q: BackendQuoteCard): BadgeStatus {
  const raw = typeof q.status === "string" ? q.status.toLowerCase() : "";
  // Never regress after signature: accepted (or a recorded acceptedAt)
  // wins over any later "viewed" bookkeeping.
  if (raw === "accepted" || q.acceptedAt) {
    return "accepted";
  }
  if (raw === "lost") return "declined";
  if (raw === "viewed") return "viewed";
  if (raw === "sent") return "sent";
  if (q.sentAt) return "sent";
  return "draft";
}

interface OpenQuoteState {
  loading: boolean;
  quote: BackendQuoteCard | null;
  /** Customer-facing deliveries only (shared classifyReceipts — P-32). */
  receipts: CustomerReceipt[];
  /** "Viewed by the client" receipt when the doc was actually opened. */
  viewed: ViewedReceipt | null;
}

/** Detail surface for /quotes?open=<id> — job name, lifecycle status badge,
 *  full-quote actions, and the "emailed to … / texted to …" receipt strip
 *  built from the per-document comms trail (roadmap p.8). */
function OpenQuotePanel(
  { lang, state }: { lang: "en" | "es"; state: OpenQuoteState },
) {
  const [copied, setCopied] = useState(false);

  if (state.loading) {
    return (
      <section class="qopen qopen--pending">
        {tFor(lang, "quotesPage.open.loading")}
      </section>
    );
  }
  const q = state.quote;
  if (!q) {
    return (
      <section class="qopen qopen--pending">
        {tFor(lang, "quotesPage.open.notFound")}
      </section>
    );
  }

  const badge = badgeStatusFor(q);
  const quoteId = q.id;
  const title = q.jobName?.trim() || q.summary ||
    tFor(lang, "quotesPage.untitledQuote");

  async function copyLink() {
    try {
      // Always the FULL public quote URL (/q/:id) — never a summary variant.
      await navigator.clipboard.writeText(
        `${globalThis.location.origin}/q/${quoteId}`,
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable — leave the label as-is */ }
  }

  return (
    <section class="qopen" data-cy="quote-open-panel">
      <div class="qopen__head">
        <div class="qopen__id">
          <div class="qopen__eyebrow">{tFor(lang, "quoteCard.valueLabel")}</div>
          <h2 class="qopen__title">{title}</h2>
        </div>
        <span
          class={`qopen__badge qopen__badge--${badge}`}
          data-cy="quote-status-badge"
        >
          {tFor(lang, `quotesPage.status.${badge}`)}
        </span>
      </div>
      {q.summary && q.jobName?.trim() && (
        <p class="qopen__summary">{q.summary}</p>
      )}
      {q.customerName && (
        <p class="qopen__client" style="font-size:13px;color:var(--fg-muted)">
          {tFor(lang, "quotesPage.open.customer", { name: q.customerName })}
        </p>
      )}
      <div class="qopen__meta">
        <div class="qopen__amount">{fmtMoney(q.estimatedTotal ?? 0)}</div>
        <div class="qopen__actions">
          <button type="button" class="qopen__btn" onClick={copyLink}>
            {copied
              ? tFor(lang, "quotesPage.open.linkCopied")
              : tFor(lang, "quotesPage.open.copyLink")}
          </button>
          <a
            class="qopen__btn"
            href={`/q/${q.id}`}
            target="_blank"
            rel="noopener"
          >
            {tFor(lang, "quotesPage.open.viewAsClient")}
          </a>
          {/* UX-02: the won quote's obvious next step — never a dead end. */}
          {badge === "accepted" && (
            <a
              class="qopen__btn qopen__btn--primary"
              href={`/invoices?new=1&quoteId=${encodeURIComponent(q.id)}`}
            >
              {q.customerName
                ? tFor(lang, "quotesPage.open.createInvoiceFor", {
                  name: q.customerName,
                })
                : tFor(lang, "quotesPage.open.createInvoice")}
            </a>
          )}
        </div>
      </div>
      {(badge === "accepted" || state.receipts.length > 0 || state.viewed) && (
        <div class="qopen__receipts">
          {badge === "accepted" && (
            <div class="qopen__receipt qopen__receipt--signed">
              {tFor(lang, "quotesPage.open.receipt.signed")}
            </div>
          )}
          {state.viewed && (
            <div class="qopen__receipt qopen__receipt--viewed">
              {tFor(lang, "quotesPage.open.receipt.viewed")}
            </div>
          )}
          {state.receipts.map((r) => (
            <div class="qopen__receipt" key={`${r.channel}:${r.to}`}>
              {tFor(
                lang,
                r.channel === "email"
                  ? "quotesPage.open.receipt.emailedTo"
                  : "quotesPage.open.receipt.textedTo",
                { to: r.to },
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const INITIAL: State = {
  loading: true,
  error: null,
  quotes: [],
  winRate: null,
  insight: null,
};

export default function QuotesPage(_props: { lang?: "en" | "es" }) {
  // Self-source the live UI language: reading langSignal.value during render
  // makes this island re-render when SettingsPage flips the language. The
  // optional `lang` prop is an ignored SSR seed.
  const lang = langSignal.value;
  const [s, setS] = useState<State>(INITIAL);

  // /quotes?open=<id> deep link — seeded from the URL; UX-08: also settable
  // from the list (tapping a decided row opens the same panel).
  const [openId, setOpenId] = useState<string | null>(() => {
    if (typeof globalThis.location === "undefined") return null;
    return new URLSearchParams(globalThis.location.search).get("open");
  });
  const [openQ, setOpenQ] = useState<OpenQuoteState>({
    loading: true,
    quote: null,
    receipts: [],
    viewed: null,
  });

  function openQuote(id: string) {
    setOpenQ({ loading: true, quote: null, receipts: [], viewed: null });
    setOpenId(id);
    try {
      const url = new URL(globalThis.location.href);
      url.searchParams.set("open", id);
      globalThis.history.replaceState(null, "", url.toString());
    } catch { /* history unavailable — the panel still opens */ }
  }

  useEffect(() => {
    if (!openId) return;
    let alive = true;
    Promise.all([
      quotesClient.get(openId).catch(() => null),
      // Comms trail: outbound sends logged per document (paperworkId).
      api.get<TrailMessage[]>("/messages").catch(() => [] as TrailMessage[]),
      // Contractor's own contact info — classifyReceipts drops anything
      // addressed to it (P-32: accepted-alert self-notifications are not
      // customer deliveries).
      api.get<{ email?: string; phoneNumber?: string }>("/me")
        .catch(() => ({} as { email?: string; phoneNumber?: string })),
      // Engagement timeline — feeds the "Viewed by the client" receipt.
      api.get<{ opens?: { at: string }[] }>(`/quotes/${openId}/opens`)
        .catch(() => ({ opens: [] as { at: string }[] })),
      // UX-08: GET /quotes/:id is the raw row (customerId only) — join the
      // customer so the panel can say WHO the deal is with.
      api.get<{ id: string; name?: string }[]>("/customers")
        .catch(() => [] as { id: string; name?: string }[]),
    ]).then(([quoteRaw, messages, me, opensRes, customersList]) => {
      if (!alive) return;
      let quote = quoteRaw as BackendQuoteCard | null;
      if (quote && !quote.customerName && quote.customerId) {
        const found = (Array.isArray(customersList) ? customersList : [])
          .find((c) => c.id === quote!.customerId);
        if (found?.name) quote = { ...quote, customerName: found.name };
      }
      const receipts = classifyReceipts(
        Array.isArray(messages) ? messages : [],
        { email: me.email ?? null, phone: me.phoneNumber ?? null },
        openId,
      );
      const opens = Array.isArray(opensRes?.opens) ? opensRes.opens : [];
      const q = quote as (BackendQuoteCard & { viewedAt?: string }) | null;
      const viewed = buildViewedReceipt({
        viewedAt: q?.viewedAt ?? null,
        lastOpenAt: opens[opens.length - 1]?.at ?? null,
        opens: opens.length,
      });
      setOpenQ({ loading: false, quote, receipts, viewed });
    });
    return () => {
      alive = false;
    };
  }, [openId]);

  // UX-08: once the opened panel has data, make sure it is actually on
  // screen — at 390px it renders below the hero + 4 stacked KPI cells and a
  // deep link used to land the user on a viewport that never showed it.
  useEffect(() => {
    if (!openId || openQ.loading || !openQ.quote) return;
    document.querySelector("[data-cy=quote-open-panel]")?.scrollIntoView({
      block: "start",
      behavior: "auto",
    });
  }, [openId, openQ.loading, openQ.quote?.id]);

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
        quotes: safeCards.map((c) => mapCard(c, lang)),
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
  }, [lang]);

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
    return (
      <div class="qpage-error">
        {tFor(lang, "quotesPage.loadError", { error: s.error })}
      </div>
    );
  }

  const { quotes, winRate, insight } = s;

  // P-15: the onboarding sample stays VISIBLE as a badged card, but it
  // contributes to NO aggregate — the hero, KPI strip, and side panels all
  // roll over real quotes only.
  const isReal = (q: Quote) => q.isSample !== true;
  const real = quotes.filter(isReal);

  // Card lists for the tracks (samples included — the card renders):
  const outCards = quotes.filter((q) =>
    ["sent", "opened", "cooling", "stale"].includes(q.stage)
  );
  const draftCards = quotes.filter((q) => q.stage === "draft");
  const decidedCards = quotes.filter((q) => ["won", "lost"].includes(q.stage));

  // Aggregates (real quotes only):
  const open = real.filter((q) =>
    ["draft", "sent", "opened", "cooling", "stale"].includes(q.stage)
  );
  const openTotal = open.reduce((acc, q) => acc + q.value, 0);
  const stale = real.filter((q) => q.stage === "stale");
  const out = outCards.filter(isReal);
  const outVal = out.reduce((acc, q) => acc + q.value, 0);
  const drafts = draftCards.filter(isReal);
  const decided = decidedCards.filter(isReal);

  // Inner sort: opened > sent > cooling > stale within "Out for response".
  const outSorted = [...outCards].sort((a, b) => {
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
        lang={lang}
        // P-37: "empty" means zero REAL quotes TOTAL (open or resolved) —
        // the giant empty-state hero never shouts above a real card.
        totalCount={real.length}
        openCount={open.length}
        openTotal={openTotal}
        staleCount={stale.length}
        // Only count quotes with a real customer link. Two unlinked quotes
        // shouldn't collapse into a single phantom "—" client (#31).
        clientCount={new Set(
          open.map((q) => q.customerId).filter((id): id is string =>
            Boolean(id)
          ),
        ).size}
      />
      <QuotesKpis
        lang={lang}
        outValue={outVal}
        outCount={out.length}
        draftCount={drafts.length}
        decidedCount={decidedCount}
        wonCount={won}
        lostCount={lost}
        winRate={winRatePct}
      />
      {openId && <OpenQuotePanel lang={lang} state={openQ} />}
      <div class="qlay">
        <div>
          <QuoteTrack
            lang={lang}
            num="01"
            title={tFor(lang, "quotesPage.track.outForResponse")}
            // UX-17: header count agrees with the KPI — real quotes only
            // (the badged sample card stays visible but counts nowhere).
            count={out.length}
            defaultOpen
            forceOpen={openId != null && outCards.some((q) => q.id === openId)}
            storageKey="quotes:track:01"
          >
            <div class="qcards">
              {outSorted.map((q, i) => (
                <QuoteCard
                  key={q.id}
                  q={q}
                  idx={i}
                  lang={lang}
                  flipOnMount={q.id === openId}
                />
              ))}
            </div>
          </QuoteTrack>

          <QuoteTrack
            lang={lang}
            num="02"
            title={tFor(lang, "quotesPage.track.drafting")}
            count={drafts.length}
            /* A draft the user is mid-writing must not hide behind a
               collapsed track (same rule as the invoice tracks, P-31). */
            defaultOpen={draftCards.length > 0}
            forceOpen={openId != null &&
              draftCards.some((q) => q.id === openId)}
            storageKey="quotes:track:02"
          >
            <div class="qcards">
              {draftCards.map((q, i) => (
                <QuoteCard
                  key={q.id}
                  q={q}
                  idx={i}
                  lang={lang}
                  flipOnMount={q.id === openId}
                />
              ))}
            </div>
          </QuoteTrack>

          <QuoteTrack
            lang={lang}
            num="03"
            title={tFor(lang, "quotesPage.track.decidedThisMonth")}
            count={decided.length}
            // Open by default when there are decided rows so the ≤3-word Job
            // Name stays visible on the list (roadmap p.8); a user's stored
            // collapse preference still wins via storageKey.
            defaultOpen={decidedCards.length > 0}
            forceOpen={openId != null &&
              decidedCards.some((q) => q.id === openId)}
            storageKey="quotes:track:03"
          >
            <div class="qdone">
              {decidedCards.map((q) => (
                <DecidedRow key={q.id} q={q} lang={lang} onOpen={openQuote} />
              ))}
            </div>
          </QuoteTrack>
        </div>

        <aside class="qside">
          <QSideBig open={out} lang={lang} />
          <QSideRate won={won} lost={lost} lang={lang} />
          <QSideTip text={insight?.text} lang={lang} />
        </aside>
      </div>
    </>
  );
}
