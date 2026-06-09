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
import { type Lang, tFor } from "../lib/i18n.ts";

interface ClientsHeroProps {
  totalClients: number;
  activeJobs: number;
  owedTotal: number;
  quietCount: number;
  lang?: Lang;
  /** Open the add-client modal. Rendered inside the ClientsPage island, so
   *  this closure hydrates with it (not a cross-island prop). */
  onAdd?: () => void;
}

export function ClientsHero(
  { totalClients, activeJobs, owedTotal, quietCount, lang = "en", onAdd }:
    ClientsHeroProps,
) {
  const owedFmt = owedTotal.toLocaleString("en-US", {
    maximumFractionDigits: 0,
  });
  const empty = totalClients === 0;
  return (
    <div class="ph2">
      <div>
        <div class="ph2__crumb">
          <span class="ph2__crumb-dot" />{" "}
          {tFor(lang, "clientsHero.crumb", { n: totalClients })}
        </div>
        {empty
          ? (
            <>
              <h1 class="ph2__title">
                {tFor(lang, "clientsHero.emptyTitlePre")}{" "}
                <em>{tFor(lang, "clientsHero.emptyTitleEm")}</em>.<br />
                {tFor(lang, "clientsHero.emptyTitlePost")}
              </h1>
              <p class="ph2__sub">
                {tFor(lang, "clientsHero.emptySub")}
              </p>
            </>
          )
          : (
            <>
              <h1 class="ph2__title">
                {tFor(lang, "clientsHero.titlePre")}{" "}
                <em>
                  {tFor(
                    lang,
                    `clientsHero.people.${totalClients === 1 ? "one" : "other"}`,
                    { word: numberWord(totalClients, lang) },
                  )}
                </em>
                <br />{tFor(lang, "clientsHero.titlePost")}
              </h1>
              <p class="ph2__sub">
                <strong>
                  {tFor(
                    lang,
                    `clientsHero.jobsInFlight.${
                      activeJobs === 1 ? "one" : "other"
                    }`,
                    { n: activeJobs },
                  )}
                </strong>{" "}
                · <strong>${owedFmt}</strong>{" "}
                {tFor(lang, "clientsHero.owed")} ·{" "}
                <strong>
                  {tFor(lang, "clientsHero.quiet", { n: quietCount })}
                </strong>{" "}
                {tFor(
                  lang,
                  `clientsHero.quietClients.${
                    quietCount === 1 ? "one" : "other"
                  }`,
                  { n: quietCount },
                )}
              </p>
            </>
          )}
      </div>
      <button class="ph2__cta" type="button" onClick={onAdd}>
        <I d={ICN.plus} size={14} /> {tFor(lang, "clientsHero.addClient")}
      </button>
    </div>
  );
}

interface LoopBarProps {
  picks: CustomerCard[];
  lang?: Lang;
}

const LOOP_AV_BG = [
  "linear-gradient(135deg, var(--coffee-300), var(--coffee-500))",
  "linear-gradient(135deg, var(--coffee-400), #4F362A)",
  "linear-gradient(135deg, var(--pink-300), var(--brand-pink))",
];

export function LoopBar({ picks, lang = "en" }: LoopBarProps) {
  if (picks.length === 0) {
    return (
      <div class="loopbar">
        <div class="loopbar__title">
          <span class="loopbar__lbl">
            <span class="loopbar__lbl-dot" /> {tFor(lang, "loopBar.label")}
          </span>
          <span class="loopbar__h">
            {tFor(lang, "loopBar.empty")}
          </span>
        </div>
        <a class="loopbar__cta" href="/assistant">
          <I d={ICN.send} size={13} /> {tFor(lang, "loopBar.openAssistant")}
        </a>
      </div>
    );
  }
  const names = picks.map((p) => p.name.split(" ")[0]).join(" · ");
  return (
    <div class="loopbar">
      <div class="loopbar__title">
        <span class="loopbar__lbl">
          <span class="loopbar__lbl-dot" /> {tFor(lang, "loopBar.label")}
        </span>
        <span class="loopbar__h">
          {tFor(
            lang,
            `loopBar.heading.${picks.length === 1 ? "one" : "other"}`,
            { n: picks.length },
          )}
        </span>
      </div>
      <div class="loopbar__avs">
        {picks.map((p, i) => (
          <div
            key={p.id}
            class="loopbar__av"
            style={`background:${LOOP_AV_BG[i % LOOP_AV_BG.length]}`}
          >
            {initialsOf(p.name)}
          </div>
        ))}
        <div class="loopbar__av-meta">
          {names}
          <br />
          <strong>
            {tFor(lang, "loopBar.seconds", { n: picks.length * 30 })}
          </strong>{" "}
          {tFor(lang, "loopBar.toSend")}{" "}
          {picks.length === 1
            ? tFor(lang, "loopBar.sendIt")
            : tFor(lang, "loopBar.sendAll", {
              word: numberWord(picks.length, lang),
            })}
        </div>
      </div>
      <a class="loopbar__cta" href="/assistant">
        <I d={ICN.send} size={13} /> {tFor(lang, "loopBar.openLoop")}
      </a>
    </div>
  );
}

interface TopClientsProps {
  rows: TopClient[];
  lang?: Lang;
}

export function TopClients({ rows, lang = "en" }: TopClientsProps) {
  if (rows.length === 0) {
    return (
      <div class="ctop2">
        <div class="ctop2__head">
          <div class="ctop2__title">{tFor(lang, "topClients.title")}</div>
          <div class="ctop2__period">{tFor(lang, "topClients.period")}</div>
        </div>
        <div class="ctop2__empty">{tFor(lang, "topClients.empty")}</div>
      </div>
    );
  }
  return (
    <div class="ctop2">
      <div class="ctop2__head">
        <div class="ctop2__title">{tFor(lang, "topClients.title")}</div>
        <div class="ctop2__period">{tFor(lang, "topClients.period")}</div>
      </div>
      <div class="ctop2__list">
        {rows.map((t, i) => (
          <div key={t.customerId}>
            <div class="ctop2__item">
              <div class={`ctop2__rank ${i === 0 ? "ctop2__rank--1" : ""}`}>
                {String(t.rank).padStart(2, "0")}
              </div>
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

interface ClientsSegmentsProps {
  rows: ClientSegmentRow[];
  lang?: Lang;
}

const SEGMENT_COLOR: Record<string, string> = {
  property_mgmt: "var(--brand-green)",
  homeowner: "var(--brand-pink)",
  small_biz: "var(--brand-teal)",
  hoa: "var(--coffee-500)",
  unsorted: "var(--coffee-300)",
};

export function ClientsSegments({ rows, lang = "en" }: ClientsSegmentsProps) {
  if (rows.length === 0) {
    return (
      <div class="csegment2">
        <div class="csegment2__title">
          {tFor(lang, "clientsSegments.title")}
        </div>
        <div class="csegment2__empty">{tFor(lang, "clientsSegments.empty")}</div>
      </div>
    );
  }
  // Plural-ize labels for the section
  const PLURAL: Record<string, string> = {
    "property_mgmt": tFor(lang, "clientsSegments.label.property_mgmt"),
    "homeowner": tFor(lang, "clientsSegments.label.homeowner"),
    "small_biz": tFor(lang, "clientsSegments.label.small_biz"),
    "hoa": tFor(lang, "clientsSegments.label.hoa"),
    "unsorted": tFor(lang, "clientsSegments.label.unsorted"),
  };
  return (
    <div class="csegment2">
      <div class="csegment2__title">{tFor(lang, "clientsSegments.title")}</div>
      {rows.map((s) => (
        <div class="cseg2-row" key={s.key}>
          <div class="cseg2-row__lbl">{PLURAL[s.key] ?? s.label}</div>
          <div class="cseg2-row__bar">
            <div
              class="cseg2-row__fill"
              style={`width:${s.pct}%; background:${
                SEGMENT_COLOR[s.key] ?? "var(--coffee-300)"
              }`}
            />
          </div>
          <div class="cseg2-row__num">{s.count}</div>
        </div>
      ))}
    </div>
  );
}
