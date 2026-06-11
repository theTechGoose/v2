/**
 * Server-rendered Dashboard sections, ported verbatim from
 * Paperwork Monster Dashboard.html. Only the Ticker (animated number)
 * pieces are islands — everything else is static SSR.
 */
import { I, ICN, type IconName } from "../lib/dash-icons.tsx";
import Ticker from "../islands/Ticker.tsx";
import { type Lang, tFor } from "../lib/i18n.ts";

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
              {tFor(lang, "dashHero.title.billedTrail")}<br />
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
              on phones (the sidebar is an off-canvas drawer there), so when
              the primary CTA is something else, keep a secondary entry. */
          }
          {cta.href !== "/assistant" && (
            <a
              class="btn btn--ghost"
              href="/assistant"
              style="text-decoration:none"
            >
              <I d={ICN.crown} size={14} />
              {tFor(lang, "dashHero.cta.assistant")}
            </a>
          )}
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
  pendingTotal: number;
  avgJob: number;
  lang?: Lang;
}

export function Kpis(props: KpisProps) {
  const lang = props.lang ?? "en";
  // "Avg. paid job" — only counts paid invoices. Reads as "—" with an
  // honest sub when there's no paid history yet (was "$0 / last 30 days",
  // which looked broken).
  const avgJobVal = props.avgJob > 0
    ? `$${props.avgJob.toLocaleString()}`
    : tFor(lang, "kpis.avgJob.none");
  const avgJobSub = props.avgJob > 0 ? tFor(lang, "kpis.avgJob.trailingYear") : "";
  const items: Array<
    {
      icon: IconName;
      ic_bg: string;
      ic_fg: string;
      label: string;
      val: string;
      sub: string;
      delta: { kind: "up" | "warn" | "neutral"; txt: string } | null;
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
      sub: props.pendingTotal > 0
        ? tFor(lang, "kpis.quotesPending.inFlight", {
          amt: (props.pendingTotal / 1000).toFixed(1),
        })
        : "—",
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
          <div class="kpi__val">{k.val}</div>
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
  due: string;
  icon: IconName;
  color: string;
  status: { kind: "green" | "warn" | "teal"; txt: string };
}

export function ActiveJobs(
  { jobs, total, lang = "en" }: {
    jobs: JobRow[];
    total?: number;
    lang?: Lang;
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
          <span class="panel__count">
            {tFor(lang, "activeJobs.count", { n: count })}
          </span>
        </div>
        <a class="panel__action" href="#">{tFor(lang, "dashPanel.seeAll")}</a>
      </div>
      {jobs.length === 0
        ? (
          <div style="padding:18px 4px;display:flex;flex-direction:column;gap:10px;align-items:flex-start">
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
                  {j.task} <span class="job__meta-dot" />{" "}
                  {tFor(lang, "activeJobs.due", { due: j.due })}
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
  { quotes, lang = "en" }: { quotes: QuoteRow[]; lang?: Lang },
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
      {empty && (
        <div style="font-size:13px;color:var(--fg-muted);padding:8px 0 14px">
          {tFor(lang, "quotesAwaiting.empty")}
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
              <I d={ICN.send} size={11} /> {tFor(lang, "quotesAwaiting.nudgeByText")}
            </button>
            <button type="button" class="qbtn qbtn--view">
              <I d={ICN.eye} size={11} /> {tFor(lang, "quotesAwaiting.viewQuote")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------- Outstanding ---------- */

export interface OutstandingRow {
  client: string;
  meta: string;
  metaColor: string;
  metaWeight: number;
  amount: string;
}

export function Outstanding(
  { owed, current, mid, overdue, items, lang = "en" }: {
    owed: number;
    current: number;
    mid: number;
    overdue: number;
    items: OutstandingRow[];
    lang?: Lang;
  },
) {
  const realTotal = current + mid + overdue;
  const allZero = realTotal === 0 && owed === 0;
  const total = realTotal || 1;
  return (
    <div class="money">
      <div class="money__head">
        <div>
          <div class="money__label">{tFor(lang, "outstanding.label")}</div>
          <div class="money__amt">
            $<Ticker value={owed} />
          </div>
        </div>
        {!allZero && (
          <button
            type="button"
            class="qbtn qbtn--nudge"
            style="padding:8px 14px;font-size:12px"
          >
            <I d={ICN.send} size={12} /> {tFor(lang, "outstanding.nudgeAll")}
          </button>
        )}
      </div>
      {allZero
        ? (
          <div style="font-size:13px;color:var(--fg-muted);padding:6px 0 14px">
            {items.length === 0
              ? tFor(lang, "outstanding.empty.noInvoices")
              : tFor(lang, "outstanding.empty.allPaid")}
          </div>
        )
        : (
          <>
            <div class="money__bar">
              <div
                class="money__bar-seg"
                style={`width:${
                  (current / total) * 100
                }%;background:var(--brand-green)`}
              />
              <div
                class="money__bar-seg"
                style={`width:${
                  (mid / total) * 100
                }%;background:var(--coffee-400)`}
              />
              <div
                class="money__bar-seg"
                style={`width:${
                  (overdue / total) * 100
                }%;background:var(--brand-pink)`}
              />
            </div>
            <div class="money__legend">
              <div class="money__legend-item">
                <span
                  class="money__legend-dot"
                  style="background:var(--brand-green)"
                />{" "}
                {tFor(lang, "outstanding.legend.current", {
                  amt: current.toLocaleString(),
                })}
              </div>
              <div class="money__legend-item">
                <span
                  class="money__legend-dot"
                  style="background:var(--coffee-400)"
                />{" "}
                {tFor(lang, "outstanding.legend.mid", {
                  amt: mid.toLocaleString(),
                })}
              </div>
              <div class="money__legend-item">
                <span
                  class="money__legend-dot"
                  style="background:var(--brand-pink)"
                />{" "}
                {tFor(lang, "outstanding.legend.overdue", {
                  amt: overdue.toLocaleString(),
                })}
              </div>
            </div>
          </>
        )}

      {items.length > 0 && (
        <div style="border-top:1px dashed rgba(100,69,54,0.15);padding-top:14px;display:flex;flex-direction:column;gap:10px">
          {items.map((item, i) => (
            <div
              key={i}
              style="display:flex;justify-content:space-between;align-items:center"
            >
              <div>
                <div style="font-family:var(--font-heading);font-weight:800;font-size:13px;color:var(--brand-teal)">
                  {item.client}
                </div>
                <div
                  style={`font-size:11px;color:${item.metaColor};font-weight:${item.metaWeight};margin-top:1px`}
                >
                  {item.meta}
                </div>
              </div>
              <div style="font-family:var(--font-heading);font-weight:800;font-size:14px;color:var(--brand-teal)">
                {item.amount}
              </div>
            </div>
          ))}
        </div>
      )}
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
}

export function Activity(
  { items, lang = "en" }: { items: ActivityEntry[]; lang?: Lang },
) {
  const empty = items.length === 0;
  return (
    <div class="panel" id="activity">
      <div class="panel__head">
        <h3 class="panel__title">{tFor(lang, "activity.title")}</h3>
        <span style="font-size:11px;color:var(--fg-muted);margin-left:4px">
          {empty
            ? tFor(lang, "activity.emptySub")
            : tFor(lang, "activity.busySub")}
        </span>
        <a class="panel__action" href="/activity" style="margin-left:auto">
          {tFor(lang, "activity.fullLog")}
        </a>
      </div>
      {items.map((a, i) => (
        <div class="activity-item" key={i}>
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
            <div class="activity-item__time">{a.time}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
