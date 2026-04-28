# `QuotesKpis` — 4-tile KPI strip

> ✅ **Build in v1.** All four counts derive from the same `GET /quotes` payload; the win-rate also needs the new `/analytics/quotes/win-rate?days=90` endpoint.

## Purpose

A 4-tile grid that sits between `<QuotesHero>` and the first `<Track>`. Each tile is a small white card with a tiny uppercase label, a 22 px value, and a 11 px subtitle:

| Tile | Value | Subtitle |
|---|---|---|
| **Out for response** (pink-accent tile) | dollar total of `sent + opened + cooling + stale` | "{N} quotes waiting" |
| Drafting | count of `draft` | "finish + send" |
| Decided this month | count of `won + lost` | "{won} won · {lost} lost" |
| Win rate (90d) | `won / decided × 100` % | "↑ 8 pts vs Q1" (placeholder delta) |

The first tile gets a pink-tinted gradient background (`.qkpi__cell--accent`) and a pink value colour to anchor the row visually — money matters most. The rest are plain white.

## Source

- **JSX:** `Paperwork Monsters Quotes.html` lines **5016–5047**
- **CSS:** Quotes.html lines **1799–1833** (`.qkpi*`) and the responsive collapse at **2378**

## JSX (verbatim)

```jsx
const QuotesKpis = () => {
  const drafts  = QPIPELINE.filter(q => q.stage === 'draft').length;
  const out     = QPIPELINE.filter(q => ['sent','opened','cooling','stale'].includes(q.stage));
  const outVal  = out.reduce((s,q) => s + q.value, 0);
  const decided = QPIPELINE.filter(q => ['won','lost'].includes(q.stage));
  const won     = decided.filter(q => q.stage === 'won');
  const winRate = decided.length ? Math.round((won.length / decided.length) * 100) : 0;
  return (
    <div className="qkpi">
      <div className="qkpi__cell qkpi__cell--accent">
        <div className="qkpi__lbl">Out for response</div>
        <div className="qkpi__val">${fmtMoney(outVal)}</div>
        <div className="qkpi__sub">{out.length} quotes waiting</div>
      </div>
      <div className="qkpi__cell">
        <div className="qkpi__lbl">Drafting</div>
        <div className="qkpi__val">{drafts}</div>
        <div className="qkpi__sub">finish + send</div>
      </div>
      <div className="qkpi__cell">
        <div className="qkpi__lbl">Decided this month</div>
        <div className="qkpi__val">{decided.length}</div>
        <div className="qkpi__sub">{won.length} won · {decided.length - won.length} lost</div>
      </div>
      <div className="qkpi__cell">
        <div className="qkpi__lbl">Win rate (90d)</div>
        <div className="qkpi__val">{winRate}%</div>
        <div className="qkpi__sub">↑ 8 pts vs Q1</div>
      </div>
    </div>
  );
};
```

## CSS (key rules)

```css
.qkpi {
  display: grid; grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-bottom: 22px;
}
.qkpi__cell {
  background: #fff;
  border-radius: var(--radius-lg);
  padding: 14px 16px;
  border: 1px solid rgba(26,83,92,0.07);
  position: relative; overflow: hidden;
}
.qkpi__cell--accent {
  background: linear-gradient(135deg, #FFF1ED 0%, #FFE4DA 100%);
  border-color: rgba(255,107,107,0.2);
}
.qkpi__lbl {
  font-family: var(--font-heading);
  font-size: 10px; font-weight: 700;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--fg-muted);
  margin-bottom: 4px;
}
.qkpi__val {
  font-family: var(--font-heading);
  font-weight: 800; font-size: 22px;
  color: var(--brand-teal);
  letter-spacing: -0.02em;
  line-height: 1;
}
.qkpi__cell--accent .qkpi__val { color: var(--brand-pink); }
.qkpi__sub {
  font-size: 11.5px; color: var(--fg-muted);
  margin-top: 4px;
}

@media (max-width: 1200px) {
  .qkpi { grid-template-columns: repeat(2, 1fr); }
}
```

## Preact / Fresh translation

```tsx
// v2/frontend/components/quotes/QuotesKpis.tsx — server component
import { fmtMoney } from "../../lib/format.ts";

export type QuotesKpiProps = {
  outValue:    number;        // Σ q.value for sent/opened/cooling/stale
  outCount:    number;
  draftCount:  number;
  wonCount:    number;
  lostCount:   number;
  winRate:     number;        // 0–100, integer percent
  winRateDelta?: { points: number; vs: string };  // optional; e.g. { points: 8, vs: 'Q1' }
};

export function QuotesKpis(props: QuotesKpiProps) {
  const decided = props.wonCount + props.lostCount;
  return (
    <div class="qkpi">
      <div class="qkpi__cell qkpi__cell--accent">
        <div class="qkpi__lbl">Out for response</div>
        <div class="qkpi__val">${fmtMoney(props.outValue)}</div>
        <div class="qkpi__sub">{props.outCount} {props.outCount === 1 ? 'quote' : 'quotes'} waiting</div>
      </div>
      <div class="qkpi__cell">
        <div class="qkpi__lbl">Drafting</div>
        <div class="qkpi__val">{props.draftCount}</div>
        <div class="qkpi__sub">finish + send</div>
      </div>
      <div class="qkpi__cell">
        <div class="qkpi__lbl">Decided this month</div>
        <div class="qkpi__val">{decided}</div>
        <div class="qkpi__sub">{props.wonCount} won · {props.lostCount} lost</div>
      </div>
      <div class="qkpi__cell">
        <div class="qkpi__lbl">Win rate (90d)</div>
        <div class="qkpi__val">{props.winRate}%</div>
        {props.winRateDelta ? (
          <div class="qkpi__sub">
            {props.winRateDelta.points >= 0 ? '↑' : '↓'} {Math.abs(props.winRateDelta.points)} pts vs {props.winRateDelta.vs}
          </div>
        ) : (
          <div class="qkpi__sub">&nbsp;</div>   /* preserve row height */
        )}
      </div>
    </div>
  );
}
```

The optional `winRateDelta` prop keeps the layout honest — when there's no comparable prior period (brand-new contractor), the subtitle is empty rather than a lie.

## Props

```ts
type QuotesKpiProps = {
  outValue:    number;
  outCount:    number;
  draftCount:  number;
  wonCount:    number;
  lostCount:   number;
  winRate:     number;
  winRateDelta?: { points: number; vs: string };
};
```

## Data source

**v1:**
- `outValue`, `outCount`, `draftCount`, `wonCount`, `lostCount` derive from `GET /quotes` (same payload that drives the cards) — counted server-side at SSR.
- `winRate` and `winRateDelta` come from `GET /analytics/quotes/win-rate?days=90&compare=prev_quarter`.

The endpoint should return:

```json
{
  "windowDays":   90,
  "won":          14,
  "lost":         6,
  "decided":      20,
  "winRate":      70,
  "comparedTo":   { "label": "Q1", "winRate": 62, "delta": 8 }
}
```

For brand-new contractors with `decided < 5` over the 90-day window, the endpoint should return `winRate: null` and the page should render `—` instead of `0%`. A 0% win rate from a single decided-and-lost quote is misleading.

## Island vs server

**Server.** No state.

## Accessibility

- Each tile is a static stat. The label + value + subtitle order is read sequentially by SRs, which works.
- The pink-accent tile uses colour to communicate "this is the most important number" — the bigger value isn't the primary signal (it's the same 22 px size as the others), the colour is. For SR clarity, the label "Out for response" carries the meaning; colour redundancy is fine.
- The `↑ 8 pts vs Q1` line is a meaningful delta. Make sure SRs read it as "up 8 points versus Q1," not "arrow up 8 pts vs Q1." Use a real Unicode arrow (`↑` / `↓`) which most SRs read as "up arrow" / "down arrow." If precise wording matters, replace the arrow with `<span aria-label="up">↑</span><span aria-hidden="true"> </span>`.
- Number values (22 px, 800 weight) on white background hit 7:1 contrast easily. The pink tile's `var(--brand-pink)` value text on the cream gradient should be tested — borderline at the lighter end of the gradient. If it fails, drop to `var(--pink-700)` for the value.

## Edge cases

- **All zero (brand-new):** 4 tiles all show `$0` / `0` / `0` / `—%`. Better than hiding. The KPI strip's job is to give the contractor a baseline; zero IS the baseline.
- **`outCount === 1`:** "1 quote waiting." Pluralisation in the JSX above.
- **`decided === 0`:** "0 won · 0 lost" reads correctly; the win-rate tile shows `—%` (per the data-source note above).
- **Negative delta:** "↓ 4 pts vs Q1" — pink colour is allowed for losses in this brand, but the tile background stays white (unlike `Out for response`). The arrow direction in the JSX above handles sign.
- **Mobile (<1200 px):** `.qkpi` collapses to 2 columns. Below 480 px, single column; the prototype doesn't define this — production should add it.
- **Very large `outValue` (e.g. $1,200,000):** the value font is fluid via `font-size: 22px` (no clamp). At 7 chars + dollar sign, the value still fits the tile at 1200 px. Stress-test at 8 chars to be safe; if it overflows, drop the cents-off `toLocaleString()` for `Intl.NumberFormat('en-US', { notation: 'compact' })` to render `$1.2M`.
