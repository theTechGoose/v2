/**
 * Server-rendered sections for /clients. Ported from the prototype's
 * ClientsHero, LoopBar, TopClients, and ClientsSegments components.
 * The interactive search/filter + cards grid live in islands/.
 */
import { I, ICN } from "../lib/dash-icons.tsx";
import type { SegmentRow, TopClient } from "../lib/clients-seed.ts";

interface ClientsHeroProps {
  totalClients: number;
  activeJobs: number;
  owedTotal: number;
  quietCount: number;
}

export function ClientsHero({ totalClients, activeJobs, owedTotal, quietCount }: ClientsHeroProps) {
  const owedFmt = owedTotal.toLocaleString();
  return (
    <div class="ph2">
      <div>
        <div class="ph2__crumb">
          <span class="ph2__crumb-dot" /> Clients · {totalClients} on the books
        </div>
        <h1 class="ph2__title">
          The <em>twelve people</em><br />who keep the lights on.
        </h1>
        <p class="ph2__sub">
          <strong>{activeJobs} jobs in flight</strong> · <strong>${owedFmt}</strong> currently owed to you · <strong>{quietCount} quiet</strong> clients worth a hello.
        </p>
      </div>
      <button class="ph2__cta" type="button">
        <I d={ICN.plus} size={14} /> Add a client
      </button>
    </div>
  );
}

export function LoopBar() {
  return (
    <div class="loopbar">
      <div class="loopbar__title">
        <span class="loopbar__lbl"><span class="loopbar__lbl-dot" /> Today's loop</span>
        <span class="loopbar__h">3 friendly check-ins, drafted for you.</span>
      </div>
      <div class="loopbar__avs">
        <div class="loopbar__av" style="background:linear-gradient(135deg, var(--coffee-300), var(--coffee-500))">TK</div>
        <div class="loopbar__av" style="background:linear-gradient(135deg, var(--coffee-400), #4F362A)">HD</div>
        <div class="loopbar__av" style="background:linear-gradient(135deg, var(--pink-300), var(--brand-pink))">RY</div>
        <div class="loopbar__av-meta">Tom · Hilltop · Riverside<br /><strong>~90 seconds</strong> to send all three</div>
      </div>
      <a class="loopbar__cta" href="/assistant"><I d={ICN.send} size={13} /> Open the loop</a>
    </div>
  );
}

interface TopClientsProps { rows: TopClient[] }

export function TopClients({ rows }: TopClientsProps) {
  return (
    <div class="ctop2">
      <div class="ctop2__head">
        <div class="ctop2__title">Top of the leaderboard</div>
        <div class="ctop2__period">last 12 mo</div>
      </div>
      <div class="ctop2__list">
        {rows.map((t, i) => (
          <div key={t.name}>
            <div class="ctop2__item">
              <div class={`ctop2__rank ${i === 0 ? "ctop2__rank--1" : ""}`}>0{i + 1}</div>
              <div class="ctop2__name">{t.name}</div>
              <div class="ctop2__amt">{t.amt}</div>
            </div>
            <div class="ctop2__bar-wrap">
              <div class="ctop2__bar" style={`width: ${t.pct}%`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface ClientsSegmentsProps { rows: SegmentRow[] }

export function ClientsSegments({ rows }: ClientsSegmentsProps) {
  return (
    <div class="csegment2">
      <div class="csegment2__title">Who's on your books</div>
      {rows.map((s) => (
        <div class="cseg2-row" key={s.lbl}>
          <div class="cseg2-row__lbl">{s.lbl}</div>
          <div class="cseg2-row__bar"><div class="cseg2-row__fill" style={`width:${s.pct}%; background:${s.color}`} /></div>
          <div class="cseg2-row__num">{s.num}</div>
        </div>
      ))}
    </div>
  );
}
