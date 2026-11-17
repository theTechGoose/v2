/**
 * Server-rendered Dashboard sections, ported verbatim from
 * DocuMonster Dashboard.html. Only the Ticker (animated number)
 * pieces are islands — everything else is static SSR.
 */
import { I, ICN, type IconName } from "../lib/dash-icons.tsx";
import Ticker from "../islands/Ticker.tsx";
import { SkelBlock } from "./Skeletons.tsx";
import { type Lang, tFor } from "../lib/i18n.ts";
import { dashQuotesEmpty, quotesPendingSub } from "../lib/headline-counts.ts";
import {
  activeJobsCountLabel,
  formatMoneyCompact,
} from "../../shared/quote-flow/pipeline-stats.ts";

/** Plural resolver for SSR call sites (frontend `tn` is langSignal-reactive
 *  only, so it can't honor an explicit lang). */
const plural = (lang: Lang, key: string, n: number) =>
  tFor(lang, `${key}.${n === 1 ? "one" : "other"}`, { n });

/* ---------- Hero ---------- */

interface HeroProps {
  thisMonthBilled: number;
  pendingQuotes: number;
  outstandingOverdue?: number;
  lang?: Lang;
}

export function Hero(
  { thisMonthBilled, pendingQuotes, outstandingOverdue = 0, lang = "en" }:
    HeroProps,
) {
  const fresh = thisMonthBilled === 0;
  // CTA priority: overdue invoices > pending quotes > assistant fallback. The
  // hero CTA used to always be "My assistant" which duplicated the sidebar;
  // pick the most actionable next step instead.
  const cta = outstandingOverdue > 0
    ? {
      label: plural(lang, "dashHero.cta.nudgeOverdue", outstandingOverdue),
      href: "/invoices",
    }
    : pendingQuotes > 0
    ? {
      // Navigation intent only — this is an <a href>, not a bulk send. "Send
      // the N quotes" read as a one-tap blast; "Review" matches what it does.
      label: plural(lang, "dashHero.cta.reviewPending", pendingQuotes),
      href: "/quotes",
    }
    : { label: tFor(lang, "dashHero.cta.assistant"), href: "/assistant" };
  return (
    <section class="hero">
      <div class="hero__copy">
        <h1 class="hero__title">
          {fresh ? <>{tFor(lang, "dashHero.title.getQuotesOut")}</> : (
            <>
              {tFor(lang, "dashHero.title.billedLead")}{" "}
              <em>
                $<Ticker value={thisMonthBilled} />
              </em>{" "}
              {tFor(lang, "dashHero.title.billedTrail")}
              <br />
              {tFor(lang, "dashHero.title.getQuotesOut")}
            </>
          )}
        </h1>
        <p class="hero__sub">
          {pendingQuotes > 0
            ? plural(lang, "dashHero.sub.pending", pendingQuotes)
            : tFor(lang, "dashHero.sub.empty")}
        </p>
        {pendingQuotes > 0 && (
          <div class="hero__stats">
            <span class="hero__stat hero__stat--pink">
              <strong>
                {plural(lang, "dashHero.stat.quotes", pendingQuotes)}
              </strong>{" "}
              {tFor(lang, "dashHero.stat.awaiting")}
            </span>
          </div>
        )}
        <div class="hero__cta-row" style="margin-top:18px">
          <a
            class="btn btn--quote"
            href={cta.href}
            style="text-decoration:none"
          >
            <span class="btn__lightning">
              <I d={ICN.crown} size={14} />
            </span>
            {cta.label}
          </a>
          {
            /* Roadmap p.10: the assistant must stay reachable above the fold
              on phones. That entry now lives in the dominant .assistant-cta
              banner above the hero, so the old secondary ghost link here is
              redundant and was removed. */
          }
        </div>
      </div>
      <div class="hero__art">
        <span class="hero__confetti hero__confetti--1" />
        <span class="hero__confetti hero__confetti--2" />
        <span class="hero__confetti hero__confetti--3" />
        <div class="hero__art-blob" />
        <img src="/logo-monster.png" alt="" class="hero__monster" />
      </div>
    </section>
  );
}

/* ---------- KPIs ---------- */

interface KpisProps {
  activeJobs: number;
  outstanding: number;
  outstandingCount: number;
  outstandingOverdue: number;
  pendingQuotes: number;
  /** Pending-quote pipeline total in INTEGER CENTS (P-36: rendered via
   *  formatMoneyCompact — "$850", never "$0.8k"). */
  pendingTotal: number;
  /** REQ-566 (m11): drafts whose send reached nobody — "Not delivered (n)" */
  undeliveredQuotes?: number;
  avgJob: number;
  lang?: Lang;
  /** REQ-728 (cycle 5, m15): the jobs list has not landed — the Active jobs
   *  value is a placeholder, never a "0" the warm start cannot know. */
  activeJobsPending?: boolean;
}

export function Kpis(props: KpisProps) {
  const lang = props.lang ?? "en";
  // "Avg. paid job" — only counts paid invoices. UX-20: the VALUE slot holds
  // a compact value ("—" when there's no paid history yet); the explanatory
  // sentence belongs in the sub line, never wrapped inside a KPI number.
  const avgJobVal = props.avgJob > 0
    ? `$${props.avgJob.toLocaleString()}`
    : "—";
  const avgJobSub = props.avgJob > 0
    ? tFor(lang, "kpis.avgJob.trailingYear")
    : tFor(lang, "kpis.avgJob.none");
  const items: Array<
    {
      icon: IconName;
      ic_bg: string;
      ic_fg: string;
      label: string;
      val: string;
      sub: string;
      delta: { kind: "up" | "warn" | "neutral"; txt: string } | null;
      pending?: boolean;
    }
  > = [
    {
      icon: "hardhat",
      ic_bg: "var(--green-50)",
      ic_fg: "var(--green-600)",
      label: tFor(lang, "kpis.activeJobs.label"),
      val: String(props.activeJobs),
      sub: tFor(lang, "kpis.activeJobs.sub"),
      delta: null,
      pending: props.activeJobsPending === true,
    },
    {
      icon: "invoice",
      ic_bg: "var(--pink-50)",
      ic_fg: "var(--pink-700)",
      label: tFor(lang, "kpis.outstanding.label"),
      val: `$${props.outstanding.toLocaleString()}`,
      sub: plural(lang, "kpis.outstanding.invoices", props.outstandingCount),
      delta: props.outstandingOverdue > 0
        ? {
          kind: "warn",
          txt: tFor(lang, "kpis.outstanding.overdue", {
            n: props.outstandingOverdue,
          }),
        }
        : null,
    },
    {
      icon: "quote",
      ic_bg: "var(--coffee-50)",
      ic_fg: "var(--coffee-600)",
      label: tFor(lang, "kpis.quotesPending.label"),
      val: String(props.pendingQuotes),
      sub: (() => {
        const sub = quotesPendingSub({
          pendingTotalCents: props.pendingTotal,
          undeliveredCount: props.undeliveredQuotes ?? 0,
        });
        if (!sub) return "—";
        return tFor(lang, sub.key, {
          n: sub.n,
          // P-36: full sub-$1k amounts ("$850"), compacting only at ≥ $1k —
          // never the old dollars/1000 "$0.8k" artifact.
          amt: formatMoneyCompact(props.pendingTotal),
        });
      })(),
      delta: null,
    },
    {
      icon: "trend",
      ic_bg: "var(--teal-50)",
      ic_fg: "var(--teal-600)",
      label: tFor(lang, "kpis.avgJob.label"),
      val: avgJobVal,
      sub: avgJobSub,
      delta: null,
    },
  ];
  return (
    <section class="kpis">
      {items.map((k) => (
        <div class="kpi" key={k.label}>
          <div
            class="kpi__icon"
            style={`background:${k.ic_bg};color:${k.ic_fg}`}
          >
            <I d={ICN[k.icon]} size={18} />
          </div>
          <div class="kpi__label">{k.label}</div>
          {k.pending
            ? (
              <div class="kpi__val" aria-busy="true">
                <SkelBlock h={28} w="40%" />
              </div>
            )
            : <div class="kpi__val">{k.val}</div>}
          {k.delta
            ? (
              <div class={`kpi__delta kpi__delta--${k.delta.kind}`}>
                <strong>{k.delta.txt}</strong>
                <span class="kpi__delta-sub">{k.sub}</span>
              </div>
            )
            : (
              <div class="kpi__delta kpi__delta--neutral">
                <span class="kpi__delta-sub" style="margin-left:0">
                  {k.sub}
                </span>
              </div>
            )}
        </div>
      ))}
    </section>
  );
}

/* ---------- Active Jobs ---------- */

export interface JobRow {
  client: string;
  task: string;
  amount: string;
  paid: string;
  pct: number;
  /** COMPLETE due phrase, ready to render ("Vence mañana" /
   *  "Sin fecha de vencimiento") — never re-wrapped with a due verb. */
  due: string;
  icon: IconName;
  color: string;
  status: { kind: "green" | "warn" | "teal"; txt: string };
}

export function ActiveJobs(
  { jobs, total, lang = "en", pending = false }: {
    jobs: JobRow[];
    total?: number;
    lang?: Lang;
    /** REQ-728 (cycle 5, m15): the jobs list has not landed — skeleton rows,
     *  no count, never the "no jobs in flight" line. */
    pending?: boolean;
  },
) {
  // `total` is the full active-job count (matches the KPI); `jobs` is only the
  // top slice rendered below. Show the total so the header count and the
  // "Active jobs" KPI never contradict each other.
  const count = total ?? jobs.length;
  return (
    <div class="panel">
      <div class="panel__head">
        <div style="display:flex;align-items:center;gap:10px;min-width:0;overflow:hidden">
          <span
            class="hero__pill-dot"
            style="position:static;width:8px;height:8px"
          />
          <h3 class="panel__title">{tFor(lang, "kpis.activeJobs.label")}</h3>
          {!pending && (
            <span class="panel__count">
              {
                /* P-36: correct Spanish pluralization — "1 activo", never
                  "1 activos". */
              }
              {activeJobsCountLabel(count, lang)}
            </span>
          )}
        </div>
        {
          /* P-36: "Ver todo" goes to the page that actually lists the jobs
            (signed agreements), never a dead href="#". */
        }
        <a class="panel__action" href="/quotes">
          {tFor(lang, "dashPanel.seeAll")}
        </a>
      </div>
      {jobs.length === 0 && pending
        ? (
          <div aria-busy="true">
            <SkelBlock h={64} mt={18} />
            <SkelBlock h={64} mt={12} />
          </div>
        )
        : jobs.length === 0
        ? (
          <div class="panel__empty panel__empty--stack">
            <p style="font-size:13.5px;color:var(--fg-muted, #6b7560);margin:0;line-height:1.5">
              {tFor(lang, "activeJobs.empty.text")}
            </p>
            <a
              class="panel__action"
              href="/quotes"
              style="background:var(--pink-50);color:var(--pink-700);padding:6px 12px;border-radius:8px;text-decoration:none"
            >
              {tFor(lang, "activeJobs.empty.action")}
            </a>
          </div>
        )
        : (
          jobs.map((j, i) => (
            <div class="job" key={i}>
              <div class="job__icon" style={`background:${j.color}`}>
                <I d={ICN[j.icon]} size={18} />
              </div>
              <div style="min-width:0">
                <div class="job__title-row">
                  <h4 class="job__title">{j.client}</h4>
                </div>
                <div class="job__meta">
                  {
                    /* `due` arrives as ONE complete phrase (dueDateLine /
                      "Vence {date}") — wrapping it again here is what
                      produced the "Vence Sin fecha de vencimiento" run-on
                      (P-36). */
                  }
                  {j.task} <span class="job__meta-dot" /> {j.due}
                </div>
                <div class="job__progress">
                  <div
                    class="job__progress-bar"
                    style={`width:${j.pct}%;background:${j.color}`}
                  />
                </div>
              </div>
              <div>
                <div class="job__amount">{j.amount}</div>
                <div class="job__amount-sub">{j.paid}</div>
              </div>
            </div>
          ))
        )}
    </div>
  );
}

/* ---------- Quotes Awaiting ---------- */

export interface QuoteRow {
  client: string;
  desc: string;
  amt: string;
  sent: string;
  hot?: boolean;
  cold?: boolean;
}

export function QuotesAwaiting(
  {
    quotes,
    lang = "en",
    hasDecidedHistory = false,
    draftCount = 0,
    readyCount,
    undeliveredCount = 0,
    pending = false,
  }: {
    quotes: QuoteRow[];
    lang?: Lang;
    /** REQ-566 (m11): of the drafts, those whose send reached nobody. */
    undeliveredCount?: number;
    /** REQ-566 (m11): the list has not landed yet (warm start) — say no
     *  "none sent" over a tile that already counts one. */
    pending?: boolean;
    /** REQ-404 (m13): real unsent drafts — the count above stays sent-only
     *  (REQ-320), but the empty line names the drafts ready to send. */
    draftCount?: number;
    /** REQ-698 (m14): of the drafts, those whose wizard finished. */
    readyCount?: number;
    /** UX-02: quotes WERE sent and got answered — the empty state must not
     *  claim "no quotes were ever sent" over a user's first accepted win. */
    hasDecidedHistory?: boolean;
  },
) {
  const total = quotes.reduce(
    (s, q) => s + Number(q.amt.replace(/[^0-9.]/g, "")),
    0,
  );
  const empty = quotes.length === 0;
  return (
    <div class="panel">
      <div class="panel__head">
        <h3 class="panel__title">{tFor(lang, "quotesAwaiting.title")}</h3>
        {!empty && (
          <span
            class="panel__count"
            style="background:var(--coffee-50);color:var(--coffee-600)"
          >
            {tFor(lang, "quotesAwaiting.count", {
              n: quotes.length,
              total: total.toLocaleString(),
            })}
          </span>
        )}
        <a class="panel__action" href="/quotes" style="margin-left:auto">
          {tFor(lang, "dashPanel.seeAll")}
        </a>
      </div>
      {empty && pending && <div class="panel__empty" aria-busy="true" />}
      {empty && !pending && (
        <div class="panel__empty">
          {(() => {
            const e = dashQuotesEmpty({
              draftCount,
              readyCount,
              hasDecidedHistory,
              undeliveredCount,
            });
            return tFor(lang, e.key, { n: e.n });
          })()}
        </div>
      )}
      {quotes.map((q, i) => (
        <div class="quote-item" key={i}>
          <div class="quote-item__row">
            <span class="quote-item__client">{q.client}</span>
            <span class="quote-item__amt">{q.amt}</span>
          </div>
          <div
            class="quote-item__sub"
            style="display:flex;align-items:center;gap:8px"
          >
            <span>{q.desc}</span>
            <span class="job__meta-dot" />
            <span
              style={`color:${
                q.hot
                  ? "var(--brand-green)"
                  : q.cold
                  ? "var(--pink-700)"
                  : "var(--fg-muted)"
              };font-weight:${q.hot || q.cold ? 700 : 500}`}
            >
              {q.sent} {q.hot ? "🔥" : ""}{" "}
              {q.cold ? tFor(lang, "quotesAwaiting.cold") : ""}
            </span>
          </div>
          <div class="quote-item__cta">
            <button type="button" class="qbtn qbtn--nudge">
              <I d={ICN.send} size={11} />{" "}
              {tFor(lang, "quotesAwaiting.nudgeByText")}
            </button>
            <button type="button" class="qbtn qbtn--view">
              <I d={ICN.eye} size={11} />{" "}
              {tFor(lang, "quotesAwaiting.viewQuote")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------- Activity ---------- */

export interface ActivityEntry {
  icon: IconName;
  bg: string;
  fg: string;
  html: string;
  time: string;
  /** UX-20: where tapping the event goes (e.g. /quotes?open=<id>). */
  href?: string;
  /** REQ-031 (NW-26): the event's body — e.g. the question a customer asked
   *  — rendered in full under the title, never dropped. */
  body?: string;
}

export function Activity(
  { items, lang = "en", pending = false }: {
    items: ActivityEntry[];
    lang?: Lang;
    /** REQ-757: the notifications feed has not loaded yet — skeleton, not "Nothing yet" */
    pending?: boolean;
  },
) {
  const empty = items.length === 0;
  const busy = empty && pending;
  return (
    <div class="panel" id="activity">
      <div class="panel__head">
        <h3 class="panel__title">{tFor(lang, "activity.title")}</h3>
        <span style="font-size:11px;color:var(--fg-muted);margin-left:4px">
          {busy
            ? null
            : empty
            ? tFor(lang, "activity.emptySub")
            : tFor(lang, "activity.busySub")}
        </span>
        {
          /* No /activity page exists yet — don't advertise a dead control
            (a "Full log" link here 404'd in prod). Re-add when the full
            activity-log page ships. */
        }
      </div>
      {busy && (
        <div aria-busy="true">
          <SkelBlock h={44} mt={14} />
          <SkelBlock h={44} mt={10} />
        </div>
      )}
      {items.map((a, i) => {
        const body = (
          <>
            <div
              class="activity-item__icon"
              style={`background:${a.bg};color:${a.fg}`}
            >
              <I d={ICN[a.icon]} size={14} />
            </div>
            <div class="activity-item__text">
              <span
                // Trusted server-derived activity markup (no user input).
                // deno-lint-ignore react-no-danger
                dangerouslySetInnerHTML={{ __html: a.html }}
              />
              {a.body
                ? (
                  <div class="activity-item__body" data-cy="notif-body">
                    {a.body}
                  </div>
                )
                : null}
              <div class="activity-item__time">{a.time}</div>
            </div>
          </>
        );
        // UX-20: an event with a destination is a link, not an inert row.
        return a.href
          ? (
            <a
              class="activity-item activity-item--link"
              href={a.href}
              key={i}
            >
              {body}
            </a>
          )
          : (
            <div class="activity-item" key={i}>
              {body}
            </div>
          );
      })}
    </div>
  );
}
