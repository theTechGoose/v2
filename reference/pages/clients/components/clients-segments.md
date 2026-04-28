# `ClientsSegments` — Book composition mini chart

> ✅ **Build in v1.** Counts come from `GET /analytics/clients/segments`; widths are relative to the largest segment.

## Purpose

A small white panel under `<TopClients />` in the right rail. Title "Who's on your books", followed by four horizontal bar rows — one per business segment (Property mgmt, Homeowners, Small biz, HOAs). Each row shows the segment name, a coloured bar that scales by segment share, and the count. Bar colours match the segment's identity in the rest of the app (Property mgmt → green, Homeowners → pink, Small biz → teal, HOAs → coffee).

This is a "where does my work come from" gut-check, not a data-vis page. Keep it visually quiet.

## Source

- **JSX:** `Paperwork Monsters Clients.html` lines **4303–4322**
- **CSS:** Clients.html lines **2280–2292** (`.csegment2*`, `.cseg2-row*`)

## Static seed (verbatim)

```js
const segs = [
  { lbl:'Property mgmt', pct: 80, num: 4, color:'var(--brand-green)' },
  { lbl:'Homeowners',    pct: 60, num: 5, color:'var(--brand-pink)'  },
  { lbl:'Small biz',     pct: 40, num: 2, color:'var(--brand-teal)'  },
  { lbl:'HOAs',          pct: 18, num: 1, color:'var(--coffee-500)'  },
];
```

`pct` here is **a hand-tuned visual width**, not "% of clients." The "Property mgmt" segment is 4/12 = 33% of clients but its bar shows 80% wide because the design uses pct relative to the largest *visual* footprint, not the count. In production, normalise `pct = (count / Math.max(...counts)) * 100` so the largest bar always hits 100% — the prototype's seed is a lie that production should not perpetuate.

## JSX (verbatim)

```jsx
const ClientsSegments = () => {
  const segs = [/* see seed above */];
  return (
    <div className="csegment2">
      <div className="csegment2__title">Who's on your books</div>
      {segs.map(s => (
        <div className="cseg2-row" key={s.lbl}>
          <div className="cseg2-row__lbl">{s.lbl}</div>
          <div className="cseg2-row__bar">
            <div className="cseg2-row__fill"
                 style={{width:`${s.pct}%`, background: s.color}}/>
          </div>
          <div className="cseg2-row__num">{s.num}</div>
        </div>
      ))}
    </div>
  );
};
```

## CSS (key rules)

```css
.csegment2 {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  padding: 18px;
}
.csegment2__title {
  font-family: var(--font-heading);
  font-weight: 800; font-size: 14px;
  color: var(--brand-teal);
  margin-bottom: 14px;
}
.cseg2-row {
  display: flex; align-items: center; gap: 10px;
  margin-bottom: 10px;
}
.cseg2-row:last-child { margin-bottom: 0; }
.cseg2-row__lbl  { font-size: 12px; color: var(--brand-teal);
                   font-weight: 600; min-width: 100px; }
.cseg2-row__bar  { flex: 1; height: 6px; border-radius: 999px;
                   background: var(--bg-sunken); overflow: hidden; }
.cseg2-row__fill { height: 100%; border-radius: 999px;
                   transition: width 1s var(--ease-bounce); }
.cseg2-row__num  { font-family: var(--font-heading); font-weight: 800; font-size: 12px;
                   color: var(--brand-teal); min-width: 24px; text-align: right; }
```

## Preact / Fresh translation

```tsx
// v2/frontend/components/clients/ClientsSegments.tsx — server component
export type Segment = {
  id:    'property-mgmt' | 'homeowner' | 'small-biz' | 'hoa';
  label: string;
  count: number;
  color: string;   // CSS color value or var()
};

const SEGMENT_COLOR: Record<Segment['id'], string> = {
  'property-mgmt': 'var(--brand-green)',
  'homeowner':     'var(--brand-pink)',
  'small-biz':     'var(--brand-teal)',
  'hoa':           'var(--coffee-500)',
};

export function ClientsSegments(props: { segments: Omit<Segment, 'color'>[] }) {
  const segs = props.segments;
  const max = Math.max(...segs.map(s => s.count), 1);

  return (
    <div class="csegment2">
      <div class="csegment2__title">Who's on your books</div>
      {segs.map(s => {
        const pct = Math.round((s.count / max) * 100);
        return (
          <div class="cseg2-row" key={s.id}>
            <div class="cseg2-row__lbl">{s.label}</div>
            <div class="cseg2-row__bar">
              <div
                class="cseg2-row__fill"
                style={{ width: `${pct}%`, background: SEGMENT_COLOR[s.id] }}
                aria-hidden="true"
              />
            </div>
            <div class="cseg2-row__num">{s.count}</div>
          </div>
        );
      })}
    </div>
  );
}
```

The bar growth animation (`transition: width 1s var(--ease-bounce)`) only fires on width changes — on first paint the bar is already at full width. To get a satisfying "fill from 0" on page load, render with `width: 0` and toggle to `pct` on `useEffect` mount (this needs an island; not worth the hydration cost for v1).

## Props

```ts
type Segment = {
  id:    'property-mgmt' | 'homeowner' | 'small-biz' | 'hoa';
  label: string;     // human-readable; usually matches the static labels above
  count: number;
};

type ClientsSegmentsProps = {
  segments: Segment[];   // typically 4 rows; render in count-desc order
};
```

## Data source

**v1:** new endpoint `GET /analytics/clients/segments`. Returns:

```json
{
  "segments": [
    { "id": "property-mgmt", "label": "Property mgmt", "count": 4 },
    { "id": "homeowner",     "label": "Homeowners",    "count": 5 },
    { "id": "small-biz",     "label": "Small biz",     "count": 2 },
    { "id": "hoa",           "label": "HOAs",          "count": 1 }
  ]
}
```

`segment` lives on the v2 `Customer` DTO (or is derived from job types — e.g. a customer with ≥ 4 active units → "property-mgmt", a customer linked to an HOA contract → "hoa", etc.). The endpoint just groups + counts.

`pct` is computed client-side as `count / max(counts) * 100`. Sort by `count` descending so the longest bar is always at the top.

## Island vs server

**Server.** No interactivity.

## Accessibility

- The panel is a small data-vis. SRs should hear the segment label + count, not the bar pixel-width. Add `aria-hidden="true"` on `.cseg2-row__fill` and ensure the segment label and count are read in order (they're already in DOM order, so this is automatic).
- For SR clarity, you can wrap each row in a `<dt>`/`<dd>` pair inside a single `<dl>` — but the prototype's `<div>` structure is fine because each row carries its own label and number naturally.
- Bar colours are decorative. The segment label communicates which row is which; don't rely on colour alone.
- Title is plain text, not an `<h2>` in the prototype. If this panel is its own region, wrap the title in `<h3>` (or `<h4>` if `<TopClients />` already used `<h3>`) to make the rail navigable by heading.

## Edge cases

- **Zero clients in a segment:** still render the row with `count: 0` and a bar at `pct: 0` (visually no fill). Hiding zero-segments would change the panel's height frame-to-frame as the dataset shifts, which is jarring.
- **All-zero (no clients yet):** render the four rows at zero — the panel reads as an empty "structure" of the contractor's eventual book. Same reasoning as above.
- **Custom segment IDs (e.g. user-defined tags):** out of scope for v1. The four built-in segments are the entire surface area.
- **Segment with > 99 count:** `.cseg2-row__num` has `min-width: 24px`; three digits fits at 12 px / 800 weight without breaking the row layout. Stress-test at 999 → 4-digit rendering needs `min-width: 32px`.
- **Reduced motion:** the bar's 1 s ease-bounce should snap. Honour `prefers-reduced-motion: reduce` and disable the transition.
