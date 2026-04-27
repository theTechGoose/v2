# `Sparkline` — Tiny SVG line + area chart primitive

## Purpose

Reusable SVG mini-chart. Takes an array of numbers, computes min/max, draws a line through them with a soft gradient-filled area below. Renders a small dot at the last data point. No axes, no labels, no tooltips. Intended for "$ this month" trend strips, KPI sparkbars, etc. Defined in the prototype (`Dashboard.html:2294–2337`) and imported into `Hero` (in some variants), but **the current Dashboard.html `Hero` doesn't render it** — keep the primitive ready for use in analytics + the mobile pkpis row.

## Source

- JSX: `Paperwork Monsters Dashboard.html` lines **2294–2337**

## JSX (verbatim)

```jsx
const Spark = ({ values, w = 240, h = 50, color = '#519843' }) => {
  const max   = Math.max(...values);
  const min   = Math.min(...values);
  const range = (max - min) || 1;

  const path = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 6) - 3;
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');

  const area  = path + ` L ${w} ${h} L 0 ${h} Z`;
  const lastV = values[values.length - 1];
  const lastY = h - ((lastV - min) / range) * (h - 6) - 3;
  const id    = 'spk' + Math.random().toString(36).slice(2, 7);

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"
         style={{display:'block', width:'100%'}}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.32"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`}/>
      <path d={path} stroke={color} strokeWidth="2" fill="none"
            strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx={w} cy={lastY} r="4" fill="#fff" stroke={color} strokeWidth="2"/>
    </svg>
  );
};
```

The `id` random string isolates each gradient (`<defs>` would collide otherwise when two Sparks render on the same page). Keep this pattern.

## Geometry walkthrough

- **x:** evenly distribute over `w`. 12 values → x = 0, w/11, 2w/11, …, w
- **y:** scale from min→max within [3, h-3] (the `-6` and `-3` are top/bottom padding so the dot doesn't clip)
- **area:** the line path + a `L w h L 0 h Z` closes the shape down to the bottom edge
- **gradient:** vertical, color@32% at top fading to color@0 at bottom
- **dot:** white-fill, 2 px-stroke circle at the last data point

## Preact / Fresh translation

```tsx
// v2/frontend/components/ui/Sparkline.tsx — server component
import { useId } from "preact/hooks";

export function Sparkline(props: {
  values: number[];
  w?: number; h?: number;
  color?: string;
}) {
  const { values, w = 240, h = 50, color = 'var(--brand-green, #519843)' } = props;
  if (values.length < 2) return null;

  const max   = Math.max(...values);
  const min   = Math.min(...values);
  const range = (max - min) || 1;

  const path = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 6) - 3;
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');

  const area  = path + ` L ${w} ${h} L 0 ${h} Z`;
  const lastV = values[values.length - 1];
  const lastY = h - ((lastV - min) / range) * (h - 6) - 3;
  const id    = useId();        // SSR-stable

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"
         style="display:block;width:100%" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color={color} stop-opacity="0.32" />
          <stop offset="100%" stop-color={color} stop-opacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={path} stroke={color} stroke-width="2" fill="none"
            stroke-linecap="round" stroke-linejoin="round" />
      <circle cx={w} cy={lastY} r="4" fill="#fff" stroke={color} stroke-width="2" />
    </svg>
  );
}
```

`Math.random()` for the gradient `id` is replaced with `useId()` so SSR and client agree (otherwise hydration warns about a mismatch).

## Props

```ts
type SparklineProps = {
  values: number[];
  w?: number;        // default 240
  h?: number;        // default 50
  color?: string;    // CSS color or var()
};
```

## Data source

Caller-supplied. For the dashboard's anticipated use ("$ billed by month, last 12 months"), the value comes from `GET /analytics/dashboard` → `revenue.sparkline12mo: number[]`.

## Island vs server

**Server.** No JS — pure SVG.

## Accessibility

- `aria-hidden="true"` on the SVG — sparklines are decorative summaries; for SR users, expose the data textually nearby (e.g., "Up 24% vs last month").
- For analytics pages, consider a separate `<table class="sr-only">` with the same data so SR users can read the values.

## Edge cases

- **`values.length < 2`:** can't draw a line — return `null`.
- **All values identical (`range === 0`):** fallback `range = 1` keeps the y-coordinates inside the box (renders a flat line in the middle).
- **Negative values:** the formula handles them — the chart auto-scales to its own range.
- **Very long arrays (>500):** SVG path with 500 commands is fine. Browsers handle it.
- **Color from CSS var:** `'var(--brand-green)'` works in `stroke=` and `stop-color=` attrs in modern browsers. For older browsers, pass the hex.
- **Re-renders:** `useId` is stable per component instance, so the gradient id doesn't churn between renders.
- **Last-point dot positioning:** if the last value is the max or min, the dot sits at the top/bottom edge — the `r=4` may clip slightly. The `-6 / -3` padding mitigates this.
