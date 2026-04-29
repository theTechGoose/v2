/**
 * Server-rendered sections for /clients: editorial header, today's loop strip,
 * leaderboard, and segment-mix bar. Pure presentation — feed them backend data.
 */
import { I, ICN } from "../lib/dash-icons.tsx";
import type {
  ClientSegmentRow,
  CustomerCard,
  TopClient,
} from "../clients/clients.ts";
import { dollars, initialsOf, numberWord } from "../lib/clients-display.ts";

interface ClientsHeroProps {
  totalClients: number;
  activeJobs: number;
  owedTotal: number;
  quietCount: number;
}

export function ClientsHero({ totalClients, activeJobs, owedTotal, quietCount }: ClientsHeroProps) {
  const owedFmt = owedTotal.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return (
    <div class="ph2">
      <div>
        <div class="ph2__crumb">
          <span class="ph2__crumb-dot" /> Clients · {totalClients} on the books
        </div>
        <h1 class="ph2__title">
          The <em>{numberWord(totalClients)} {totalClients === 1 ? "person" : "people"}</em><br />who keep the lights on.
        </h1>
        <p class="ph2__sub">
          <strong>{activeJobs} jobs in flight</strong> · <strong>${owedFmt}</strong> currently owed to you · <strong>{quietCount} quiet</strong> {quietCount === 1 ? "client" : "clients"} worth a hello.
        </p>
      </div>
      <button class="ph2__cta" type="button">
        <I d={ICN.plus} size={14} /> Add a client
      </button>
    </div>
  );
}

interface LoopBarProps {
  picks: CustomerCard[];
}

const LOOP_AV_BG = [
  "linear-gradient(135deg, var(--coffee-300), var(--coffee-500))",
  "linear-gradient(135deg, var(--coffee-400), #4F362A)",
  "linear-gradient(135deg, var(--pink-300), var(--brand-pink))",
];

export function LoopBar({ picks }: LoopBarProps) {
  if (picks.length === 0) {
    return (
      <div class="loopbar">
        <div class="loopbar__title">
          <span class="loopbar__lbl"><span class="loopbar__lbl-dot" /> Today's loop</span>
          <span class="loopbar__h">No check-ins drafted yet — the assistant will surface them as work piles up.</span>
        </div>
        <a class="loopbar__cta" href="/assistant"><I d={ICN.send} size={13} /> Open the assistant</a>
      </div>
    );
  }
  const names = picks.map((p) => p.name.split(" ")[0]).join(" · ");
  return (
    <div class="loopbar">
      <div class="loopbar__title">
        <span class="loopbar__lbl"><span class="loopbar__lbl-dot" /> Today's loop</span>
        <span class="loopbar__h">{picks.length} friendly check-{picks.length === 1 ? "in" : "ins"}, drafted for you.</span>
      </div>
      <div class="loopbar__avs">
        {picks.map((p, i) => (
          <div key={p.id} class="loopbar__av" style={`background:${LOOP_AV_BG[i % LOOP_AV_BG.length]}`}>
            {initialsOf(p.name)}
          </div>
        ))}
        <div class="loopbar__av-meta">
          {names}<br />
          <strong>~{picks.length * 30} seconds</strong> to send {picks.length === 1 ? "it" : "all " + numberWord(picks.length)}
        </div>
      </div>
      <a class="loopbar__cta" href="/assistant"><I d={ICN.send} size={13} /> Open the loop</a>
    </div>
  );
}

interface TopClientsProps { rows: TopClient[] }

export function TopClients({ rows }: TopClientsProps) {
  if (rows.length === 0) {
    return (
      <div class="ctop2">
        <div class="ctop2__head">
          <div class="ctop2__title">Top of the leaderboard</div>
          <div class="ctop2__period">last 12 mo</div>
        </div>
        <div class="ctop2__empty">No paid invoices in the last year yet.</div>
      </div>
    );
  }
  return (
    <div class="ctop2">
      <div class="ctop2__head">
        <div class="ctop2__title">Top of the leaderboard</div>
        <div class="ctop2__period">last 12 mo</div>
      </div>
      <div class="ctop2__list">
        {rows.map((t, i) => (
          <div key={t.customerId}>
            <div class="ctop2__item">
              <div class={`ctop2__rank ${i === 0 ? "ctop2__rank--1" : ""}`}>{String(t.rank).padStart(2, "0")}</div>
              <div class="ctop2__name">{t.name}</div>
              <div class="ctop2__amt">{dollars(t.revenue12moCents)}</div>
            </div>
            <div class="ctop2__bar-wrap">
              <div class="ctop2__bar" style={`width: ${t.barPct}%`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface ClientsSegmentsProps { rows: ClientSegmentRow[] }

const SEGMENT_COLOR: Record<string, string> = {
  property_mgmt: "var(--brand-green)",
  homeowner:     "var(--brand-pink)",
  small_biz:     "var(--brand-teal)",
  hoa:           "var(--coffee-500)",
  unsorted:      "var(--coffee-300)",
};

export function ClientsSegments({ rows }: ClientsSegmentsProps) {
  if (rows.length === 0) {
    return (
      <div class="csegment2">
        <div class="csegment2__title">Who's on your books</div>
        <div class="csegment2__empty">No clients yet.</div>
      </div>
    );
  }
  // Plural-ize labels for the section
  const PLURAL: Record<string, string> = {
    "Property mgmt": "Property mgmt",
    "Homeowner":     "Homeowners",
    "Small biz":     "Small biz",
    "HOA":           "HOAs",
    "Unsorted":      "Unsorted",
  };
  return (
    <div class="csegment2">
      <div class="csegment2__title">Who's on your books</div>
      {rows.map((s) => (
        <div class="cseg2-row" key={s.key}>
          <div class="cseg2-row__lbl">{PLURAL[s.label] ?? s.label}</div>
          <div class="cseg2-row__bar"><div class="cseg2-row__fill" style={`width:${s.pct}%; background:${SEGMENT_COLOR[s.key] ?? "var(--coffee-300)"}`} /></div>
          <div class="cseg2-row__num">{s.count}</div>
        </div>
      ))}
    </div>
  );
}
