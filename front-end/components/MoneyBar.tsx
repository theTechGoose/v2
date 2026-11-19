/**
 * REQ-798 — the dashboard's money bar, the star of the page: "Money owed to you" with its big
 * number, five stat columns in QuickBooks' order (estimates, unbilled, overdue, open, paid), one
 * segmented bar whose segments share the five amounts, and the selected bucket's documents listed
 * one by one, each a link to its quote or invoice. Rendered inside the DashboardPage island, so
 * the segment clicks are live.
 */
import { paidHow } from "../../shared/documents/paid-how.ts"; // REQ-928
import { useState } from "preact/hooks";
import Ticker from "../islands/Ticker.tsx";
import { SkelBlock } from "./Skeletons.tsx";
import { I, ICN } from "../lib/dash-icons.tsx";
import { fmtMoneyExact, fmtMoneyTotal } from "../lib/format.ts";
import { type Lang, tFor } from "../lib/i18n.ts";
// REQ-1039: the app's one language-aware short date ("4 dic" / "Dec 4"), and the business's day
import { shortDate } from "../../shared/documents/linked-view.ts";
import {
  DEFAULT_TIMEZONE,
  todayInZone,
} from "../../shared/quote-flow/business-timezone.ts";
import {
  defaultBucket,
  type MoneyBarData,
  type MoneyBarItem,
  type MoneyBucket,
  type MoneyBucketKey,
} from "../../shared/receivables/money-bar.ts";

const COLOR: Record<MoneyBucketKey, string> = {
  estimates: "var(--mb-estimates)",
  unbilled: "var(--mb-unbilled)",
  overdue: "var(--mb-overdue)",
  open: "var(--mb-open)",
  paid: "var(--mb-paid)",
};

/** where "View all" goes for a bucket */
const VIEW_ALL: Record<MoneyBucketKey, string> = {
  estimates: "/quotes",
  unbilled: "/quotes",
  overdue: "/invoices",
  open: "/invoices",
  paid: "/invoices",
};

const plural = (lang: Lang, key: string, n: number) =>
  tFor(lang, `${key}.${n === 1 ? "one" : "other"}`, { n });

/** REQ-1039: the whole-day count between two calendar days (YYYY-MM-DD) */
const dayDiff = (from: string, to: string) =>
  Math.round(
    (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) /
      86_400_000,
  );

function itemMeta(
  item: MoneyBarItem,
  bucket: MoneyBucketKey,
  lang: Lang,
  now: Date,
  timeZone: string,
): { text: string; tone: "danger" | "warn" | "ok" | "muted" } {
  const num = item.number;
  switch (bucket) {
    case "overdue": {
      const n = item.daysOverdue ?? 1;
      return {
        text: tFor(lang, `invoices.dash.overdue.${n === 1 ? "one" : "other"}`, {
          n,
          num,
        }),
        tone: "danger",
      };
    }
    case "open": {
      // REQ-1039 / REQ-944: count from today in the business's zone, not the browser's midnight
      const days = dayDiff(todayInZone(timeZone, now), item.dueDate ?? "");
      if (Number.isFinite(days) && days <= 5) {
        return {
          text: tFor(
            lang,
            `invoices.dash.dueIn.${days === 1 ? "one" : "other"}`,
            {
              n: days,
              num,
            },
          ),
          tone: "warn",
        };
      }
      return {
        text: tFor(lang, "invoices.dash.dueOn", {
          date: shortDate(item.dueDate, lang, false),
          num,
        }),
        tone: "ok",
      };
    }
    case "paid":
      return {
        text: tFor(lang, "moneyBar.paidOn", {
          date: shortDate(item.paidAt, lang, false, timeZone),
          num,
        }) + howOf(item.paidMethods, lang),
        tone: "ok",
      };
    case "estimates":
      return {
        text: tFor(lang, "moneyBar.sentOn", {
          date: shortDate(item.sentAt, lang, false, timeZone),
          num,
        }),
        tone: "muted",
      };
    case "unbilled":
      return {
        text: tFor(lang, "moneyBar.unbilledOf", {
          billed: fmtMoneyTotal(item.billedCents ?? 0),
          total: fmtMoneyTotal(item.agreedCents ?? 0),
          num,
        }),
        tone: "muted",
      };
  }
}

export function MoneyBar(
  {
    data,
    lang = "en",
    now = new Date(),
    upcoming = null,
    emptyKey = null,
    pending = false,
    timeZone = DEFAULT_TIMEZONE,
  }: {
    data: MoneyBarData;
    lang?: Lang;
    now?: Date;
    /** REQ-473: "Upcoming: $925 bills Nov 26" — the next scheduled installment, localized. */
    upcoming?: string | null;
    /** REQ-473: the text under an empty bar (outstandingEmptyKey); null when the upcoming line stands in. */
    emptyKey?: string | null;
    /** REQ-728: the lists have not landed — a skeleton stands where the rows go. */
    pending?: boolean;
    /** REQ-1039 / REQ-944: the business's IANA zone (/me businessTimezone) — paid/sent days and
     *  days-until-due are that zone's, never the browser's. */
    timeZone?: string;
  },
) {
  const [picked, setPicked] = useState<MoneyBucketKey | null>(null);
  const selected = picked ?? defaultBucket(data.buckets);
  const current: MoneyBucket | undefined = data.buckets.find((b) =>
    b.key === selected
  );
  const overdueCount = data.buckets[2]?.count ?? 0;
  const share = (b: MoneyBucket) =>
    data.totalCents > 0 ? (b.cents / data.totalCents) * 100 : 0;

  return (
    <section
      class="moneybar"
      data-cy="money-bar"
      data-selected={selected ?? ""}
    >
      <div class="moneybar__head">
        <div>
          <div class="moneybar__label">{tFor(lang, "outstanding.label")}</div>
          {
            /* REQ-957: while the lists load, owedCents is built from empty lists — a skeleton
              stands here, never a $0 beside the real tiles. */
          }
          {pending
            ? (
              <div
                class="moneybar__amt"
                data-cy="money-owed"
                aria-busy="true"
              >
                <SkelBlock h={40} w="160px" mt={4} />
              </div>
            )
            : (
              <div class="moneybar__amt" data-cy="money-owed">
                {/* REQ-961: the exact cents, so $2,489.75 never reads "$2,490" */}
                $<Ticker value={data.owedCents} cents />
              </div>
            )}
        </div>
        {overdueCount > 0 && (
          <a
            class="qbtn qbtn--nudge moneybar__nudge"
            href="/invoices"
            data-cy="money-nudge-all"
          >
            <I d={ICN.send} size={12} /> {tFor(lang, "outstanding.nudgeAll")}
          </a>
        )}
      </div>
      {upcoming && (
        <div class="moneybar__upcoming" data-cy="money-upcoming">
          {upcoming}
        </div>
      )}

      <div class="moneybar__cols" role="tablist">
        {data.buckets.map((b) => (
          <button
            type="button"
            key={b.key}
            class={`moneybar__col${
              b.key === selected ? " moneybar__col--on" : ""
            }`}
            data-cy="money-col"
            data-bucket={b.key}
            role="tab"
            aria-selected={b.key === selected}
            onClick={() => setPicked(b.key)}
            style={`--mb-c:${COLOR[b.key]}`}
          >
            <span class="moneybar__col-amt">{fmtMoneyTotal(b.cents)}</span>
            <span class="moneybar__col-cap">
              {plural(lang, `moneyBar.bucket.${b.key}`, b.count)}
            </span>
          </button>
        ))}
      </div>

      <div class="moneybar__track">
        {data.buckets.map((b) => (
          <button
            type="button"
            key={b.key}
            class={`moneybar__seg${
              b.key === selected ? " moneybar__seg--on" : ""
            }${b.cents === 0 ? " moneybar__seg--zero" : ""}`}
            data-cy="money-seg"
            data-bucket={b.key}
            aria-pressed={b.key === selected}
            aria-label={`${fmtMoneyTotal(b.cents)} · ${
              plural(lang, `moneyBar.bucket.${b.key}`, b.count)
            }`}
            title={`${fmtMoneyTotal(b.cents)} · ${
              plural(lang, `moneyBar.bucket.${b.key}`, b.count)
            }`}
            onClick={() => setPicked(b.key)}
            style={`flex-basis:${share(b)}%;--mb-c:${COLOR[b.key]}`}
          />
        ))}
      </div>

      <div
        class="moneybar__list"
        data-cy="money-list"
        data-bucket={selected ?? ""}
      >
        {!current && pending
          ? (
            <div aria-busy="true">
              <SkelBlock h={14} w="70%" mt={6} />
              <SkelBlock h={36} mt={14} />
            </div>
          )
          : !current
          ? (emptyKey
            ? (
              <div class="moneybar__empty" data-cy="money-empty">
                {tFor(lang, emptyKey)}
              </div>
            )
            : null)
          : current.count === 0
          ? (
            <div class="moneybar__empty" data-cy="money-empty">
              {tFor(lang, "moneyBar.empty")}
            </div>
          )
          : (
            <>
              <div class="moneybar__list-head">
                <span class="moneybar__list-title">
                  <span
                    class="moneybar__dot"
                    style={`background:${COLOR[current.key]}`}
                  />
                  {plural(
                    lang,
                    `moneyBar.bucket.${current.key}`,
                    current.count,
                  )}
                </span>
                <span class="moneybar__hint">
                  {tFor(lang, "moneyBar.hint")}
                </span>
                <a class="moneybar__all" href={VIEW_ALL[current.key]}>
                  {tFor(lang, "moneyBar.viewAll")}
                </a>
              </div>
              {current.items.map((item) => {
                const meta = itemMeta(item, current.key, lang, now, timeZone);
                return (
                  <a
                    class="moneybar__row"
                    key={`${current.key}:${item.id}`}
                    href={item.url}
                    data-cy="money-row"
                    data-kind={item.kind}
                    data-id={item.id}
                  >
                    <span class="moneybar__row-main">
                      <span class="moneybar__row-client">
                        {item.title}
                        {/* REQ-1039: a real space, not CSS margin — "Rosa Delgado · Instalación" */}
                        {item.job && " "}
                        {item.job && (
                          <span class="moneybar__row-job">· {item.job}</span>
                        )}
                      </span>
                      <span
                        class={`moneybar__row-meta moneybar__row-meta--${meta.tone}`}
                      >
                        {meta.text}
                      </span>
                    </span>
                    <span class="moneybar__row-amt">
                      {fmtMoneyExact(item.cents)}
                    </span>
                    <I d={ICN.arrow} size={14} />
                  </a>
                );
              })}
            </>
          )}
      </div>
    </section>
  );
}

/** REQ-928: " · Electronic (Venmo)" after the paid line, "" when unknown. */
function howOf(methods: string[] | undefined, lang: Lang): string {
  const how = paidHow((k, v) => tFor(lang, k, v), methods);
  return how ? ` · ${how}` : "";
}
