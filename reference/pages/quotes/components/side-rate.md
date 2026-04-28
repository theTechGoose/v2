# `QSideRate` — Win rate half-donut

> ✅ **Build in v1.** Needs `GET /analytics/quotes/win-rate?days=90`.

## Purpose

A small white widget in the right rail that visualises the contractor's last-90-day win rate as a half-donut SVG arc, paired with the percentage and a "{won} won · {lost} lost / of {decided} decided" caption.

The half-donut is a 180° arc rendered as two stacked SVG paths: a mint-coloured background track and a green gradient progress arc whose `stroke-dasharray` is computed from the percentage. It's a one-off custom chart — no chart library involved.

## Source

- **JSX:** `Paperwork Monsters Quotes.html` lines **5277–5312**
- **CSS:** Quotes.html lines **2349–2365** (`.qrate*`)
- The shared `.qside__card` / `.qside__head` / `.qside__title` / `.qside__sub` styles are documented in `side-big.md`

## SVG geometry

```
<svg viewBox="0 0 110 70">
  <!-- track -->
  <path d="M 13 60 A 42 42 0 0 1 97 60"
        fill="none" stroke="var(--mint-200)" stroke-width="10" stroke-linecap="round"/>
  <!-- progress -->
  <path d="M 13 60 A 42 42 0 0 1 97 60"
        fill="none" stroke="url(#qg)" stroke-width="10" stroke-linecap="round"
        stroke-dasharray="{dash} {C}"/>
  <defs>
    <linearGradient id="qg" x1="0" x2="1">
      <stop offset="0%"   stop-color="#5FA34F"/>
      <stop offset="100%" stop-color="#3F7A33"/>
    </linearGradient>
  </defs>
</svg>
```

- Arc center: `(55, 60)` (svg's `cx, cy`)
- Radius: `42`
- Start point: `(13, 60)` — left side, baseline
- End point: `(97, 60)` — right side, baseline
- Half-circumference `C = π × 42 ≈ 131.95`
- Progress arc length: `dash = (pct / 100) × C`

The `stroke-dasharray="dash gap"` trick draws only the first `dash` length and skips `C` (more than the full path), so the rest is invisible.

## JSX (verbatim)

```jsx
const QSideRate = () => {
  const decided = QPIPELINE.filter(q => ['won','lost'].includes(q.stage));
  const won = decided.filter(q => q.stage === 'won').length;
  const lost = decided.length - won;
  const pct = decided.length ? Math.round((won/decided.length)*100) : 0;
  // half donut: 180 deg arc, r=42, stroke=10
  const C = Math.PI * 42; // half circumference
  const dash = (pct/100) * C;
  return (
    <div className="qside__card">
      <div className="qside__head">
        <div>
          <div className="qside__title">Win rate</div>
          <div className="qside__sub">last 90 days</div>
        </div>
      </div>
      <div className="qrate">
        <svg className="qrate__svg" viewBox="0 0 110 70">
          <path d="M 13 60 A 42 42 0 0 1 97 60" fill="none" stroke="var(--mint-200)" strokeWidth="10" strokeLinecap="round"/>
          <path d="M 13 60 A 42 42 0 0 1 97 60" fill="none" stroke="url(#qg)" strokeWidth="10" strokeLinecap="round"
                strokeDasharray={`${dash} ${C}`}/>
          <defs>
            <linearGradient id="qg" x1="0" x2="1">
              <stop offset="0%" stopColor="#5FA34F"/>
              <stop offset="100%" stopColor="#3F7A33"/>
            </linearGradient>
          </defs>
        </svg>
        <div>
          <div className="qrate__num">{pct}<span className="qrate__num-pct">%</span></div>
          <div className="qrate__lbl">{won} won · {lost} lost<br/>of {decided.length} decided</div>
        </div>
      </div>
    </div>
  );
};
```

## CSS (key rules)

```css
.qrate {
  display: grid; grid-template-columns: 110px 1fr;
  gap: 16px; align-items: center;
}
.qrate__svg { width: 110px; height: 70px; }

.qrate__num {
  font-family: var(--font-heading);
  font-weight: 800; font-size: 24px;
  color: var(--brand-teal);
  letter-spacing: -0.02em;
  line-height: 1;
}
.qrate__num-pct {
  font-size: 14px;
  color: var(--fg-muted);
  margin-left: 2px;
}
.qrate__lbl {
  font-size: 11.5px;
  color: var(--fg-muted);
  margin-top: 4px;
  line-height: 1.4;
}
```

## Preact / Fresh translation

```tsx
// v2/frontend/components/quotes/QSideRate.tsx — server component
export type WinRateData = {
  won:      number;
  lost:     number;
  windowDays?: number;        // default 90
};

export function QSideRate({ data }: { data: WinRateData }) {
  const { won, lost } = data;
  const decided = won + lost;
  const pct = decided > 0 ? Math.round((won / decided) * 100) : null;
  const C = Math.PI * 42;
  const dash = pct !== null ? (pct / 100) * C : 0;
  const days = data.windowDays ?? 90;

  return (
    <div class="qside__card">
      <div class="qside__head">
        <div>
          <div class="qside__title">Win rate</div>
          <div class="qside__sub">last {days} days</div>
        </div>
      </div>
      <div class="qrate">
        <svg
          class="qrate__svg"
          viewBox="0 0 110 70"
          role="img"
          aria-label={pct !== null
            ? `${pct} percent win rate, ${won} won and ${lost} lost out of ${decided} decided quotes in the last ${days} days`
            : `Not enough decided quotes yet to compute a win rate (${decided} so far)`}
        >
          <path d="M 13 60 A 42 42 0 0 1 97 60"
                fill="none" stroke="var(--mint-200)" stroke-width="10" stroke-linecap="round" />
          {pct !== null && (
            <path d="M 13 60 A 42 42 0 0 1 97 60"
                  fill="none" stroke="url(#qg)" stroke-width="10" stroke-linecap="round"
                  stroke-dasharray={`${dash} ${C}`} />
          )}
          <defs>
            <linearGradient id="qg" x1="0" x2="1">
              <stop offset="0%"   stop-color="#5FA34F" />
              <stop offset="100%" stop-color="#3F7A33" />
            </linearGradient>
          </defs>
        </svg>
        <div>
          {pct !== null ? (
            <div class="qrate__num">{pct}<span class="qrate__num-pct">%</span></div>
          ) : (
            <div class="qrate__num">—</div>
          )}
          <div class="qrate__lbl">
            {won} won · {lost} lost<br />of {decided} decided
          </div>
        </div>
      </div>
    </div>
  );
}
```

The `pct === null` branch handles the brand-new contractor case (zero decided quotes) without rendering "0%" — which would imply they've lost everything.

## Props

```ts
type WinRateData = {
  won:        number;
  lost:       number;
  windowDays?: number;
};
```

## Data source

`GET /analytics/quotes/win-rate?days=90`. Returns:

```json
{ "windowDays": 90, "won": 14, "lost": 6, "decided": 20, "winRate": 70 }
```

The frontend doesn't need `decided` separately (it's `won + lost`) but the API returning it is useful for cache validation. `winRate` is also redundant given the frontend recomputes — but having both defends against floating-point inconsistencies if the backend ever switches to weighted rates.

For tenants with `decided < 5`, return `winRate: null` and the frontend renders `—`.

## Island vs server

**Server.** No state.

## Accessibility

- The SVG is the entire chart. Set `role="img"` + a comprehensive `aria-label` that includes the percentage, won, lost, total decided, and window. SRs read once; users get the full picture without inspecting the visual.
- The numeric percentage (`24 px`, brand teal) is the primary readable surface; the SVG is supplemental. If the percent fails to render for any reason, the number + caption is still there.
- Honour `prefers-reduced-motion: reduce` — there's no animation defined here, but if added later, a "fill from 0%" sweep on first paint should snap.
- Brand teal (`#1A535C`) on white passes ≥ 7:1; the muted green-on-mint progress arc is decorative, contrast doesn't matter.

## Edge cases

- **`decided === 0`:** render `—%` (not `0%`). The caption reads "0 won · 0 lost / of 0 decided" — accurate and inoffensive.
- **`decided === 1`:** the percentage flips dramatically based on a single outcome. Production should consider hiding the number until `decided >= 5` and showing "Not enough data yet · {N} of 5 needed" — the prototype doesn't do this; flagging.
- **`pct === 100` (all won):** the arc renders fully. Looks correct.
- **`pct === 0` (all lost — possible at small `decided`):** the progress arc has zero length; only the mint track shows. The number says "0%". Honest, but maybe brutal — see the previous edge case for the < 5 decided guard.
- **`pct` rounding:** the prototype rounds with `Math.round`. A 49.999% win rate displays as 50% but the arc reflects the exact fraction. Acceptable; the arc's pixel difference is invisible.
- **Mobile (<1200 px):** the right rail moves below the cards. The 110-px SVG + 1fr label still fits — no special handling.
- **Lost streak demoralisation:** business problem, not a UI problem. If product wants to soften the experience, consider showing a "trend up/down vs last 90d" arrow next to the number. Not in v1 scope.
