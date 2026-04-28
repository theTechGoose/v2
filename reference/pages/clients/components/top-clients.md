# `TopClients` — Leaderboard panel

> ✅ **Build in v1.** Needs a new `GET /analytics/clients/top` endpoint that aggregates 12-month revenue per customer.

## Purpose

Right-rail panel that surfaces the contractor's top 5 clients by 12-month revenue. Dark teal background with a soft pink radial-gradient bloom in the top-right corner. Each row is a 3-column grid: a 2-digit rank ("01"…"05"), the client name, and the revenue amount, with a thin pink progress bar underneath that scales by `pct` (relative to the top earner). The "01" rank gets a gold tint (`#FFD56B`); ranks 2–5 stay muted white at 0.5 opacity.

The panel's purpose is mostly emotional — it tells the contractor at a glance who's keeping the lights on, alongside the matching headline copy in `<ClientsHero />`. It's not a navigation surface in v1 (no row click), though the rows should become links to `/clients/:id` once that page exists.

## Source

- **JSX:** `Paperwork Monsters Clients.html` lines **4222–4252**
- **CSS:** Clients.html lines **2247–2278** (`.ctop2*`)
- The pink radial-gradient bloom (`.ctop2::before`) is the panel's only decoration

## Static seed (verbatim)

```js
const tops = [
  { name:'Greenleaf HOA',          amt:'$32,400', pct: 100 },
  { name:'Maple Grove Apartments', amt:'$24,800', pct: 76 },
  { name:'Ortega Rentals',         amt:'$18,720', pct: 58 },
  { name:'Cobblestone Cafe',       amt:'$15,920', pct: 49 },
  { name:'Marshall & Sons',        amt:'$11,450', pct: 35 },
];
```

## JSX (verbatim)

```jsx
const TopClients = () => {
  const tops = [/* see seed above */];
  return (
    <div className="ctop2">
      <div className="ctop2__head">
        <div className="ctop2__title">Top of the leaderboard</div>
        <div className="ctop2__period">last 12 mo</div>
      </div>
      <div className="ctop2__list">
        {tops.map((t, i) => (
          <div key={t.name}>
            <div className="ctop2__item">
              <div className={`ctop2__rank ${i===0?'ctop2__rank--1':''}`}>0{i+1}</div>
              <div className="ctop2__name">{t.name}</div>
              <div className="ctop2__amt">{t.amt}</div>
            </div>
            <div className="ctop2__bar-wrap">
              <div className="ctop2__bar" style={{width: `${t.pct}%`}}/>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
```

## CSS (key rules)

```css
.ctop2 {
  background: var(--brand-teal);
  color: #fff;
  border-radius: var(--radius-xl);
  padding: 18px;
  position: relative; overflow: hidden;
}
.ctop2::before {
  content: '';
  position: absolute; top: -30px; right: -30px;
  width: 140px; height: 140px;
  background: radial-gradient(circle, rgba(255,107,107,0.35), transparent 70%);
  border-radius: 999px;
}
.ctop2__head {
  position: relative; z-index: 1;
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 14px;
}
.ctop2__title  { font-family: var(--font-heading); font-weight: 800; font-size: 14px; }
.ctop2__period { font-size: 11px; opacity: 0.7; font-weight: 600; }

.ctop2__list { display: flex; flex-direction: column; gap: 11px;
               position: relative; z-index: 1; }
.ctop2__item { display: grid; grid-template-columns: 22px 1fr auto;
               gap: 10px; align-items: center; }
.ctop2__rank { font-family: var(--font-heading); font-weight: 800; font-size: 11px;
               color: rgba(255,255,255,0.5); letter-spacing: 0.05em; }
.ctop2__rank--1 { color: #FFD56B; }
.ctop2__name { font-family: var(--font-heading); font-weight: 700; font-size: 13px;
               overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ctop2__bar-wrap { grid-column: 2 / -1; height: 4px; border-radius: 999px;
                   background: rgba(255,255,255,0.12);
                   margin-top: 4px; overflow: hidden; }
.ctop2__bar { height: 100%;
              background: linear-gradient(90deg, var(--brand-pink), #FFB3B3);
              border-radius: 999px; }
.ctop2__amt { font-family: var(--font-heading); font-weight: 800; font-size: 13px; }
```

## Preact / Fresh translation

```tsx
// v2/frontend/components/clients/TopClients.tsx — server component
export type TopClient = {
  id:   string;
  name: string;
  amt:  string;     // pre-formatted "$32,400"
  pct:  number;     // 0–100, relative to leader
};

export function TopClients(props: { clients: TopClient[]; period?: string }) {
  const period = props.period ?? 'last 12 mo';
  if (props.clients.length === 0) return null;

  return (
    <div class="ctop2">
      <div class="ctop2__head">
        <div class="ctop2__title">Top of the leaderboard</div>
        <div class="ctop2__period">{period}</div>
      </div>
      <div class="ctop2__list">
        {props.clients.slice(0, 5).map((t, i) => (
          <a key={t.id} href={`/clients/${t.id}`} class="ctop2__row">
            <div class="ctop2__item">
              <div class={`ctop2__rank ${i === 0 ? 'ctop2__rank--1' : ''}`}>
                {String(i + 1).padStart(2, '0')}
              </div>
              <div class="ctop2__name">{t.name}</div>
              <div class="ctop2__amt">{t.amt}</div>
            </div>
            <div class="ctop2__bar-wrap">
              <div class="ctop2__bar" style={{ width: `${t.pct}%` }} />
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
```

The prototype renders each row as a `<div>`. Production should use `<a href>` so the entire row is a navigable link (and supports right-click "Open in new tab"). Add a `.ctop2__row` style for `display: contents` or `display: block` + colour reset, since `<a>` defaults underline + blue.

## Props

```ts
type TopClient = {
  id:   string;
  name: string;
  amt:  string;   // currency-formatted "$32,400"
  pct:  number;   // 0–100, normalised to leader = 100
};

type TopClientsProps = {
  clients: TopClient[];
  period?: string;   // default "last 12 mo" — extensible to "last 6 mo", "this year", etc.
};
```

## Data source

**v1:** new endpoint `GET /analytics/clients/top?period=12mo&limit=5`. Returns:

```json
{
  "period": "12mo",
  "asOf":   "2026-04-28",
  "clients": [
    { "id": "cust_01H...", "name": "Greenleaf HOA", "totalCents": 3240000, "pct": 100 },
    ...
  ]
}
```

The frontend formats `totalCents` to a display string with `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })`. `pct` is computed server-side from the leader; the bar widths animate with `transition: width 1s var(--ease-bounce)` if added (the prototype doesn't, but it's a nice touch).

The "12-month total" calculation is `Σ` of all paid invoices in the trailing 12 months, per customer. Quotes and unpaid invoices don't count — this is the "actual revenue" leaderboard, not the "potential" one. Document this clearly in the endpoint spec because contractors will ask.

## Island vs server

**Server.** No state. Plain server-rendered links.

## Accessibility

- The panel sits on dark teal; ensure white-on-teal headline (4.5:1 ≥ pass) and verify the muted period text (`opacity: 0.7`) on the same background — borderline at 11 px. If it fails, drop to `0.78`.
- `.ctop2__rank` at 0.5 white opacity on dark teal is decorative; the rank number is a positional cue, not the primary content. Hide from SRs with `aria-hidden="true"`.
- Each row's `<a>` should have an accessible label like `aria-label="Greenleaf HOA — $32,400 over the last 12 months, ranked 1"`. The visual rank "01" doesn't communicate "ranked 1st" to a screen reader.
- The `.ctop2__bar` has no semantic role for SRs (it's purely visual). Don't expose it via `role="progressbar"` — that's misleading; this isn't progress, it's relative scale.

## Edge cases

- **Fewer than 5 clients:** the panel still renders with however many exist (3 rows, 4 rows). Don't pad to 5 with placeholders.
- **Zero clients (new contractor):** the component returns `null` and the right rail collapses to just `<ClientsSegments />`. `null`-return is the correct empty state for this panel — there's no "no leaderboard yet" placeholder copy that adds value.
- **All five tied at $0:** unlikely but possible (brand-new contractor with all unpaid invoices). The bars all have `pct: 0` — render anyway; the names + zero amounts are still useful.
- **Long client names:** `.ctop2__name` truncates with `text-overflow: ellipsis`. The full name is in the row's `aria-label` and on the linked detail page.
- **More than 5 (request `limit=10`):** the panel scrolls vertically. Cap at 5 in the v1 design — anything more is a separate "All clients by revenue" view (deferred).
- **Reduced motion:** the bar growth animation (if added) should snap rather than ease. The radial-gradient bloom is static — no change needed.
