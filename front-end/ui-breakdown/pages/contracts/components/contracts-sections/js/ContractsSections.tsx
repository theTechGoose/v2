/**
 * Server-rendered sections for /contracts. Ported from the prototype's
 * ContractsHero, ContractsKPIs, and ScheduleStrip.
 *
 * The interactive Track collapse + ContractCard flip live in islands/.
 */
import { I, ICN } from "../lib/dash-icons.tsx";
import { fmtMoney } from "../lib/format.ts";
import { type Lang, tFor } from "../lib/i18n.ts";
import type { ContractCard } from "../lib/contracts-shape.ts";

/** Plural helper bound to an explicit SSR language. */
function tnFor(lang: Lang, key: string, n: number, vars?: Record<string, string | number>): string {
  return tFor(lang, `${key}.${n === 1 ? "one" : "other"}`, { n, ...vars });
}

interface HeroProps {
  totalValue: number;
  contractCount: number;
  inFlightCount: number;
  inFlightValue: number;
  startingSoonCount: number;
  pendingDeposits: number;
  lang?: Lang;
}

export function ContractsHero({
  totalValue,
  contractCount,
  inFlightCount,
  inFlightValue,
  startingSoonCount,
  pendingDeposits,
  lang = "en",
}: HeroProps) {
  const allZero = inFlightCount === 0 && pendingDeposits === 0 &&
    startingSoonCount === 0;
  return (
    <section class="kph">
      <div class="kph__inner">
        <div>
          <div class="kph__eyebrow">
            <span class="kph__eyebrow-dot" />
            {tFor(lang, "contractsHero.eyebrow")} ·{" "}
            {tnFor(lang, "contractsHero.contracts", contractCount)}
          </div>
          <h1 class="kph__title">
            <em>{fmtMoney(totalValue)}</em> {tFor(lang, "contractsHero.titlePre")}<br />
            {tFor(lang, "contractsHero.titlePost")}
          </h1>
          <p class="kph__sub">
            {allZero
              ? <>{tFor(lang, "contractsHero.empty")}</>
              : (
                <>
                  {tnFor(lang, "contractsHero.jobsRunning", inFlightCount)} ·{" "}
                  <strong>
                    {tFor(lang, "contractsHero.depositsAmount", {
                      money: fmtMoney(pendingDeposits),
                    })}
                  </strong>{" "}
                  {tFor(lang, "contractsHero.subMid", {
                    n: startingSoonCount,
                  })}
                </>
              )}
          </p>
          {!allZero && (
            <p
              class="kph__sub"
              style="margin-top:6px;font-size:12.5px;opacity:0.75"
            >
              {tFor(lang, "contractsHero.activeValue", {
                money: fmtMoney(inFlightValue),
              })}
            </p>
          )}
        </div>
        <a
          class="kph__cta"
          href={`/assistant?seed=${
            encodeURIComponent(tFor(lang, "contractsHero.seed"))
          }`}
        >
          <I d={ICN.plus} size={14} sw={2.5} /> {tFor(lang, "contractsHero.cta")}
        </a>
      </div>
    </section>
  );
}

interface KpisProps {
  inProgressCount: number;
  inProgressValue: number;
  startingSoonCount: number;
  startingSoonValue: number;
  wrappingUpCount: number;
  wrappingUpLeft: number;
  closedCount: number;
  closedValue: number;
  lang?: Lang;
}

export function ContractsKpis({
  inProgressCount,
  inProgressValue,
  startingSoonCount,
  startingSoonValue,
  wrappingUpCount,
  wrappingUpLeft,
  closedCount,
  closedValue,
  lang = "en",
}: KpisProps) {
  return (
    <div class="kkpi">
      <div class="kkpi__card kkpi__card--accent">
        <div class="kkpi__lbl">{tFor(lang, "contractsKpi.inProgress")}</div>
        <div class="kkpi__num kkpi__num--pink">
          {tnFor(lang, "contractsKpi.jobs", inProgressCount)}
        </div>
        <div class="kkpi__sub">
          {tFor(lang, "contractsKpi.active", { money: fmtMoney(inProgressValue) })}
        </div>
      </div>
      <div class="kkpi__card">
        <div class="kkpi__lbl">{tFor(lang, "contractsKpi.startingSoon")}</div>
        <div class="kkpi__num">
          {tnFor(lang, "contractsKpi.jobs", startingSoonCount)}
        </div>
        <div class="kkpi__sub">
          {tFor(lang, "contractsKpi.next14Days", {
            money: fmtMoney(startingSoonValue),
          })}
        </div>
      </div>
      <div class="kkpi__card">
        <div class="kkpi__lbl">{tFor(lang, "contractsKpi.wrappingUp")}</div>
        <div class="kkpi__num">
          {tnFor(lang, "contractsKpi.jobs", wrappingUpCount)}
        </div>
        <div class="kkpi__sub">
          {tFor(lang, "contractsKpi.leftToBill", {
            money: fmtMoney(wrappingUpLeft),
          })}
        </div>
      </div>
      <div class="kkpi__card">
        <div class="kkpi__lbl">{tFor(lang, "contractsKpi.closedThisMonth")}</div>
        <div class="kkpi__num">
          {tnFor(lang, "contractsKpi.jobs", closedCount)}
        </div>
        <div class="kkpi__sub">
          {tFor(lang, "contractsKpi.allPaid", { money: fmtMoney(closedValue) })}
        </div>
      </div>
    </div>
  );
}

interface StripProps {
  cards: ContractCard[];
  lang?: Lang;
}

const RANGE_FROM = 1;
const RANGE_TO = 30;
const TODAY_INDEX = 8;
const WEEKS = [
  { labelKey: "schedule.week1", from: 1, to: 7 },
  { labelKey: "schedule.week2", from: 8, to: 14 },
  { labelKey: "schedule.week3", from: 15, to: 21 },
  { labelKey: "schedule.week4", from: 22, to: 28 },
  { labelKey: "schedule.week5", from: 29, to: 30 },
];

const LANE_H = 22;
const LANE_GAP = 4;

interface PackedBar {
  card: ContractCard;
  lane: number;
}

function packLanes(
  cards: ContractCard[],
): { laneCount: number; placed: PackedBar[] } {
  const sorted = [...cards].sort((a, b) => a.scheduleStart - b.scheduleStart);
  const laneEnds: number[] = [];
  const placed: PackedBar[] = [];
  for (const c of sorted) {
    let lane = -1;
    for (let li = 0; li < laneEnds.length; li++) {
      if (laneEnds[li] < c.scheduleStart) {
        laneEnds[li] = c.scheduleEnd;
        lane = li;
        break;
      }
    }
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(c.scheduleEnd);
    }
    placed.push({ card: c, lane });
  }
  return { laneCount: laneEnds.length, placed };
}

function pos(d: number, from: number, to: number): string {
  return `${((d - from) / (to - from + 1)) * 100}%`;
}
function widthPct(
  start: number,
  end: number,
  from: number,
  to: number,
): string {
  return `${((end - start + 1) / (to - from + 1)) * 100}%`;
}

export function ScheduleStrip({ cards, lang = "en" }: StripProps) {
  const visible = cards.filter((c) =>
    c.scheduleEnd >= RANGE_FROM && c.scheduleStart <= RANGE_TO
  );
  const { laneCount, placed } = packLanes(visible);
  const rowH = Math.max(1, laneCount) * LANE_H +
    Math.max(0, laneCount - 1) * LANE_GAP + 6;
  const lanesH = `${rowH}px`;

  return (
    <section class="csched">
      <div class="csched__head">
        <div>
          <div class="csched__eyebrow">{tFor(lang, "schedule.eyebrow")}</div>
          <div class="csched__title">
            {tFor(lang, "schedule.title")}
          </div>
        </div>
        <div class="csched__legend">
          <span>
            <span class="csched__legend-dot" style="background:#FF6B6B" />
            {tFor(lang, "schedule.legendInProgress")}
          </span>
          <span>
            <span
              class="csched__legend-dot"
              style="background:rgba(255,255,255,0.3);border:1px dashed rgba(255,255,255,0.6)"
            />
            {tFor(lang, "schedule.legendScheduled")}
          </span>
        </div>
      </div>
      <div class="csched__grid">
        {WEEKS.map((w, wi) => {
          const bars = placed.filter(({ card }) =>
            card.scheduleEnd >= w.from && card.scheduleStart <= w.to
          );
          const showToday = TODAY_INDEX >= w.from && TODAY_INDEX <= w.to;
          return (
            <div key={wi} class="csched__weekrow">
              <div class="csched__weeklbl">{tFor(lang, w.labelKey)}</div>
              <div class="csched__weekbar" style={`--lanes-h:${lanesH}`}>
                {showToday && (
                  <div
                    class="csched__today"
                    style={`left:${pos(TODAY_INDEX + 0.5, w.from, w.to)}`}
                  />
                )}
                {bars.map(({ card, lane }) => {
                  const s = Math.max(card.scheduleStart, w.from);
                  const e = Math.min(card.scheduleEnd, w.to);
                  const top = 3 + lane * (LANE_H + LANE_GAP);
                  const style = `--bar-from:${card.scheduleColor[0]};` +
                    `--bar-to:${card.scheduleColor[1]};` +
                    `left:${pos(s, w.from, w.to)};` +
                    `width:${widthPct(s, e, w.from, w.to)};` +
                    `top:${top}px;height:${LANE_H - 2}px`;
                  return (
                    <div
                      key={card.id}
                      class={`csched__bar ${
                        card.scheduleScheduled ? "csched__bar--scheduled" : ""
                      }`}
                      style={style}
                      title={`${card.client} — ${card.when}`}
                    >
                      {card.initials} · {card.client.split(" ")[0]}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {placed.length === 0 && (
          <div class="csched__empty">
            {tFor(lang, "schedule.empty")}
          </div>
        )}
      </div>
    </section>
  );
}
