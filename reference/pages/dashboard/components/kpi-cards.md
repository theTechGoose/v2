# `KpiCards` — Four-tile KPI strip

## Purpose

Four equally-sized white tiles in a row below the Hero. Each has a colored icon box (top-left), a small label, a large value, and a delta line (one of: `up`, `warn`, `neutral` styling). Currently the four tiles are: **Active jobs** (green), **Outstanding** (pink), **Quotes pending** (coffee), **Avg. job size** (teal).

## Source

- JSX: `Paperwork Monsters Dashboard.html` lines **2434–2458**
- Inline CSS: Dashboard.html — search `.kpis`, `.kpi`, `.kpi__icon`, `.kpi__label`, `.kpi__val`, `.kpi__delta`

## JSX (verbatim)

```jsx
const Kpis = () => {
  const items = [
    { icon: ICN.hardhat, ic_bg: 'var(--green-50)',  ic_fg: 'var(--green-600)',
      label: 'Active jobs',    val: '7',
      sub: 'on the books',     delta: { kind:'up',      txt:'▲ 2' } },
    { icon: ICN.invoice, ic_bg: 'var(--pink-50)',   ic_fg: 'var(--pink-700)',
      label: 'Outstanding',    val: '$6,420',
      sub: '4 invoices',       delta: { kind:'warn',    txt:'1 overdue' } },
    { icon: ICN.quote,   ic_bg: 'var(--coffee-50)', ic_fg: 'var(--coffee-600)',
      label: 'Quotes pending', val: '4',
      sub: '$12.8k in flight', delta: { kind:'neutral', txt:'2 viewed' } },
    { icon: ICN.trend,   ic_bg: 'var(--teal-50)',   ic_fg: 'var(--teal-600)',
      label: 'Avg. job size',  val: '$2,830',
      sub: 'last 30 days',     delta: { kind:'up',      txt:'▲ 8%' } },
  ];
  return (
    <section className="kpis">
      {items.map(k => (
        <div className="kpi" key={k.label}>
          <div className="kpi__icon" style={{background: k.ic_bg, color: k.ic_fg}}>
            <I d={k.icon} size={18}/>
          </div>
          <div className="kpi__label">{k.label}</div>
          <div className="kpi__val">{k.val}</div>
          <div className={`kpi__delta kpi__delta--${k.delta.kind}`}>
            <strong>{k.delta.txt}</strong><span className="kpi__delta-sub">{k.sub}</span>
          </div>
        </div>
      ))}
    </section>
  );
};
```

## CSS (key rules)

```css
.kpis {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}
.kpi {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 16px;
  display: flex; flex-direction: column; gap: 6px;
  transition: all 200ms;
}
.kpi:hover { border-color: var(--border-strong); }

.kpi__icon {
  width: 36px; height: 36px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 4px;
}
.kpi__label {
  font-family: var(--font-heading); font-weight: 700;
  font-size: 12px; color: var(--fg-muted);
  text-transform: uppercase; letter-spacing: 0.06em;
}
.kpi__val {
  font-family: var(--font-heading); font-weight: 800;
  font-size: 26px; color: var(--brand-teal);
  letter-spacing: -0.02em; line-height: 1.05;
}
.kpi__delta {
  font-size: 11px; display: flex; gap: 6px; align-items: baseline;
  margin-top: 2px;
}
.kpi__delta strong       { font-family: var(--font-heading); font-weight: 800; }
.kpi__delta--up strong    { color: var(--brand-green); }
.kpi__delta--warn strong  { color: var(--pink-700); }
.kpi__delta--neutral strong { color: var(--fg-muted); }
.kpi__delta-sub          { color: var(--fg-muted); }
```

Below 1024px the grid drops to `repeat(2, 1fr)`; below 600px → 1 column.

## Preact / Fresh translation

```tsx
// v2/frontend/components/dashboard/KpiCards.tsx — server component
import * as I from "../ui/icons.tsx";

type Kind = 'up' | 'warn' | 'neutral';
type Tile = {
  Icon: (p: { size?: number }) => preact.JSX.Element;
  iconBg: string;     // tailwind bg- class
  iconFg: string;     // tailwind text- class
  label: string;
  val: string;
  sub: string;
  delta: { kind: Kind; txt: string };
};

export function KpiCards(props: { stats: import('../../lib/types.ts').DashboardStats }) {
  const s = props.stats;
  const items: Tile[] = [
    {
      Icon: I.Hardhat, iconBg: 'bg-green-50',  iconFg: 'text-green-600',
      label: 'Active jobs',    val: String(s.activeJobs ?? 0),
      sub: 'on the books',     delta: { kind: 'up', txt: `▲ ${s.activeJobsDelta ?? 0}` }
    },
    {
      Icon: I.Invoice, iconBg: 'bg-pink-50',   iconFg: 'text-pink-700',
      label: 'Outstanding',
      val: '$' + (s.invoices.pending + s.invoices.overdue).toLocaleString('en-US'),
      sub: `${s.invoices.pending + s.invoices.overdue} invoices`,
      delta: { kind: 'warn', txt: `${s.invoices.overdue} overdue` }
    },
    {
      Icon: I.Quote, iconBg: 'bg-coffee-50', iconFg: 'text-coffee-600',
      label: 'Quotes pending', val: String(s.quotes.sent),
      sub: `$${(s.quotedValue / 1000).toFixed(1)}k in flight`,
      delta: { kind: 'neutral', txt: `${s.quotes.viewedCount ?? 0} viewed` }
    },
    {
      Icon: I.Trend, iconBg: 'bg-teal-50', iconFg: 'text-teal-600',
      label: 'Avg. job size',  val: '$' + (s.avgJobSize ?? 0).toLocaleString('en-US'),
      sub: 'last 30 days',     delta: { kind: 'up', txt: `▲ ${s.avgJobSizeDeltaPct ?? 0}%` }
    },
  ];

  return (
    <section class="kpis">
      {items.map(k => (
        <div class="kpi" key={k.label}>
          <div class={`kpi__icon ${k.iconBg} ${k.iconFg}`}><k.Icon size={18} /></div>
          <div class="kpi__label">{k.label}</div>
          <div class="kpi__val">{k.val}</div>
          <div class={`kpi__delta kpi__delta--${k.delta.kind}`}>
            <strong>{k.delta.txt}</strong>
            <span class="kpi__delta-sub">{k.sub}</span>
          </div>
        </div>
      ))}
    </section>
  );
}
```

## Props

```ts
type KpiCardsProps = { stats: DashboardStats };

type DashboardStats = {
  activeJobs: number;
  activeJobsDelta: number;
  invoices: { pending: number; overdue: number; paid: number; total: number };
  quotes:   { draft: number; sent: number; accepted: number; viewedCount?: number; total: number };
  quotedValue: number;        // sum of estimatedTotal across quotes.status === 'sent'
  avgJobSize: number;
  avgJobSizeDeltaPct: number;
  // …plus the fields needed by Hero (revenue, etc.) — see Hero.md
};
```

## Data source

Single fetch: `GET /analytics/dashboard` (see `backend.md` §3.D). The endpoint returns the full `DashboardStats` shape; Hero + KpiCards + Phone preview all read from the same payload.

## Island vs server

**Server.** No JS — values are renderered at SSR.

## Accessibility

- Each tile is a `<div>` not a button — neutral. If clicking should drill into the relevant section (e.g., Outstanding → /dashboard/invoices?status=overdue), wrap each in `<a href>`.
- `kpi__icon` needs `aria-hidden="true"`.
- The `▲` / `▼` Unicode arrows in the delta are decoration; consider replacing with `<I.ArrowUp />` / `<I.ArrowDown />` for consistency.
- Heading hierarchy: KpiCards has no heading — the section is purely "stats". OK if Hero owns the page h1.

## Edge cases

- **All zeros (new user):** show a friendly empty state inside each tile or hide the row entirely. Recommend hiding for fresh signups; show after first quote sent.
- **Wide monetary values** (`$1,234,567`): use `Intl.NumberFormat('en-US', { notation: 'compact' })` → `$1.2M`. Tooltip shows full value.
- **Below 1024px:** grid 4 → 2 cols. Below 600px → 1 col, full-width.
- **Hover:** `kpi:hover` bumps border. On touch, no effect (acceptable).
- **Tile click destinations:** active jobs → `/dashboard/jobs`, outstanding → `/dashboard/invoices?status=overdue`, quotes pending → `/dashboard/quotes?status=sent`, avg → `/dashboard/analytics` (future).
- **Loading state:** during navigation use a skeleton (gray bars) for `val` and `delta`; keep label + icon. Avoid the empty-string flash.
