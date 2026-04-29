/**
 * Pipeline contract card with flip-to-back milestone timeline.
 * Mirrors the prototype's ContractCard component.
 *
 * Milestones aren't persisted server-side yet, so the back face renders a
 * deterministic synthesis from start / completion dates. When the backend
 * gains a Milestone shape this component will switch to consume it directly.
 */
import { useState } from "preact/hooks";
import { I, ICN } from "../lib/dash-icons.tsx";
import type { ContractCard as Card } from "../lib/contracts-shape.ts";

interface Props {
  c: Card;
  idx: number;
}

interface Milestone {
  name: string;
  date: string;
  done: boolean;
  current?: boolean;
}

function fmtDate(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function buildMilestones(c: Card, now = new Date()): Milestone[] {
  const start = c.startDate ? new Date(c.startDate) : undefined;
  const end   = c.completionDate ? new Date(c.completionDate) : undefined;
  if (!start && !end) {
    return [
      { name: "Contract signed", date: "—", done: c.mood !== "draft" },
      { name: "Work in progress", date: "—", done: c.mood === "completed" || c.mood === "wrapping-up", current: c.mood === "active" },
      { name: "Final invoice + close-out", date: "—", done: c.mood === "completed", current: c.mood === "wrapping-up" },
    ];
  }
  const s = start ?? end!;
  const e = end ?? start!;
  const span = Math.max(1, Math.round((e.getTime() - s.getTime()) / 86_400_000));
  const stops = [
    { offset: 0,        name: "Site walk + start" },
    { offset: 0.25,     name: "First milestone" },
    { offset: 0.55,     name: "Mid-point check-in" },
    { offset: 0.85,     name: "Punch-list" },
    { offset: 1,        name: "Final walk + close" },
  ];
  return stops.map((stop) => {
    const dt = new Date(s.getTime() + span * stop.offset * 86_400_000);
    const done = dt.getTime() < now.getTime();
    return {
      name: stop.name,
      date: fmtDate(dt.toISOString()),
      done,
    };
  }).map((m, i, arr) => {
    const prev = arr[i - 1];
    const isCurrent = !m.done && (!prev || prev.done);
    return isCurrent ? { ...m, current: true } : m;
  });
}

export default function ContractCard({ c, idx }: Props) {
  const [flipped, setFlipped] = useState(false);
  const milestones = buildMilestones(c);

  const styleStr =
    `--mood-from:${c.moodFrom};` +
    `--mood-to:${c.moodTo};` +
    `--mood-shadow:${c.moodShadow};` +
    `--mood-status:${c.statusColor};`;

  function onCardClick(e: MouseEvent) {
    if (flipped) return;
    const target = e.target as HTMLElement;
    if (target.closest(".kcard__cta") || target.closest(".kcard__back")) return;
    setFlipped(true);
  }

  return (
    <div
      class={`kcard ${flipped ? "kcard--flipped" : ""}`}
      style={styleStr}
      onClick={onCardClick}
    >
      <div class="kcard__mood">
        <span class="kcard__status">
          <span class="kcard__status-dot" />
          {c.status}
        </span>
        <span class="kcard__when">{c.when}</span>
        <span class="kcard__numeral">{String(idx + 1).padStart(2, "0")}</span>
      </div>

      <div class="kcard__av">{c.initials}</div>

      <div class="kcard__body">
        <div class="kcard__client-name">{c.client} · #{c.id.slice(0, 8)}</div>
        <h3 class="kcard__title">{c.title}</h3>
        <p class="kcard__story">{c.story}</p>

        <div class="kcard__prog">
          <div class="kcard__prog-row">
            <span class="kcard__prog-lbl">Progress</span>
            <span class="kcard__prog-pct">{c.pct}%</span>
          </div>
          <div class="kcard__prog-bar">
            <div class="kcard__prog-fill" style={`width:${c.pct}%`} />
          </div>
          <div class="kcard__prog-meta">
            <span>{c.paid} paid</span>
            <span>{c.left} left</span>
          </div>
        </div>
      </div>

      <div class="kcard__foot">
        <button class="kcard__cta" type="button" onClick={(e) => e.stopPropagation()}>
          {c.cta} <I d={ICN.arrow} size={11} sw={2.5} />
        </button>
        <div class="kcard__val-wrap">
          <div class="kcard__val-lbl">Contract</div>
          <div class="kcard__val-num">{c.total}</div>
        </div>
      </div>

      <div class="kcard__back" aria-hidden={!flipped} onClick={(e) => e.stopPropagation()}>
        <div class="kcard__back-head">
          <button
            class="kcard__back-close"
            type="button"
            onClick={(e) => { e.stopPropagation(); setFlipped(false); }}
            aria-label="Close"
          ><I d={ICN.x} size={14} sw={2.5} /></button>
          <div class="kcard__back-eyebrow">#{c.id.slice(0, 8)} · {c.client}</div>
          <h4 class="kcard__back-big">
            {c.title}
            <small>{c.total} · {c.when}</small>
          </h4>
        </div>
        <div class="kcard__back-body">
          {milestones.map((m, mi) => (
            <div
              key={mi}
              class={`kcard__mile ${m.done ? "kcard__mile--done" : ""} ${m.current ? "kcard__mile--current" : ""}`}
            >
              <span class="kcard__mile-check">
                {m.done && <I d={ICN.check} size={12} sw={3} />}
              </span>
              <span class="kcard__mile-name">{m.name}</span>
              <span class="kcard__mile-date">{m.date}</span>
            </div>
          ))}
        </div>
        <div class="kcard__back-foot">
          <button type="button" onClick={(e) => e.stopPropagation()}>
            <I d={ICN.invoice} size={13} /> Invoice
          </button>
          <button type="button" onClick={(e) => e.stopPropagation()}>
            <I d={ICN.send} size={13} /> Text client
          </button>
          <button type="button" onClick={(e) => e.stopPropagation()}>
            <I d={ICN.contract} size={13} /> View contract
          </button>
        </div>
      </div>
    </div>
  );
}
