# `QSideBig` — Top of pipeline panel

> ✅ **Build in v1.** No new endpoint needed — derives from the same `/quotes` payload that drives the cards.

## Purpose

The first widget in the right-rail. White card titled "Top of the pipeline" / "biggest open quotes". Lists the top 4 currently-open quotes by `value`, ranked, with a green progress bar under each row that scales relative to the largest. Each row: rank (`01`–`04`), client name, quote title, dollar amount, and a thin bar.

This is the contractor's "where's the money?" cheat sheet. The bigger quotes get visual weight at the top; the bars give relative scale at a glance.

## Source

- **JSX:** `Paperwork Monsters Quotes.html` lines **5246–5275**
- **CSS:** Quotes.html lines **2286–2347** (`.qside__card`, `.qside__head`, `.qside__title`, `.qside__sub`, `.qbig*`, `.qbar*`)

## JSX (verbatim)

```jsx
const QSideBig = () => {
  const open = QPIPELINE.filter(q => ['sent','opened','cooling','stale'].includes(q.stage))
                     .sort((a,b) => b.value - a.value).slice(0, 4);
  const max = open[0]?.value || 1;
  return (
    <div className="qside__card">
      <div className="qside__head">
        <div>
          <div className="qside__title">Top of the pipeline</div>
          <div className="qside__sub">biggest open quotes</div>
        </div>
      </div>
      <div className="qbig">
        {open.map((q, i) => (
          <div key={q.id}>
            <div className="qbig__row">
              <span className="qbig__rank">{String(i+1).padStart(2,'0')}</span>
              <div style={{minWidth:0}}>
                <div className="qbig__name">{q.client}</div>
                <div className="qbig__sub">{q.title}</div>
              </div>
              <span className="qbig__amt">${fmtMoney(q.value)}</span>
            </div>
            <div className="qbar"><div className="qbar__fill" style={{width: `${(q.value/max)*100}%`}}/></div>
          </div>
        ))}
      </div>
    </div>
  );
};
```

Note: `'draft'` quotes are intentionally excluded — they're not "out for response" yet and shouldn't compete for ranking attention.

## CSS (key rules)

```css
.qside__card {
  background: #fff;
  border-radius: var(--radius-xl);
  padding: 18px;
  border: 1px solid rgba(26,83,92,0.07);
}
.qside__head {
  display: flex; align-items: baseline; justify-content: space-between;
  margin-bottom: 14px;
}
.qside__title {
  font-family: var(--font-heading);
  font-weight: 800; font-size: 14px;
  color: var(--brand-teal);
  letter-spacing: -0.01em;
}
.qside__sub { font-size: 11px; color: var(--fg-muted); }

.qbig { display: flex; flex-direction: column; gap: 10px; }
.qbig__row {
  display: grid; grid-template-columns: auto 1fr auto;
  gap: 10px; align-items: center;
}
.qbig__rank {
  font-family: var(--font-heading);
  font-size: 11px; font-weight: 800;
  color: var(--brand-pink);
  width: 18px;
  letter-spacing: 0.05em;
}
.qbig__name {
  font-family: var(--font-heading);
  font-size: 13px; font-weight: 700;
  color: var(--brand-teal);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.qbig__sub {
  font-size: 11px; color: var(--fg-muted);
  margin-top: 1px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.qbig__amt {
  font-family: var(--font-heading);
  font-weight: 800; font-size: 13.5px;
  color: var(--brand-teal);
  letter-spacing: -0.01em;
}

.qbar {
  height: 6px; border-radius: 999px;
  background: var(--mint-200);
  overflow: hidden;
  margin-top: 8px;
}
.qbar__fill {
  height: 100%;
  background: linear-gradient(90deg, var(--brand-green), var(--green-700));
  border-radius: 999px;
  transition: width 1.2s var(--ease-out);
}
```

## Preact / Fresh translation

```tsx
// v2/frontend/components/quotes/QSideBig.tsx — server component
import { fmtMoney } from "../../lib/format.ts";

export type BigQuote = {
  id:     string;
  client: string;
  title:  string;
  value:  number;
};

export function QSideBig({ quotes }: { quotes: BigQuote[] }) {
  if (quotes.length === 0) return null;
  const top = quotes.slice(0, 4);
  const max = top[0].value || 1;

  return (
    <div class="qside__card">
      <div class="qside__head">
        <div>
          <div class="qside__title">Top of the pipeline</div>
          <div class="qside__sub">biggest open quotes</div>
        </div>
      </div>
      <ol class="qbig">
        {top.map((q, i) => (
          <li key={q.id}>
            <a href={`/quotes/${q.id}`} class="qbig__row">
              <span class="qbig__rank" aria-hidden="true">
                {String(i + 1).padStart(2, '0')}
              </span>
              <div style={{ minWidth: 0 }}>
                <div class="qbig__name">{q.client}</div>
                <div class="qbig__sub">{q.title}</div>
              </div>
              <span class="qbig__amt">${fmtMoney(q.value)}</span>
            </a>
            <div class="qbar" aria-hidden="true">
              <div class="qbar__fill" style={{ width: `${(q.value / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
```

`<ol>` + `<li>` carries the ranking semantics. The bar (`.qbar`) goes outside the link's hit area so the whole card row is clickable but the bar is decorative.

## Props

```ts
type BigQuote = {
  id:     string;
  client: string;
  title:  string;
  value:  number;
};

type QSideBigProps = {
  quotes: BigQuote[];   // pre-filtered to open stages, pre-sorted by value desc
};
```

## Data source

Derived from the same `GET /quotes` payload that drives the main cards grid:

```ts
const top = quotes
  .filter(q => ['sent', 'opened', 'cooling', 'stale'].includes(q.stage))
  .sort((a, b) => b.value - a.value)
  .slice(0, 4);
```

No new endpoint. Compute server-side at SSR.

## Island vs server

**Server.** No state.

## Accessibility

- `<ol>` + `<li>` makes the ranking explicit to SRs.
- The rank text "01"–"04" is purely positional; `aria-hidden="true"`.
- Each row's `<a>` should have an `aria-label` like "$8,200 — Marshall & Sons — Driveway repour, ranked 3 of 4." The visible text already covers most of this; the rank is the part that's invisible to SRs without help.
- The bar (`.qbar` + `.qbar__fill`) is purely decorative — `aria-hidden="true"`. Don't expose as a `progressbar`; this isn't progress.
- The bar's 1.2 s ease-out transition fires only on width changes after first paint. To get a "fill from zero" load animation, render at `width: 0` initially and toggle to `${pct}%` in a `useEffect` — needs an island, probably not worth it for v1.

## Edge cases

- **No open quotes:** `return null`. Right rail collapses to just the win-rate + tip cards. Don't render an empty "biggest open quotes" card.
- **1–3 open quotes:** show all of them (1, 2, or 3 rows). Don't pad.
- **All four tied at the same value:** all bars at `100%`, all visually the same. Acceptable — the ranking still applies (chronological tiebreak in the sort, server-side).
- **Long client name + long title:** both lines truncate with `text-overflow: ellipsis`. The amount column always shows in full.
- **Very large `value` (e.g. $128,000):** the amount column is `auto`-sized; long values push the row's middle column narrower. Consider `Intl.NumberFormat` compact notation (`$128k`) for values > $99,999 to keep the layout calm.
- **Mobile (<1200 px):** the right rail collapses below the cards (`.qlay → 1fr`); this card stretches full-width. The 3-column row (`auto 1fr auto`) keeps working at full-width — no extra changes needed.
