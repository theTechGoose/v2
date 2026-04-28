# `QuoteCard` — Editorial pipeline card with engagement flip

> ✅ **Build in v1 (the centerpiece of the page).** Front face is straight rendering; the back face's open timeline needs the new `GET /quotes/:id/opens` endpoint. The `QSTORIES` editorial copy must be replaced with derived narrative.

## Purpose

A single editorial card per open quote. Same visual DNA as `<ClientCard>` from the Clients page — gradient mood band on top, oversize numeral in the corner, bleed-across avatar, body with a narrative story line, foot with CTA + value — but with three quote-specific differences:

1. **Mood gradient is driven by lifecycle stage**, not by relationship status. See `moodForQuote()` below.
2. **Big corner numeral is the rank within the track** (`01`, `02`…), not "days since contact." It's smaller-feeling because nothing pulses against it; it's just an editorial flourish.
3. **The card flips on click** to reveal an **opens timeline** (when, on what device) plus an interpretive "reading" line ("They're shopping — opened on multiple devices…"). Three action buttons sit at the bottom of the back face: Resend / Copy link / View as client.

The flip is per-card local state; multiple cards can be flipped simultaneously (unlike `<ClientCard>`, which uses a single-open coordinator). This is intentional — quote-card flips reveal data the contractor compares across cards.

## Source

- **JSX:** `Paperwork Monsters Quotes.html`
  - `moodForQuote(q)` — lines **5049–5061**
  - `OpenDots` — lines **5063–5069**
  - `buildOpens(q)` — lines **5073–5089** (mock-data fallback; production uses `GET /quotes/:id/opens`)
  - `readingFor(q, opens)` — lines **5091–5108**
  - `QuoteCard` — lines **5110–5211**
  - Stage-driven CTA copy table — lines **5114–5121**
  - `QSTORIES` editorial copy — lines **4961–4971**
  - `stageLabel`, `stageStatusFg` lookup tables — lines **4973–4984**
- **CSS:** Quotes.html lines **1888–2233** (`.qcards`, `.qcard*`, `.qcard__back*`, `.qcard__timeline*`, `.qcard__topen*`)

## Mood logic — `moodForQuote(q)` (verbatim)

```js
const moodForQuote = (q) => {
  const m = {
    draft:   { from:'#9C8074', to:'#5C4034', shadow:'rgba(92,64,52,0.32)',   statusFg:'#5C4034' },
    sent:    { from:'#FFB3B3', to:'#FF6B6B', shadow:'rgba(255,107,107,0.35)', statusFg:'#B23030' },
    opened:  { from:'#5FA34F', to:'#3F7A33', shadow:'rgba(81,152,67,0.35)',   statusFg:'#3F7A33' },
    cooling: { from:'#B89D90', to:'#785544', shadow:'rgba(120,85,68,0.35)',   statusFg:'#785544' },
    stale:   { from:'#FF6B6B', to:'#D63F3F', shadow:'rgba(214,63,63,0.4)',    statusFg:'#B23030' },
    opened_hot: { from:'#F7A893', to:'#E8704F', shadow:'rgba(232,112,79,0.4)', statusFg:'#A8431F' },
  };
  // Hot opened state when 3+ opens
  if (q.stage === 'opened' && q.opens >= 3) return m.opened_hot;
  return m[q.stage] || m.sent;
};
```

The `opened_hot` state is the only "synthetic" mood — no quote has stage `'opened_hot'` directly. It's derived in this helper and only used to swap the gradient + status pill colour when an opened quote has 3+ opens (the contractor needs the visual cue that this lead is *hot*).

## Stage-driven CTA copy

```js
const cta =
  q.stage === 'draft'                         ? 'Finish + send'    :
  q.stage === 'opened' && q.opens >= 3        ? 'Send the offer'   :
  q.stage === 'opened'                        ? 'Friendly nudge'   :
  q.stage === 'cooling'                       ? 'Trim & re-send'   :
  q.stage === 'stale'                         ? 'Win it back'      :
  q.stage === 'sent'                          ? 'Set a reminder'   :
                                                'Open quote';
```

CTAs match the agents-module's voice. The `Win it back` for stale quotes is a deliberate phrasing — "win" frames it as something to fight for, not a lost cause.

## Opens-timeline mock data

The prototype synthesises a deterministic timeline from `q.opens` count + `q.stage` (`buildOpens`, lines 5073–5089). The output is an array of `{ when, time, device }` records. **This is a mock-data fallback**; production must replace it with `GET /quotes/:id/opens` and render whatever the backend returns.

```js
const buildOpens = (q) => {
  if (q.opens === 0) return [];
  const seeds = [
    { when: 'Today',     time: '9:42am',   device: 'iPhone' },
    { when: 'Today',     time: '2:18pm',   device: 'Mac' },
    { when: 'Yesterday', time: '4:12pm',   device: 'iPhone' },
    { when: 'Tue',       time: '11:30am',  device: 'iPhone' },
    { when: 'Mon',       time: '7:54pm',   device: 'iPad' },
    { when: 'Sun',       time: '10:08am',  device: 'Mac' },
    { when: 'Sat',       time: '8:21pm',   device: 'iPhone' },
  ];
  const offset =
    q.stage === 'cooling' ? 2 :
    q.stage === 'stale'   ? 4 :
    q.stage === 'sent'    ? 0 : 0;
  return seeds.slice(offset, offset + Math.min(q.opens, 5));
};
```

## Reading-line logic — `readingFor(q, opens)`

This is the assistant's interpretation of the engagement pattern. Rule-based, not AI-generated in v1:

```js
const readingFor = (q, opens) => {
  if (q.stage === 'draft') return { line: <>Not sent yet — <em>finish writing</em>, then ship it.</> };
  if (opens.length === 0)  return { line: <>Sent, but no opens yet. Could be in spam, or they haven't checked email today.</> };
  const devices = new Set(opens.map(o => o.device));
  if (q.stage === 'opened' && q.opens >= 3 && devices.size >= 2)
    return { line: <>They're <em>shopping</em> — opened on multiple devices. Probably comparing. Time to send the offer.</> };
  if (q.stage === 'opened' && q.opens >= 3)
    return { line: <>Three opens means real interest. <em>Send the offer</em> while it's hot.</> };
  if (q.stage === 'opened')
    return { line: <>One peek and a pause. A <em>friendly nudge</em> usually breaks the silence.</> };
  if (q.stage === 'cooling')
    return { line: <>Opened a few times early, then went quiet. Worth a <em>scope trim</em> and a re-send.</> };
  if (q.stage === 'stale')
    return { line: <>Lots of attention, then gone cold. Last shot: <em>win it back</em> with a sharper offer.</> };
  if (q.stage === 'sent')
    return { line: <>Just landed in their inbox. <em>Give it 24 hours</em> before you tap on the door.</> };
  return { line: 'Quiet — try a nudge.' };
};
```

Keep this rule order; it's been tuned. The "shopping" reading (multi-device) is the highest-value signal — surface it first.

## JSX (verbatim — `QuoteCard`)

```jsx
const QuoteCard = ({ q, idx = 0 }) => {
  const [flipped, setFlipped] = useState(false);
  const mood = moodForQuote(q);
  const story = QSTORIES[q.id] || 'No notes yet — open the quote to leave one.';
  const cta = /* see CTA table above */;
  const showOpens = q.stage !== 'draft' && q.opens > 0;
  const opens = buildOpens(q);
  const reading = readingFor(q, opens);
  const handleCardClick = (e) => {
    if (flipped) return;
    if (e.target.closest('.qcard__cta, .qcard__flip-hint, .qcard__back')) return;
    setFlipped(true);
  };
  return (
    <article
      className={`qcard ${flipped ? 'qcard--flipped' : ''}`}
      onClick={handleCardClick}
      style={{
        '--mood-from': mood.from,
        '--mood-to': mood.to,
        '--mood-shadow': mood.shadow,
        '--mood-status': mood.statusFg,
      }}
    >
      <div className="qcard__mood">
        <div className="qcard__numeral">{String(idx+1).padStart(2,'0')}</div>
        <div className="qcard__status">
          <span className="qcard__status-dot"/>{stageLabel[q.stage]}
        </div>
        {showOpens && (
          <div className="qcard__opens">
            <OpenDots count={Math.min(q.opens, 5)}/> {q.opens}×
          </div>
        )}
      </div>
      <div className="qcard__av">{q.initials}</div>
      <div className="qcard__body">
        <div className="qcard__client-name">{q.client} · {q.id}</div>
        <h3 className="qcard__title">{q.title}</h3>
        <p className="qcard__story">{story}</p>
      </div>
      <div className="qcard__foot">
        <button className="qcard__cta" onClick={(e) => e.stopPropagation()}>
          {cta} <span style={{display:'inline-block', transition:'transform 240ms'}}>→</span>
        </button>
        <div className="qcard__val-wrap">
          <div className="qcard__val-lbl">Quote</div>
          <div className="qcard__val-num">${fmtMoney(q.value)}</div>
        </div>
      </div>

      {/* Back panel: opens timeline + engagement read + actions */}
      <div className="qcard__back" aria-hidden={!flipped}>
        <div className="qcard__back-head">
          <button className="qcard__back-close"
                  onClick={(e) => { e.stopPropagation(); setFlipped(false); }}
                  aria-label="Close">
            <I d={ICN.x} size={14} sw={2.5}/>
          </button>
          <div className="qcard__back-eyebrow">The open story</div>
          <p className="qcard__back-big">
            {q.opens}<small> {q.opens === 1 ? 'open' : 'opens'} · {q.client.split(/\s+/)[0]}</small>
          </p>
        </div>
        <div className="qcard__back-body">
          {opens.length > 0 ? (
            <div className="qcard__timeline">
              {opens.map((o, i) => (
                <div className="qcard__topen" key={i}>
                  <span className="qcard__topen-dot"/>
                  <div>
                    <div className="qcard__topen-when">
                      <strong>{o.when}</strong> · {o.time}
                    </div>
                  </div>
                  <div className="qcard__topen-dev">{o.device}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="qcard__topen-meta" style={{padding:'8px 0'}}>
              No opens recorded yet.
            </div>
          )}
          <p className="qcard__read">{reading.line}</p>
        </div>
        <div className="qcard__back-foot">
          <button onClick={(e) => e.stopPropagation()}>Resend</button>
          <button onClick={(e) => e.stopPropagation()}>Copy link</button>
          <button onClick={(e) => e.stopPropagation()}>View as client</button>
        </div>
      </div>
    </article>
  );
};
```

## CSS (key rules — abridged, see `Quotes.html` lines 1888–2233 for the full set)

```css
.qcards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.qcard {
  position: relative; background: #fff;
  border-radius: var(--radius-xl);
  overflow: visible;            /* important — avatar bleeds across boundary */
  cursor: pointer;
  box-shadow: 0 1px 0 rgba(26,83,92,0.04), 0 8px 22px -14px rgba(26,83,92,0.18);
  transition: transform 320ms var(--ease-bounce), box-shadow 320ms var(--ease-out);
  display: flex; flex-direction: column;
}
.qcard:hover {
  transform: translateY(-4px);
  box-shadow: 0 2px 0 rgba(26,83,92,0.05),
              0 22px 42px -18px var(--mood-shadow, rgba(26,83,92,0.28));
}

.qcard__mood {
  position: relative; height: 138px;
  background: linear-gradient(135deg, var(--mood-from) 0%, var(--mood-to) 100%);
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  overflow: hidden;
}
.qcard__mood::before {
  content: ''; position: absolute; inset: 0;
  background-image:
    radial-gradient(circle at 18% 22%, rgba(255,255,255,0.18) 0, transparent 35%),
    radial-gradient(circle at 82% 78%, rgba(0,0,0,0.10) 0, transparent 40%);
  pointer-events: none;
}

.qcard__numeral {
  position: absolute; bottom: -18px; right: -6px;
  font-family: var(--font-heading);
  font-weight: 900; font-size: 96px; line-height: 1;
  color: rgba(255,255,255,0.16);
  letter-spacing: -0.04em;
  pointer-events: none; user-select: none;
}

.qcard__status {
  position: absolute; top: 14px; left: 14px;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 10px; border-radius: var(--radius-pill);
  background: rgba(255,255,255,0.92);
  backdrop-filter: blur(4px);
  color: var(--mood-status, var(--brand-teal));
  font-family: var(--font-heading);
  font-size: 10px; font-weight: 800;
  letter-spacing: 0.08em; text-transform: uppercase;
  z-index: 2;
}
.qcard__status-dot {
  width: 6px; height: 6px; border-radius: 999px;
  background: currentColor;
  animation: pulse-dot 2.4s infinite;
}

/* Opens chip — top-right, where Clients had the crown */
.qcard__opens {
  position: absolute; top: 12px; right: 12px;
  display: inline-flex; align-items: center; gap: 5px;
  padding: 6px 10px;
  border-radius: var(--radius-pill);
  background: rgba(255,255,255,0.18);
  color: rgba(255,255,255,0.95);
  font-family: var(--font-heading);
  font-size: 10px; font-weight: 800;
  letter-spacing: 0.06em;
  backdrop-filter: blur(3px);
  z-index: 2;
}
/* NOTE: .qcard__opens-dots and .qcard__opens-dot are referenced from JSX
   but no CSS exists for them in the prototype — production should add styles.
   Suggested:
   .qcard__opens-dots { display: inline-flex; gap: 2px; }
   .qcard__opens-dot { width: 4px; height: 4px; border-radius: 999px;
                       background: rgba(255,255,255,0.3); }
   .qcard__opens-dot--on { background: rgba(255,255,255,0.95); } */

/* Bleed-across avatar — same construction as ClientCard */
.qcard__av {
  position: absolute; left: 22px; top: 92px;
  width: 86px; height: 86px;
  border-radius: 22px;
  background: linear-gradient(135deg, var(--mood-from) 0%, var(--mood-to) 100%);
  display: grid; place-items: center;
  color: #fff;
  font-family: var(--font-heading); font-weight: 800; font-size: 28px;
  z-index: 4;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.28),
              0 12px 24px -8px rgba(0,0,0,0.32);
}

.qcard__body { padding: 50px 22px 0; }
.qcard__client-name {
  font-family: var(--font-body);
  font-size: 12px; color: var(--fg-muted);
  margin: 0 0 4px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.qcard__title {
  font-family: var(--font-heading);
  font-weight: 800; font-size: 19px;
  color: var(--brand-teal);
  letter-spacing: -0.01em; line-height: 1.2;
  margin: 0 0 14px;
  overflow: hidden;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
.qcard__story {
  font-family: var(--font-body);
  font-size: 14.5px; line-height: 1.5;
  color: var(--brand-teal);
  text-wrap: pretty;
  margin: 0;
  display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical;
  overflow: hidden;
}

.qcard__foot {
  margin-top: 18px;
  padding: 14px 22px;
  border-top: 1px solid rgba(26,83,92,0.08);
  display: grid; grid-template-columns: 1fr auto;
  gap: 12px; align-items: center;
}
.qcard__cta {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 0; border: none; background: transparent;
  font-family: var(--font-heading); font-weight: 700; font-size: 12px;
  color: var(--brand-pink);
  cursor: pointer;
  transition: gap var(--dur-fast) var(--ease-out);
}
.qcard__cta:hover { gap: 9px; }

.qcard__val-wrap { text-align: right; }
.qcard__val-lbl  { font-family: var(--font-heading);
                   font-size: 9.5px; font-weight: 700;
                   letter-spacing: 0.08em; text-transform: uppercase;
                   color: var(--fg-muted); margin-bottom: 1px; }
.qcard__val-num  { font-family: var(--font-heading);
                   font-weight: 800; font-size: 15px;
                   letter-spacing: -0.01em;
                   color: var(--brand-teal); }

/* ---- Back panel (engagement story) ---- */
.qcard__back {
  position: absolute; inset: 0;
  background: #fff;
  border-radius: var(--radius-xl);
  z-index: 10;
  display: flex; flex-direction: column;
  overflow: hidden;
  transform: translateY(8px) scale(0.98);
  opacity: 0; pointer-events: none;
  transition: transform 380ms var(--ease-bounce), opacity 240ms var(--ease-out);
  box-shadow: 0 22px 50px -22px var(--mood-shadow, rgba(26,83,92,0.4));
}
.qcard--flipped .qcard__back {
  transform: translateY(0) scale(1);
  opacity: 1; pointer-events: auto;
}

.qcard__back-head {
  background: linear-gradient(135deg, var(--mood-from) 0%, var(--mood-to) 100%);
  color: #fff;
  padding: 18px 22px 16px;
  position: relative; overflow: hidden;
}
/* …back-head paper-grain ::before, eyebrow, big number, close button at lines 1938–1976 */

.qcard__timeline { display: flex; flex-direction: column; position: relative; }
.qcard__timeline::before {
  content: '';
  position: absolute;
  left: 6px; top: 6px; bottom: 6px;
  width: 1px;
  background: linear-gradient(to bottom, var(--mood-from), var(--mood-to));
  opacity: 0.3;
}
.qcard__topen {
  display: grid;
  grid-template-columns: 14px 1fr auto;
  gap: 10px; align-items: center;
  padding: 7px 0;
}
.qcard__topen-dot {
  width: 13px; height: 13px;
  border-radius: 999px;
  background: linear-gradient(135deg, var(--mood-from) 0%, var(--mood-to) 100%);
  box-shadow: 0 0 0 3px #fff, 0 0 0 4px rgba(0,0,0,0.06);
  z-index: 1;
}
.qcard__topen-when { font-family: var(--font-heading);
                     font-weight: 700; font-size: 13px;
                     color: var(--brand-teal); }
.qcard__topen-dev  { font-size: 11px; color: var(--fg-muted); text-align: right; }

.qcard__read {
  font-family: var(--font-body);
  font-size: 14px; line-height: 1.5;
  color: var(--brand-teal);
  background: linear-gradient(180deg, rgba(255,107,107,0.06) 0%, rgba(255,107,107,0.02) 100%);
  border-left: 3px solid var(--brand-pink);
  border-radius: 0 10px 10px 0;
  padding: 12px 14px;
  text-wrap: pretty;
  margin: 4px 0 0;
}
.qcard__read em {
  font-style: normal;
  color: var(--brand-pink);
  font-weight: 700;
}

.qcard__back-foot {
  display: grid; grid-template-columns: 1fr 1fr 1fr;
  gap: 6px;
  padding: 12px 14px;
  border-top: 1px solid rgba(26,83,92,0.08);
  background: rgba(26,83,92,0.02);
}
.qcard__back-foot button {
  background: #fff;
  border: 1px solid rgba(26,83,92,0.12);
  border-radius: 10px;
  padding: 9px 6px;
  font-family: var(--font-heading); font-weight: 700; font-size: 11px;
  color: var(--brand-teal);
  cursor: pointer;
  transition: border-color var(--dur-fast), color var(--dur-fast), transform var(--dur-fast);
}
.qcard__back-foot button:hover {
  border-color: var(--brand-pink);
  color: var(--brand-pink);
  transform: translateY(-1px);
}
```

## Preact / Fresh translation

```tsx
// v2/frontend/islands/quotes/QuoteCard.tsx — ISLAND
// Holds flip state. The opens timeline data is passed in as a prop (parent fetches).
import { useState } from "preact/hooks";
import * as I from "../../components/ui/icons.tsx";
import { fmtMoney } from "../../lib/format.ts";
import { moodForQuote, type Mood } from "./mood.ts";
import { stageCtaLabel, stageLabel } from "./stage.ts";
import { OpenDots } from "./OpenDots.tsx";
import { readingFor } from "./reading.tsx";

export type Stage = 'draft' | 'sent' | 'opened' | 'cooling' | 'stale' | 'won' | 'lost';

export type Open = { at: string; device: 'iPhone' | 'iPad' | 'Mac' | 'PC' | 'Android' | 'unknown' };

export type Quote = {
  id:           string;        // "Q-1107"
  title:        string;        // "Garage epoxy floor — 2-car"
  client:       string;        // "Tom & Linda Kowalski"
  clientId:     string;
  initials:     string;        // "TK"
  stage:        Stage;
  value:        number;        // dollars (or cents — pick one consistently project-wide)
  daysIn:       number;
  opens:        number;        // total open count
  sentDays:     number | null;
  decidedDays?: number;        // only for won/lost
  story:        string;        // narrative, AI-generated; falls back to a deterministic caption
};

export function QuoteCard(props: {
  q: Quote;
  idx: number;
  opens: Open[];               // pre-fetched timeline events; empty array is fine
}) {
  const [flipped, setFlipped] = useState(false);
  const { q, idx, opens } = props;
  const mood = moodForQuote(q);
  const cta = stageCtaLabel(q);
  const showOpens = q.stage !== 'draft' && q.opens > 0;
  const reading = readingFor(q, opens);

  const handleCardClick = (e: MouseEvent) => {
    if (flipped) return;
    const tgt = e.target as Element;
    if (tgt.closest('.qcard__cta, .qcard__flip-hint, .qcard__back')) return;
    setFlipped(true);
  };

  return (
    <article
      class={`qcard ${flipped ? 'qcard--flipped' : ''}`}
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      aria-expanded={flipped}
      aria-label={`${q.title} for ${q.client} — ${stageLabel[q.stage]}, $${fmtMoney(q.value)}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (!flipped) setFlipped(true);
        }
        if (e.key === 'Escape' && flipped) setFlipped(false);
      }}
      style={{
        '--mood-from':   mood.from,
        '--mood-to':     mood.to,
        '--mood-shadow': mood.shadow,
        '--mood-status': mood.statusFg,
      } as preact.JSX.CSSProperties}
    >
      <div class="qcard__mood">
        <div class="qcard__numeral" aria-hidden="true">
          {String(idx + 1).padStart(2, '0')}
        </div>
        <div class="qcard__status">
          <span class="qcard__status-dot" /> {stageLabel[q.stage]}
        </div>
        {showOpens && (
          <div class="qcard__opens">
            <OpenDots count={Math.min(q.opens, 5)} /> {q.opens}×
          </div>
        )}
      </div>

      <div class="qcard__av" aria-hidden="true">{q.initials}</div>

      <div class="qcard__body">
        <div class="qcard__client-name">{q.client} · {q.id}</div>
        <h3 class="qcard__title">{q.title}</h3>
        <p class="qcard__story">{q.story}</p>
      </div>

      <div class="qcard__foot">
        <a class="qcard__cta"
           href={`/quotes/${q.id}/${ctaSlug(q)}`}
           onClick={(e) => e.stopPropagation()}>
          {cta} <span aria-hidden="true">→</span>
        </a>
        <div class="qcard__val-wrap">
          <div class="qcard__val-lbl">Quote</div>
          <div class="qcard__val-num">${fmtMoney(q.value)}</div>
        </div>
      </div>

      {/* Back: engagement timeline + reading + actions */}
      <div class="qcard__back" aria-hidden={!flipped}>
        <div class="qcard__back-head">
          <button class="qcard__back-close"
                  onClick={(e) => { e.stopPropagation(); setFlipped(false); }}
                  aria-label="Close">
            <I.X size={14} sw={2.5} />
          </button>
          <div class="qcard__back-eyebrow">The open story</div>
          <p class="qcard__back-big">
            {q.opens}
            <small> {q.opens === 1 ? 'open' : 'opens'} · {q.client.split(/\s+/)[0]}</small>
          </p>
        </div>
        <div class="qcard__back-body">
          {opens.length > 0 ? (
            <ol class="qcard__timeline">
              {opens.map((o, i) => (
                <li class="qcard__topen" key={i}>
                  <span class="qcard__topen-dot" aria-hidden="true" />
                  <div class="qcard__topen-when">
                    <strong>{relativeDay(o.at)}</strong> · {timeOfDay(o.at)}
                  </div>
                  <div class="qcard__topen-dev">{o.device}</div>
                </li>
              ))}
            </ol>
          ) : (
            <div class="qcard__topen-meta" style={{ padding: '8px 0' }}>
              No opens recorded yet.
            </div>
          )}
          <p class="qcard__read">{reading.line}</p>
        </div>
        <div class="qcard__back-foot">
          <button type="button" onClick={(e) => { e.stopPropagation(); /* resend */ }}>Resend</button>
          <button type="button" onClick={(e) => { e.stopPropagation(); /* copy share link */ }}>Copy link</button>
          <a href={`/quotes/${q.id}/preview`} onClick={(e) => e.stopPropagation()}>View as client</a>
        </div>
      </div>
    </article>
  );
}
```

`relativeDay()` and `timeOfDay()` are tiny helpers: `'Today' | 'Yesterday' | 'Mon' | 'Apr 14'` for the day part, `'9:42am'` for the time.

The Resend / Copy link / View as client actions in the prototype are bare `<button>`s with no handlers — production needs:

| Action | Effect |
|---|---|
| Resend | `POST /quotes/:id/resend` — sends the same quote email to the client (ratelimited server-side to once per 12h) |
| Copy link | `navigator.clipboard.writeText(quoteShareUrl)` — toast "Link copied" |
| View as client | nav to `/quotes/:id/preview` (a route that renders the quote in the same chrome the client sees) |

## Props

```ts
type Stage = 'draft' | 'sent' | 'opened' | 'cooling' | 'stale' | 'won' | 'lost';
type Open  = { at: string; device: 'iPhone' | 'iPad' | 'Mac' | 'PC' | 'Android' | 'unknown' };
type Quote = { /* see TS above */ };

type QuoteCardProps = {
  q:     Quote;
  idx:   number;
  opens: Open[];      // pre-fetched on mount or at SSR; empty array is valid
};
```

## Data source

**v1:**
- `Quote` fields come from `GET /quotes` extended with the derived `stage`, `daysIn`, `opens`, `sentDays`, `decidedDays`, and `story` fields described in `root.md`.
- `opens: Open[]` for the timeline comes from `GET /quotes/:id/opens`. Fetch lazily on flip (don't load all timelines upfront — the page has 8+ cards and most contractors will only flip a few). When the flip happens, render the timeline placeholder ("Loading…") for ≤200 ms; if data arrives faster, no flicker.

**Story field — production strategy:**

The prototype's `QSTORIES` is editorial mock copy. Replace with one of these, in preference order:

1. **Agents-module narrative** (preferred): the same module that generates the assistant chat writes per-quote summaries. One sentence in the monsters' voice, regenerated when the quote's state changes meaningfully.
2. **Deterministic captions** (fallback): rules-based, keyed on stage + opens + days. Examples:

```
draft, daysIn === 0      → "Just started — finish it tonight while the conversation is fresh."
draft, daysIn >= 2       → "Sitting at draft for {daysIn} days. Send it before the request goes cold."
sent                     → "Just landed in their inbox. Give it 24 hours."
opened, opens === 1      → "One peek and a pause. Worth a friendly nudge tomorrow."
opened, opens >= 3       → "Three opens means real interest. Send the offer."
opened, opens >= 3, multi-device → "Opened on multiple devices — they're shopping. Send the offer."
cooling                  → "Opened a few times, then went quiet. Trim the scope and re-send."
stale                    → "{daysIn} days quiet. Last shot — sharper offer or a graceful close."
```

Don't ship `QSTORIES` past prototype.

**`buildOpens` and `readingFor` helpers** — `buildOpens` is mock-data only and gets deleted in production. `readingFor` stays — it's a real interpretation function and runs against whatever the API returns.

## Island vs server

**Island.** The flip is local state. Each card hydrates as its own root.

The card's HTML renders fully at SSR with `class="qcard"` (not `qcard--flipped`); the back panel is in the DOM but hidden via the CSS transform. On hydration, the click handler attaches; clicking adds `qcard--flipped`. This means:

- The card looks correct (front face) before JS loads
- Crawlers and SR users in no-JS contexts see the front face
- The opens timeline only fetches on flip (lazy)

## Accessibility

- The card root is a clickable `<article>`. Add `role="button"`, `tabIndex={0}`, `aria-expanded={flipped}`, and an `aria-label` that includes the quote title + client + stage + value.
- Keyboard: Enter / Space flips; Esc unflips. The `<button>` close on the back face uses native button semantics.
- The back face's `aria-hidden={!flipped}` keeps SRs from announcing the timeline before the user opens it. When flipped, focus moves to the close button (use `useEffect` + a ref to focus on `.qcard__back-close`).
- Trap focus inside the back panel while it's open — Tab cycles through close + timeline (if interactive) + Resend + Copy link + View as client. The prototype doesn't trap; production should.
- The `pulse-dot` keyframe on `.qcard__status-dot` honours `prefers-reduced-motion: reduce`.
- The big corner numeral (`.qcard__numeral`) is decorative — `aria-hidden="true"`. The card's identity is the title + client + stage, not the rank.
- The 3+ opens "hot" colour swap (coral) is a meaningful state change. The status pill text still reads "Opened" — for SR clarity, append " · hot" when `opens >= 3`: e.g. `aria-label="Opened, 3 opens"`.
- The bleed-across avatar uses pure colour gradient + initials; no text purpose. `aria-hidden="true"`.

## Edge cases

- **`q.opens === 0` and `stage === 'sent'`:** the opens chip is hidden (`showOpens = false`). The back face's "{0} opens · {firstWord}" reads correctly; the timeline section shows the "No opens recorded yet" placeholder.
- **`q.opens > 5`:** dots cap at 5; the trailing count `{q.opens}×` shows the real number. Timeline list shows the most recent 5 events server-side; flag any beyond that with a "+N earlier opens" link at the bottom (production; not in prototype).
- **Long title (`q.title` > 50 chars):** clamped to 2 lines via `-webkit-line-clamp: 2`.
- **Long story:** clamped to 4 lines.
- **`stage === 'won'` or `'lost'`:** these don't appear in the cards grid — they render as `<DecidedRow>` instead. If a `<QuoteCard>` is mistakenly handed a won/lost quote, the CTA falls through to "Open quote" and the mood gradient defaults to `m.sent` (pink). Production should assert the stage at the call site.
- **No story copy at all:** falls back to "No notes yet — open the quote to leave one." (the prototype's default). Keep this exact copy.
- **Card open during nav (route change):** flipped state is local, so a page nav resets it. Don't try to persist flip state across navigation.
- **Two cards flipped, contractor compares:** allowed and intentional. Don't add a single-flip coordinator.
- **Reduced motion:** disable the lift transform on hover, the back panel slide-up (snap to position instead), and the status-dot pulse. The back-foot button hover lift is also fine to drop.
