# `ChatScroll` — Main chat viewport (and `DocPane`, `ChatHeader`, `ContinueCTA`)

> ⚠️ **DEFERRED — depends on agents module.** The viewport renders messages from `GET /agents/conversations/:id`. For v1 it can render a static seed.

## Purpose

The scrollable middle of the chat panel. Hosts every message type (voice memos, text bubbles, action cards, wizard, continue-CTA) in chronological order, plus phase-divider rows and `chat__day` timestamp markers. Renders the `<DealBar />` at the top, sticky.

This file also covers two adjacent components: **`<ChatHeader />`** (above the scroll) and the **`<ContinueCTA />`** message variant (a special card the assistant uses to advance phases). And it documents the **`<DocPane />`** — a 3-tab right-side pane (Quote / Client / Log) that mirrors the active document. v1 implements DocPane as a static read-only view of `GET /quotes/:id`.

## Source

- ChatScroll JSX: `Paperwork Monsters Assistant.html` lines **4301–4524**
- ChatHeader JSX: lines **4247–4267**
- DocPane JSX: lines **4591–4704**
- Inline CSS: `.chat__head/scroll/day`, `.continue-cta*`, `.docpane*`, `.docket*`, `.doc*`

## ChatHeader (verbatim)

```jsx
const ChatHeader = () => (
  <div className="chat__head">
    <a href="Paperwork Monsters Dashboard.html" className="chat__head-btn"
       title="Back to dashboard" style={{textDecoration:'none'}}>
      <I d={ICN.back} size={15}/>
    </a>
    <div className="chat__avatar">
      <img src={window.LOGO_DATA_URL} alt=""/>
    </div>
    <div className="chat__head-info">
      <div className="chat__head-title">Tom &amp; Linda K. · Garage epoxy</div>
      <div className="chat__head-sub">
        <span className="chat__head-dot"/>
        Quote locked · finishing terms with Bossie
      </div>
    </div>
    <div className="chat__head-tools">
      <button className="chat__head-btn" title="Share thread"><I d={ICN.send} size={15}/></button>
      <button className="chat__head-btn" title="More"><I d={ICN.more} size={15}/></button>
    </div>
  </div>
);
```

## ChatScroll structure (excerpt — full JSX is 220+ lines)

```jsx
const ChatScroll = () => (
  <div className="chat__scroll">
    <DealBar/>
    <div className="chat__day">Today · 8:42 AM · Phase 1 — Chat</div>

    {/* User: voice memo */}
    <div className="msg msg--user">
      <div className="msg__avatar">DR</div>
      <div>
        <Voice duration="0:23" played={0.55}/>
        <div className="msg__time">8:42 AM · transcribed</div>
      </div>
    </div>

    {/* Assistant: text bubble with structured content */}
    <div className="msg">
      <div className="msg__avatar"><img src={window.LOGO_DATA_URL} alt=""/></div>
      <div>
        <div className="msg__bubble">
          Got it — <strong>Tom &amp; Linda K.</strong>, 2-car garage epoxy floor.
          Heard you say "<em>standard prep, gray base with flakes, two-car about 480 sqft</em>."
          <br/><br/>
          Couple quick checks before I draft:
          <ul style={{margin:'8px 0 0', paddingLeft:18, lineHeight:1.6}}>
            <li>Concrete grinding included or just etch?</li>
            <li>Polyurea topcoat or polyaspartic?</li>
          </ul>
        </div>
        <div className="msg__time">8:42 AM</div>
      </div>
    </div>

    {/* User: text + photo grid */}
    <div className="msg msg--user">
      <div className="msg__avatar">DR</div>
      <div>
        <div className="msg__bubble">
          Grind. Polyaspartic. Here's the floor — couple oil stains in the back corner, factor that in.
          <div className="msg__photos">
            <div className="msg__photo msg__photo--1"><I d={ICN.img} size={20}/></div>
            <div className="msg__photo msg__photo--2"><I d={ICN.img} size={20}/></div>
            <div className="msg__photo msg__photo--3"><I d={ICN.img} size={20}/></div>
          </div>
        </div>
        <div className="msg__time">8:43 AM</div>
      </div>
    </div>

    {/* Assistant: text + ActionCard (quote drafted) */}
    <div className="msg">
      <div className="msg__avatar"><img src={window.LOGO_DATA_URL} alt=""/></div>
      <div style={{flex:1, minWidth:0}}>
        <div className="msg__bubble">On it. Pulled your "Garage Epoxy — Premium" template…</div>
        <div className="action-card">…</div>
        <div className="msg__time">8:43 AM · 47 sec to draft</div>
      </div>
    </div>

    {/* User: short reply */}
    <div className="msg msg--user">
      <div className="msg__avatar">DR</div>
      <div>
        <div className="msg__bubble">Looks good. Lock it in.</div>
        <div className="msg__time">8:44 AM</div>
      </div>
    </div>

    {/* Assistant: ContinueCTA prompt */}
    <div className="msg">
      <div className="msg__avatar"><img src={window.LOGO_DATA_URL} alt=""/></div>
      <div style={{flex:1, minWidth:0}}>
        <div className="msg__bubble">Locked at <strong>$3,400</strong>. Want to wrap the contract terms now?</div>
        <div className="continue-cta">
          <div className="continue-cta__icon"><I d={ICN.contract} size={18}/></div>
          <div className="continue-cta__txt">
            <div className="continue-cta__title">Continue to terms</div>
            <div className="continue-cta__sub">Payment, warranty, dispute, governing state — 7 quick questions</div>
          </div>
          <button className="continue-cta__btn">Start <I d={ICN.arrow} size={11} sw={2.5}/></button>
        </div>
        <div className="msg__time">8:44 AM</div>
      </div>
    </div>

    {/* Phase divider */}
    <div className="phase-divider">
      <div className="phase-divider__line"/>
      <div className="phase-divider__label">
        <I d={ICN.contract} size={11}/> Phase 2 — Contract terms
      </div>
      <div className="phase-divider__line"/>
    </div>

    {/* Assistant: Wizard message */}
    <div className="msg">
      <div className="msg__avatar"><img src={window.LOGO_DATA_URL} alt=""/></div>
      <div style={{flex:1, minWidth:0}}>
        <div className="wiz">…multi-step inline form…</div>
        <div className="msg__time">8:45 AM</div>
      </div>
    </div>

  </div>
);
```

## CSS (key rules — read inline `<style>` for canonical version)

```css
.chat__head {
  display: grid; grid-template-columns: auto auto 1fr auto;
  gap: 12px; align-items: center;
  padding: 12px 18px;
  background: #fff;
  border-bottom: 1px solid var(--border);
}
.chat__avatar         { width: 36px; height: 36px; border-radius: 11px;
                        background: var(--brand-green); overflow: hidden;
                        display: flex; align-items: center; justify-content: center; }
.chat__avatar img     { width: 26px; height: 26px; }
.chat__head-title     { font-family: var(--font-heading); font-weight: 800;
                        font-size: 14px; color: var(--brand-teal); }
.chat__head-sub       { display: flex; align-items: center; gap: 6px;
                        font-size: 11px; color: var(--fg-muted); margin-top: 1px; }
.chat__head-dot       { width: 6px; height: 6px; border-radius: 999px;
                        background: var(--brand-green);
                        box-shadow: 0 0 0 4px rgba(81,152,67,0.16); }
.chat__head-btn       { width: 32px; height: 32px; border-radius: 8px;
                        background: var(--mint-200); border: 0; cursor: pointer;
                        display: flex; align-items: center; justify-content: center;
                        color: var(--brand-teal); }
.chat__head-tools     { display: flex; gap: 6px; }

.chat__scroll {
  flex: 1; overflow-y: auto;
  padding: 16px 24px;
  background: var(--bg);
  display: flex; flex-direction: column; gap: 14px;
}
.chat__day {
  align-self: center;
  font-family: var(--font-heading); font-weight: 700; font-size: 11px;
  color: var(--fg-subtle); letter-spacing: 0.04em; text-transform: uppercase;
  background: transparent;
  padding: 4px 0;
}

/* continue-cta — see continue-cta__title/sub/icon/btn classes; pink-bordered card */
.continue-cta {
  display: grid; grid-template-columns: auto 1fr auto;
  gap: 12px; align-items: center;
  background: linear-gradient(135deg, var(--pink-50) 0%, #fff 100%);
  border: 1.5px solid var(--brand-pink);
  border-radius: 14px;
  padding: 14px;
  margin-top: 8px;
}
.continue-cta__icon  { width: 36px; height: 36px; border-radius: 10px;
                       background: var(--brand-pink); color: #fff;
                       display: flex; align-items: center; justify-content: center; }
.continue-cta__title { font-family: var(--font-heading); font-weight: 800;
                       font-size: 13px; color: var(--brand-teal); }
.continue-cta__sub   { font-size: 11px; color: var(--fg-muted); margin-top: 1px; }
.continue-cta__btn {
  background: var(--brand-pink); color: #fff;
  border: 0; border-radius: 10px;
  padding: 8px 14px;
  font-family: var(--font-heading); font-weight: 800; font-size: 12px;
  cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
  box-shadow: 0 6px 14px rgba(255,107,107,0.32);
}
```

## Preact / Fresh translation

```tsx
// v2/frontend/islands/ChatScroll.tsx — island (auto-scroll + interactive children)
import { useEffect, useRef } from "preact/hooks";
import { DealBar }        from "../components/assistant/DealBar.tsx";
import { PhaseDivider }   from "../components/assistant/PhaseDivider.tsx";
import { MessageBubble }  from "../components/assistant/MessageBubble.tsx";
import { Voice }          from "./Voice.tsx";
import { ActionCard }     from "../components/assistant/ActionCard.tsx";
import { Wizard }         from "./Wizard.tsx";
import { ContinueCTA }    from "../components/assistant/ContinueCTA.tsx";

type Msg =
  | { type: 'voice',     side: 'user'|'assistant', durationSec: number, transcript?: string, time: string }
  | { type: 'text',      side: 'user'|'assistant', html: string, photos?: string[],          time: string }
  | { type: 'action',    side: 'assistant',        kind: 'quote'|'contract'|'invoice', payload: unknown, time: string }
  | { type: 'wizard',    side: 'assistant',        wizardId: string, time: string }
  | { type: 'continue',  side: 'assistant',        toPhase: 2|3, summary: string, time: string }
  | { type: 'phase',     phase: 1|2|3, label: string }
  | { type: 'day',       text: string };

export function ChatScroll(props: { messages: Msg[]; deal?: { clientName: string; totalCents: number; currentPhase: 1|2|3 } }) {
  const ref = useRef<HTMLDivElement>(null);
  // Auto-scroll to bottom on new message
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' });
  }, [props.messages.length]);

  return (
    <div ref={ref} class="chat__scroll">
      {props.deal && <DealBar {...props.deal} />}
      {props.messages.map((m, i) => {
        switch (m.type) {
          case 'day':      return <div class="chat__day" key={i}>{m.text}</div>;
          case 'phase':    return <PhaseDivider key={i} phase={m.phase} label={m.label} />;
          case 'voice':    return <MessageBubble key={i} side={m.side} time={m.time} avatar="DR"><Voice duration={fmt(m.durationSec)} played={0.6} /></MessageBubble>;
          case 'text':     return <MessageBubble key={i} side={m.side} time={m.time} avatar={m.side === 'user' ? 'DR' : 'PM'} html={m.html} photos={m.photos} />;
          case 'action':   return <MessageBubble key={i} side="assistant" time={m.time} avatar="PM"><ActionCard kind={m.kind} payload={m.payload} /></MessageBubble>;
          case 'wizard':   return <MessageBubble key={i} side="assistant" time={m.time} avatar="PM"><Wizard wizardId={m.wizardId} /></MessageBubble>;
          case 'continue': return <MessageBubble key={i} side="assistant" time={m.time} avatar="PM"><ContinueCTA toPhase={m.toPhase} summary={m.summary} /></MessageBubble>;
        }
      })}
    </div>
  );
}
```

`MessageBubble` is the bubble + avatar + time scaffold (see `message-bubble.md`); each child message renders its own content inside.

## DocPane — separate component, optional right pane

```jsx
const DocPane = () => {
  const [tab, setTab] = useState('quote');
  return (
    <aside className="docpane">
      <div className="docpane__tabs">
        <button className={`docpane__tab ${tab==='quote'   ? 'docpane__tab--active':''}`}
                onClick={() => setTab('quote')}>
          <I d={ICN.quote} size={14}/> Quote <span className="docpane__tab-count">DRAFT</span>
        </button>
        <button className={`docpane__tab ${tab==='context' ? 'docpane__tab--active':''}`}
                onClick={() => setTab('context')}>
          <I d={ICN.user} size={14}/> Client
        </button>
        <button className={`docpane__tab ${tab==='log'     ? 'docpane__tab--active':''}`}
                onClick={() => setTab('log')}>
          <I d={ICN.clock} size={14}/> Log
        </button>
      </div>
      <div className="docpane__body">
        {/* "Bossie's docket" stats strip */}
        <div className="docket">…3 quotes drafted · 7 nudges sent · 2 invoices · $8.4k out the door…</div>
        {/* Live read-only quote preview */}
        <div className="doc">
          <div className="doc__head">…Quote · Q-2026-041 · 2-Car Garage Epoxy Floor…</div>
          <div className="doc__lines">…line items + amounts…</div>
          <div className="doc__totals">…Subtotal / Tax / Total…</div>
        </div>
      </div>
      <div className="docpane__cta">
        <button className="docpane__cta-btn"><I d={ICN.eye}  size={13}/> Preview</button>
        <button className="docpane__cta-btn docpane__cta-btn--primary">
          <I d={ICN.send} size={13}/> Send to client
        </button>
      </div>
    </aside>
  );
};
```

**v1 build of DocPane:** static, fetches `GET /quotes/:id` once at page load and renders read-only. The "Bossie's docket" stats can come from `GET /analytics/dashboard` (reuse the dashboard endpoint) — derive `quotes drafted today` from `quotes.draft + quotes.sent` filtered by `createdAt > today`. The `Send to client` button calls `POST /quotes/:id/email` (existing future endpoint, see `backend.md` §3.F).

## Props

```ts
type ChatScrollProps = {
  messages: Msg[];
  deal?:    { clientName: string; totalCents: number; currentPhase: 1|2|3 };
};
```

## Data source

- Messages: `GET /agents/conversations/:id` (FUTURE — `backend.md` §4)
- Deal metadata: derived server-side from the conversation's linked `quoteId`
- Active document for DocPane: `GET /quotes/:id` (existing v2 endpoint)

For v1, ship a hardcoded `messages` seed pulled from the prototype.

## Island vs server

- `ChatScroll` itself: **island** (auto-scroll, `useEffect`).
- `ChatHeader`: **server** (no JS).
- `DocPane`: **island** for v1 (tab state); could degrade to server-only with `<details>` for tabs if we want zero JS.

## Accessibility

- `chat__scroll` should be `role="log"` + `aria-live="polite"` so SR users get new messages announced.
- Pause the live region during voice playback so the SR doesn't try to read the transcript over the audio.
- `<button>` for the back button in ChatHeader needs `aria-label="Back to dashboard"`.
- `chat__head-dot` is a status indicator — wrap in `<span class="sr-only">Connected</span>`.

## Edge cases

- **Empty conversation:** show an empty state inside `chat__scroll` with a "Tap the mic, or type below" prompt and an arrow pointing at the composer.
- **New message during scroll:** if the user is scrolled up reading old messages, don't auto-jump to the bottom — show a "↓ New message" toast they can tap.
- **Long messages:** wrap fine via `word-wrap: break-word` on `.msg__bubble`.
- **DocPane open + chat narrower:** below 1280 px, hide DocPane or make it a slide-over.
- **Action card actions** (`Lock it in`, `Send to client`): all hit existing v2 endpoints. Lock = `POST /quotes/:id` with status update; Send = `POST /quotes/:id/email`.
