/**
 * Server-rendered sections for /contracts. Ported from the prototype's
 * ContractsHero, ContractsKPIs, and ScheduleStrip.
 *
 * The interactive Track collapse + ContractCard flip live in islands/.
 */
import { I, ICN } from "../lib/dash-icons.tsx";
import type { ContractCard } from "../lib/contracts-shape.ts";

interface HeroProps {
  totalValue: number;
  contractCount: number;
  inFlightCount: number;
  inFlightValue: number;
  startingSoonCount: number;
  pendingDeposits: number;
}

function fmtMoney(n: number): string {
  return Math.round(n).toLocaleString();
}

export function ContractsHero({
  totalValue,
  contractCount,
  inFlightCount,
  inFlightValue,
  startingSoonCount,
  pendingDeposits,
}: HeroProps) {
  return (
    <section class="kph">
      <div class="kph__inner">
        <div>
          <div class="kph__eyebrow">
            <span class="kph__eyebrow-dot" />
            Work in flight · {contractCount} {contractCount === 1 ? "contract" : "contracts"}
          </div>
          <h1 class="kph__title">
            <em>${fmtMoney(totalValue)}</em> of work<br />
            you've already promised.
          </h1>
          <p class="kph__sub">
            {inFlightCount} {inFlightCount === 1 ? "job" : "jobs"} running today ·{" "}
            <strong>${fmtMoney(pendingDeposits)} in deposits</strong> still to bill ·{" "}
            {startingSoonCount} starting next week. The monsters are watching the next
            milestone on every one of them.
          </p>
          <p class="kph__sub" style="margin-top:6px;font-size:12.5px;opacity:0.75">
            Active value · ${fmtMoney(inFlightValue)}
          </p>
        </div>
        <button class="kph__cta" type="button">
          <I d={ICN.plus} size={14} sw={2.5} /> Schedule a job
        </button>
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
}: KpisProps) {
  return (
    <div class="kkpi">
      <div class="kkpi__card kkpi__card--accent">
        <div class="kkpi__lbl">In progress</div>
        <div class="kkpi__num kkpi__num--pink">
          {inProgressCount} {inProgressCount === 1 ? "job" : "jobs"}
        </div>
        <div class="kkpi__sub">${fmtMoney(inProgressValue)} active</div>
      </div>
      <div class="kkpi__card">
        <div class="kkpi__lbl">Starting soon</div>
        <div class="kkpi__num">
          {startingSoonCount} {startingSoonCount === 1 ? "job" : "jobs"}
        </div>
        <div class="kkpi__sub">${fmtMoney(startingSoonValue)} · next 14 days</div>
      </div>
      <div class="kkpi__card">
        <div class="kkpi__lbl">Wrapping up</div>
        <div class="kkpi__num">
          {wrappingUpCount} {wrappingUpCount === 1 ? "job" : "jobs"}
        </div>
        <div class="kkpi__sub">${fmtMoney(wrappingUpLeft)} left to bill</div>
      </div>
      <div class="kkpi__card">
        <div class="kkpi__lbl">Closed this month</div>
        <div class="kkpi__num">
          {closedCount} {closedCount === 1 ? "job" : "jobs"}
        </div>
        <div class="kkpi__sub">${fmtMoney(closedValue)} · all paid</div>
      </div>
    </div>
  );
}

interface StripProps {
  cards: ContractCard[];
}

const RANGE_FROM = 1;
const RANGE_TO   = 30;
const TODAY_INDEX = 8;
const WEEKS = [
  { label: "WEEK 1", from: 1,  to: 7  },
  { label: "WEEK 2", from: 8,  to: 14 },
  { label: "WEEK 3", from: 15, to: 21 },
  { label: "WEEK 4", from: 22, to: 28 },
  { label: "WEEK 5", from: 29, to: 30 },
];

const LANE_H = 22;
const LANE_GAP = 4;

interface PackedBar {
  card: ContractCard;
  lane: number;
}

function packLanes(cards: ContractCard[]): { laneCount: number; placed: PackedBar[] } {
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
function widthPct(start: number, end: number, from: number, to: number): string {
  return `${((end - start + 1) / (to - from + 1)) * 100}%`;
}

export function ScheduleStrip({ cards }: StripProps) {
  const visible = cards.filter((c) =>
    c.scheduleEnd >= RANGE_FROM && c.scheduleStart <= RANGE_TO
  );
  const { laneCount, placed } = packLanes(visible);
  const rowH = Math.max(1, laneCount) * LANE_H + Math.max(0, laneCount - 1) * LANE_GAP + 6;
  const lanesH = `${rowH}px`;

  return (
    <section class="csched">
      <div class="csched__head">
        <div>
          <div class="csched__eyebrow">The next 30 days</div>
          <div class="csched__title">Everything you've committed to, on one strip.</div>
        </div>
        <div class="csched__legend">
          <span><span class="csched__legend-dot" style="background:#FF6B6B" />In progress</span>
          <span><span class="csched__legend-dot" style="background:rgba(255,255,255,0.3);border:1px dashed rgba(255,255,255,0.6)" />Scheduled</span>
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
              <div class="csched__weeklbl">{w.label}</div>
              <div class="csched__weekbar" style={`--lanes-h:${lanesH}`}>
                {showToday && (
                  <div class="csched__today" style={`left:${pos(TODAY_INDEX + 0.5, w.from, w.to)}`} />
                )}
                {bars.map(({ card, lane }) => {
                  const s = Math.max(card.scheduleStart, w.from);
                  const e = Math.min(card.scheduleEnd,   w.to);
                  const top = 3 + lane * (LANE_H + LANE_GAP);
                  const style =
                    `--bar-from:${card.scheduleColor[0]};` +
                    `--bar-to:${card.scheduleColor[1]};` +
                    `left:${pos(s, w.from, w.to)};` +
                    `width:${widthPct(s, e, w.from, w.to)};` +
                    `top:${top}px;height:${LANE_H - 2}px`;
                  return (
                    <div
                      key={card.id}
                      class={`csched__bar ${card.scheduleScheduled ? "csched__bar--scheduled" : ""}`}
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
            Nothing on the calendar yet. Sign a contract from the assistant and it'll show up here.
          </div>
        )}
      </div>
    </section>
  );
}
