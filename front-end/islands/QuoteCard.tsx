/**
 * Pipeline quote card with flip-to-back engagement timeline.
 * Mirrors the prototype's QuoteCard component verbatim.
 */
import { useState } from "preact/hooks";
import { I, ICN } from "../lib/dash-icons.tsx";
import { fmtMoney } from "../lib/format.ts";
import {
  buildOpens,
  moodForQuote,
  type Quote,
  QSTORIES,
  readingFor,
  stageLabel,
} from "../lib/quotes-seed.ts";

interface Props { q: Quote; idx: number }

function OpenDots({ count, max = 5 }: { count: number; max?: number }) {
  return (
    <span class="qcard__opens-dots">
      {Array.from({ length: max }).map((_, i) => (
        <span key={i} class={`qcard__opens-dot ${i < count ? "qcard__opens-dot--on" : ""}`} />
      ))}
    </span>
  );
}

export default function QuoteCard({ q, idx }: Props) {
  const [flipped, setFlipped] = useState(false);
  const mood = moodForQuote(q);
  const story = QSTORIES[q.id] ?? "No notes yet — open the quote to leave one.";
  const cta =
    q.stage === "draft" ? "Finish + send" :
    q.stage === "opened" && q.opens >= 3 ? "Send the offer" :
    q.stage === "opened" ? "Friendly nudge" :
    q.stage === "cooling" ? "Trim & re-send" :
    q.stage === "stale" ? "Win it back" :
    q.stage === "sent" ? "Set a reminder" :
    "Open quote";
  const showOpens = q.stage !== "draft" && q.opens > 0;
  const opens = buildOpens(q);
  const reading = readingFor(q, opens);

  function onCardClick(e: MouseEvent) {
    if (flipped) return;
    const target = e.target as HTMLElement;
    if (target.closest(".qcard__cta") || target.closest(".qcard__flip-hint") || target.closest(".qcard__back")) return;
    setFlipped(true);
  }

  const styleStr =
    `--mood-from:${mood.from};` +
    `--mood-to:${mood.to};` +
    `--mood-shadow:${mood.shadow};` +
    `--mood-status:${mood.statusFg};`;

  return (
    <article
      class={`qcard ${flipped ? "qcard--flipped" : ""}`}
      style={styleStr}
      onClick={onCardClick}
    >
      <div class="qcard__mood">
        <div class="qcard__numeral">{String(idx + 1).padStart(2, "0")}</div>
        <div class="qcard__status">
          <span class="qcard__status-dot" />{stageLabel[q.stage]}
        </div>
        {showOpens && (
          <div class="qcard__opens">
            <OpenDots count={Math.min(q.opens, 5)} /> {q.opens}×
          </div>
        )}
      </div>
      <div class="qcard__av">{q.initials}</div>
      <div class="qcard__body">
        <div class="qcard__client-name">{q.client} · {q.id}</div>
        <h3 class="qcard__title">{q.title}</h3>
        <p class="qcard__story">{story}</p>
      </div>
      <div class="qcard__foot">
        <button class="qcard__cta" type="button" onClick={(e) => e.stopPropagation()}>
          {cta} <span style="display:inline-block;transition:transform 240ms">→</span>
        </button>
        <div class="qcard__val-wrap">
          <div class="qcard__val-lbl">Quote</div>
          <div class="qcard__val-num">${fmtMoney(q.value)}</div>
        </div>
      </div>

      <div class="qcard__back" aria-hidden={!flipped}>
        <div class="qcard__back-head">
          <button
            class="qcard__back-close"
            type="button"
            onClick={(e) => { e.stopPropagation(); setFlipped(false); }}
            aria-label="Close"
          ><I d={ICN.x} size={14} sw={2.5} /></button>
          <div class="qcard__back-eyebrow">The open story</div>
          <p class="qcard__back-big">
            {q.opens}<small> {q.opens === 1 ? "open" : "opens"} · {q.client.split(/\s+/)[0]}</small>
          </p>
        </div>
        <div class="qcard__back-body">
          {opens.length > 0 ? (
            <div class="qcard__timeline">
              {opens.map((o, i) => (
                <div class="qcard__topen" key={i}>
                  <span class="qcard__topen-dot" />
                  <div>
                    <div class="qcard__topen-when">
                      <strong>{o.when}</strong> · {o.time}
                    </div>
                  </div>
                  <div class="qcard__topen-dev">{o.device}</div>
                </div>
              ))}
            </div>
          ) : (
            <div class="qcard__topen-meta" style="padding:8px 0">
              No opens recorded yet.
            </div>
          )}
          <p class="qcard__read">
            {reading.text}
            {reading.em ? <em>{reading.em}</em> : null}
            {reading.tail ?? null}
          </p>
        </div>
        <div class="qcard__back-foot">
          <button type="button" onClick={(e) => e.stopPropagation()}>Resend</button>
          <button type="button" onClick={(e) => e.stopPropagation()}>Copy link</button>
          <button type="button" onClick={(e) => e.stopPropagation()}>View as client</button>
        </div>
      </div>
    </article>
  );
}
