# `DealBar` — Sticky deal summary at top of chat

> ⚠️ **DEFERRED — depends on agents module.** Renders deal-specific data (client, total, current phase) that comes from the agents module's conversation metadata.

## Purpose

Sticky bar at the top of the chat scroll showing: client name + label, quote total + label, three phase chips (`Quote → Terms → Send`) with one in "active" state and earlier ones in "done" state, and a "Back to chat" button. Visible above all messages.

## Source

- JSX: `Paperwork Monsters Assistant.html` lines **4269–4299**
- Inline CSS: search for `.deal`, `.deal__client`, `.deal__total`, `.deal__phases`, `.deal__phase`, `.deal__phase--active`, `.deal__phase--done`, `.deal__phase-arrow`, `.deal__back`

## JSX (verbatim)

```jsx
const DealBar = () => (
  <div className="deal">
    <div className="deal__client">
      <span className="deal__client-label">Client</span>
      <span className="deal__client-name">Tom &amp; Linda K.</span>
    </div>
    <div className="deal__total">
      <span className="deal__total-label">Quote total</span>
      <span className="deal__total-val">$3,400</span>
    </div>
    <div className="deal__phases">
      <span className="deal__phase deal__phase--done">
        <span className="deal__phase-num"><I d={ICN.check} size={9} sw={3.5}/></span>
        Quote
      </span>
      <span className="deal__phase-arrow">→</span>
      <span className="deal__phase deal__phase--active">
        <span className="deal__phase-num">2</span>
        Terms
      </span>
      <span className="deal__phase-arrow">→</span>
      <span className="deal__phase">
        <span className="deal__phase-num">3</span>
        Send
      </span>
    </div>
    <button className="deal__back">
      <I d={ICN.back} size={11}/> Back to chat
    </button>
  </div>
);
```

## CSS (intended structure — read inline `<style>` for canonical version)

```css
.deal {
  position: sticky; top: 0; z-index: 5;
  display: grid; grid-template-columns: auto auto 1fr auto;
  gap: 24px; align-items: center;
  background: rgba(255,255,255,0.92); backdrop-filter: blur(10px);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 10px 16px;
  margin-bottom: 14px;
}
.deal__client-label,
.deal__total-label  { display: block; font-size: 10px;
                       font-family: var(--font-heading); font-weight: 700;
                       text-transform: uppercase; letter-spacing: 0.06em;
                       color: var(--fg-subtle); margin-bottom: 1px; }
.deal__client-name  { font-family: var(--font-heading); font-weight: 800;
                       font-size: 13px; color: var(--brand-teal); }
.deal__total-val    { font-family: var(--font-heading); font-weight: 800;
                       font-size: 18px; color: var(--brand-pink);
                       letter-spacing: -0.01em; }

.deal__phases       { display: flex; align-items: center; gap: 10px;
                       justify-content: end; }
.deal__phase        { display: inline-flex; align-items: center; gap: 6px;
                       font-family: var(--font-heading); font-weight: 700;
                       font-size: 11px; color: var(--fg-muted); }
.deal__phase-num    { width: 18px; height: 18px; border-radius: 999px;
                       background: var(--mint-200); color: var(--fg-muted);
                       display: flex; align-items: center; justify-content: center;
                       font-size: 9px; font-weight: 800; }
.deal__phase--done .deal__phase-num   { background: var(--brand-green); color: #fff; }
.deal__phase--done                    { color: var(--brand-teal); }
.deal__phase--active .deal__phase-num { background: var(--brand-pink); color: #fff; }
.deal__phase--active                  { color: var(--brand-teal); }
.deal__phase-arrow                    { color: var(--coffee-300); font-weight: 700; }

.deal__back {
  display: inline-flex; align-items: center; gap: 4px;
  background: transparent; border: 1px solid var(--border-strong);
  border-radius: 8px; padding: 5px 10px;
  font-family: var(--font-heading); font-weight: 700; font-size: 11px;
  color: var(--fg-muted); cursor: pointer;
}
.deal__back:hover { background: var(--mint-200); color: var(--brand-teal); }
```

## Preact / Fresh translation

```tsx
// v2/frontend/components/assistant/DealBar.tsx — server component
import * as I from "../ui/icons.tsx";

type Phase = 1 | 2 | 3;
const PHASE_LABELS = ['Quote', 'Terms', 'Send'] as const;

export function DealBar(props: {
  clientName: string;
  totalCents: number;
  currentPhase: Phase;
}) {
  const total = (props.totalCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  return (
    <div class="deal">
      <div class="deal__client">
        <span class="deal__client-label">Client</span>
        <span class="deal__client-name">{props.clientName}</span>
      </div>
      <div class="deal__total">
        <span class="deal__total-label">Quote total</span>
        <span class="deal__total-val">{total}</span>
      </div>
      <div class="deal__phases" role="progressbar"
           aria-valuemin={1} aria-valuemax={3} aria-valuenow={props.currentPhase}
           aria-valuetext={`Phase ${props.currentPhase} of 3 — ${PHASE_LABELS[props.currentPhase - 1]}`}>
        {([1, 2, 3] as Phase[]).map((p, i) => {
          const state = p < props.currentPhase ? 'done'
                      : p === props.currentPhase ? 'active'
                      :                            '';
          return (
            <>
              <span class={`deal__phase ${state ? `deal__phase--${state}` : ''}`}>
                <span class="deal__phase-num">
                  {state === 'done' ? <I.Check size={9} sw={3.5} /> : p}
                </span>
                {PHASE_LABELS[i]}
              </span>
              {i < 2 && <span class="deal__phase-arrow" aria-hidden="true">→</span>}
            </>
          );
        })}
      </div>
      <button class="deal__back" type="button">
        <I.Back size={11} /> Back to chat
      </button>
    </div>
  );
}
```

## Props

```ts
type DealBarProps = {
  clientName:   string;
  totalCents:   number;
  currentPhase: 1 | 2 | 3;
};
```

## Data source

From the active conversation's metadata (agents module): `Conversation.dealMetadata = { clientId, totalCents, currentPhase }`. Backend joins `Quote.estimatedTotal` for total, `Customer.name` for client name. The `currentPhase` advances based on chat events: phase 1 → 2 once a quote is locked; 2 → 3 once contract terms are confirmed.

## Island vs server

**Server.** No JS — values render at SSR. The "Back to chat" button could be an island that scrolls the chat to the bottom; not strictly needed.

## Accessibility

- `role="progressbar"` + `aria-valuetext` on the phase strip narrates "Phase 2 of 3 — Terms" to SR.
- Phase chips have a meaningful color but not in isolation — make sure the `aria-valuetext` is the SR's actual source.
- "Back to chat" button needs `aria-label` if the icon-only version is used on mobile.
- `position: sticky` + `backdrop-filter` may cause SR focus issues — verify with VoiceOver/NVDA.

## Edge cases

- **Phase 1, no quote yet:** `totalCents === 0` — render "—" instead of $0.
- **Phase advanced by user undoing a step:** lock the phase indicator to the highest reached, but allow the active marker to move backward visually if the chat is mid-rewind.
- **Long client name:** ellipsis on `.deal__client-name`.
- **Mobile (<768px):** stack vertically: client + total in one row, phases below, back button hidden behind a menu.
- **No deal at all** (free-form chat with no quote): hide the bar entirely. The chat works without it.
