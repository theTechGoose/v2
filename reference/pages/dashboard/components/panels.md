# Dashboard panels — `ActiveJobs`, `QuotesAwaiting`, `Outstanding`, `Activity`

> Four content panels under the KPI strip share the `.panel` primitive (white card, header strip, body of cards). Documenting them together here. If they get more divergent, split into per-file docs later.

## Layout

```
.content
├── .grid           ← 2-col below KPIs
│   ├── <ActiveJobs>           § 1
│   └── <QuotesAwaiting>       § 2
└── .grid           ← 2-col, second row
    ├── <Activity>             § 3
    └── <Outstanding>          § 4
```

## Shared `.panel` primitive (CSS — read inline `<style>` for the canonical rules)

```css
.grid {
  display: grid; grid-template-columns: 1.4fr 1fr;
  gap: 16px; margin-bottom: 16px;
}
.panel {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 18px 20px;
  display: flex; flex-direction: column;
}
.panel__head {
  display: flex; align-items: center; gap: 12px;
  margin-bottom: 14px;
}
.panel__title {
  font-family: var(--font-heading); font-weight: 800;
  font-size: 15px; color: var(--brand-teal);
  margin: 0; letter-spacing: -0.01em;
}
.panel__count {
  font-size: 11px; font-weight: 800;
  background: var(--green-50); color: var(--green-600);
  padding: 3px 9px; border-radius: 999px;
  font-family: var(--font-heading); letter-spacing: 0.04em;
}
.panel__action {
  margin-left: auto;
  font-family: var(--font-heading); font-weight: 700;
  font-size: 12px; color: var(--brand-pink);
  text-decoration: none;
}
.panel__action:hover { text-decoration: underline; }
```

Below 1024 px: `.grid { grid-template-columns: 1fr }` — panels stack.

---

## §1 `ActiveJobs`

### Source

JSX: `Paperwork Monsters Dashboard.html` lines **2460–2502** (data: 2460–2466; component: 2468–2502).

### Static seed

```js
const JOBS = [
  { client:'Maple Grove Apartments', task:'Re-roof — building C', amount:'$4,800',
    paid:'$2,400 paid', pct:50, due:'Today',     icon: ICN.hardhat,
    color:'var(--brand-green)',  status:{kind:'green',  txt:'On track'} },
  { client:'Sarah Chen',             task:'Bathroom remodel',     amount:'$8,200',
    paid:'$3,000 paid', pct:36, due:'Wed',        icon: ICN.wrench,
    color:'var(--brand-pink)',   status:{kind:'green',  txt:'Crew onsite'} },
  { client:'Marshall & Sons',        task:'Driveway repour',      amount:'$2,950',
    paid:'Deposit',     pct:18, due:'Fri',        icon: ICN.truck,
    color:'var(--coffee-500)',   status:{kind:'warn',   txt:'Awaiting permit'} },
  { client:'Jana Patel',             task:'Interior paint · 2BR', amount:'$1,650',
    paid:'Quoted',      pct:0,  due:'Mon Apr 29', icon: ICN.paint,
    color:'var(--brand-pink)',   status:{kind:'teal',   txt:'Scheduled'} },
  { client:'Cobblestone Cafe',       task:'Patio re-tile',        amount:'$3,400',
    paid:'$1,000 paid', pct:30, due:'Apr 30',     icon: ICN.ruler,
    color:'var(--brand-green)',  status:{kind:'green',  txt:'On track'} },
];
```

### JSX (verbatim)

```jsx
const ActiveJobs = () => (
  <div className="panel">
    <div className="panel__head">
      <div style={{display:'flex', alignItems:'center', gap:10, minWidth:0, overflow:'hidden'}}>
        <span className="hero__pill-dot" style={{position:'static', width:8, height:8}}/>
        <h3 className="panel__title">Active jobs</h3>
        <span className="panel__count">7 active</span>
      </div>
      <a className="panel__action" href="#">See all →</a>
    </div>
    {JOBS.map((j, i) => (
      <div className="job" key={i}>
        <div className="job__icon" style={{background: j.color}}>
          <I d={j.icon} size={18}/>
        </div>
        <div style={{minWidth:0}}>
          <div className="job__title-row">
            <h4 className="job__title">{j.client}</h4>
          </div>
          <div className="job__meta">
            {j.task} <span className="job__meta-dot"/> Due {j.due}
          </div>
          <div className="job__progress">
            <div className="job__progress-bar"
                 style={{width: `${j.pct}%`, background: j.color}}/>
          </div>
        </div>
        <div>
          <div className="job__amount">{j.amount}</div>
          <div className="job__amount-sub">{j.paid}</div>
        </div>
      </div>
    ))}
  </div>
);
```

### CSS (key rules — `.job`)

```css
.job {
  display: grid; grid-template-columns: auto 1fr auto;
  gap: 12px; padding: 12px 0;
  border-bottom: 1px dashed rgba(100,69,54,0.10);
}
.job:last-child { border-bottom: 0; padding-bottom: 0; }

.job__icon { width: 38px; height: 38px; border-radius: 11px;
             color: #fff;
             display: flex; align-items: center; justify-content: center; }

.job__title       { font-family: var(--font-heading); font-weight: 800;
                    font-size: 14px; color: var(--brand-teal); margin: 0;
                    letter-spacing: -0.01em; white-space: nowrap;
                    overflow: hidden; text-overflow: ellipsis; }
.job__meta        { font-size: 12px; color: var(--fg-muted);
                    margin-top: 2px;
                    display: flex; align-items: center; gap: 8px; }
.job__meta-dot    { width: 3px; height: 3px; border-radius: 999px;
                    background: var(--coffee-300); flex-shrink: 0; }
.job__progress    { margin-top: 8px; height: 4px; border-radius: 2px;
                    background: var(--mint-200); overflow: hidden; }
.job__progress-bar{ height: 100%; border-radius: 2px;
                    transition: width 400ms ease; }
.job__amount      { font-family: var(--font-heading); font-weight: 800;
                    font-size: 14px; color: var(--brand-teal); text-align: right; }
.job__amount-sub  { font-size: 11px; color: var(--fg-muted);
                    text-align: right; margin-top: 2px; }
```

### Data source

⚠️ **There is no `/jobs` endpoint in v2/backend yet.** The "job" concept is a synthesized view of:
- Quote with `status: 'accepted'` + a Contract with `status: 'signed'` + an Invoice with `status: 'pending'` for the same `customerId`.

Two options:
1. **Synthesize client-side:** fetch quotes/contracts/invoices and join in the frontend. Wasteful but fast to ship.
2. **Add a `/jobs` endpoint:** see `backend.md` §6 (lower priority — not in the build-out list yet). Add a `domain/coordinators/list-active-jobs.ts` that fans out across the existing stores and returns a `Job[]` shape.

For v1 launch, **prefer option 2** — synthesizing in the frontend means three round-trips per dashboard load. The endpoint is simple enough to add inside the Paperwork module.

Field mapping:
- `client` ← `Customer.name`
- `task` ← `Quote.summary`
- `amount` ← `Contract.totalAmount` (or `Quote.estimatedTotal`)
- `paid` ← computed: `Σ(invoice.amount where status='paid')` formatted as `"$X paid"` (or `"Deposit"` / `"Quoted"` for early states)
- `pct` ← computed: `paidAmount / totalAmount * 100`
- `due` ← `Contract.estimatedCompletionDate` formatted relatively
- `icon` ← matched to `Quote.summary` keyword (paint/wrench/hardhat/etc.) — this is heuristic; in production add a `Quote.tradeType` enum
- `color` ← derived from icon
- `status.txt` ← inferred from contract state

---

## §2 `QuotesAwaiting`

### Source

JSX: `Paperwork Monsters Dashboard.html` lines **2504–2539** (data: 2504–2509; component: 2511–2539).

### Static seed

```js
const QUOTES = [
  { client:'Tom & Linda K.',     desc:'Garage epoxy floor',     amt:'$3,400',
    sent:'Sent Mon · Viewed twice', hot:true  },
  { client:'Greenleaf HOA',      desc:'Common area paint',      amt:'$5,800',
    sent:'Sent Tue · Viewed', hot:false },
  { client:'Marcus Lin',         desc:'Kitchen backsplash',     amt:'$1,920',
    sent:'Sent today',       hot:false },
  { client:'Bayside Properties', desc:'4-unit gutter cleaning', amt:'$1,680',
    sent:'Sent 4 days ago',  hot:false, cold:true },
];
```

### JSX (verbatim)

```jsx
const QuotesAwaiting = () => (
  <div className="panel">
    <div className="panel__head">
      <h3 className="panel__title">Quotes awaiting signature</h3>
      <span className="panel__count" style={{background:'var(--coffee-50)', color:'var(--coffee-600)'}}>
        4 out · $12,800
      </span>
      <a className="panel__action" href="#" style={{marginLeft:'auto'}}>See all →</a>
    </div>
    {QUOTES.map((q, i) => (
      <div className="quote-item" key={i}>
        <div className="quote-item__row">
          <span className="quote-item__client">{q.client}</span>
          <span className="quote-item__amt">{q.amt}</span>
        </div>
        <div className="quote-item__sub" style={{display:'flex', alignItems:'center', gap:8}}>
          <span>{q.desc}</span>
          <span className="job__meta-dot"/>
          <span style={{
            color: q.hot ? 'var(--brand-green)'
                  : q.cold ? 'var(--pink-700)'
                  : 'var(--fg-muted)',
            fontWeight: q.hot || q.cold ? 700 : 500
          }}>
            {q.sent} {q.hot && '🔥'} {q.cold && '· cold'}
          </span>
        </div>
        <div className="quote-item__cta">
          <button className="qbtn qbtn--nudge"><I d={ICN.send} size={11}/> Nudge by text</button>
          <button className="qbtn qbtn--view"><I d={ICN.eye}  size={11}/> View quote</button>
        </div>
      </div>
    ))}
  </div>
);
```

### Data source

`GET /quotes?status=sent` (current v2 endpoint already supports filtering with a tweak — see `backend.md` §3.B). Per-quote view counts come from `GET /views/summary/quote/:id` (already exists in v2).

`hot` is computed: `views.count >= 2 && (Date.now() - quote.sentAt) < 3 days`.
`cold` is computed: `(Date.now() - quote.sentAt) > 4 days && views.count === 0`.

`Nudge by text` button calls `POST /quotes/:id/email` (or a future `POST /quotes/:id/sms` once SMS sending is wired). For v1 it can simply re-send the email via the existing endpoint with a follow-up message.

`View quote` opens `/quote/:id/public` in a new tab (the public view).

---

## §3 `Activity`

### Source

JSX: `Paperwork Monsters Dashboard.html` lines **2590–2620** (data: 2590–2598; component: 2600–2620).

### Static seed

```jsx
const ACTIVITY = [
  { icon: ICN.check, bg:'var(--green-50)', fg:'var(--green-600)',
    text: <><strong>Tom &amp; Linda K.</strong> opened your quote for the second time</>,
    time:'2 min ago' },
  { icon: ICN.send,  bg:'var(--pink-50)',  fg:'var(--pink-700)',
    text: <>You texted us "new job — paint kitchen for Marcus Lin". <strong>Quote drafted.</strong></>,
    time:'1 hr ago' },
  { icon: ICN.card,  bg:'var(--green-50)', fg:'var(--green-600)',
    text: <><strong>Cobblestone Cafe</strong> paid invoice #INV-198 — $1,000 deposit</>,
    time:'3 hr ago' },
  { icon: ICN.contract, bg:'var(--teal-50)', fg:'var(--teal-600)',
    text: <><strong>Sarah Chen</strong> e-signed the bathroom remodel contract</>,
    time:'Yesterday' },
];
```

### JSX (verbatim)

```jsx
const Activity = () => (
  <div className="panel">
    <div className="panel__head">
      <h3 className="panel__title">What we handled today</h3>
      <span style={{fontSize:11, color:'var(--fg-muted)', marginLeft:4}}>The monsters have been busy</span>
      <a className="panel__action" href="#" style={{marginLeft:'auto'}}>Full log →</a>
    </div>
    {ACTIVITY.map((a, i) => (
      <div className="activity-item" key={i}>
        <div className="activity-item__icon" style={{background:a.bg, color:a.fg}}>
          <I d={a.icon} size={14}/>
        </div>
        <div className="activity-item__text">
          {a.text}
          <div className="activity-item__time">{a.time}</div>
        </div>
      </div>
    ))}
  </div>
);
```

### Data source

`GET /notifications?limit=4`. Same source as the topbar `ActivityTicker`, just rendered as a stacked list instead of a single rotating chip.

Per-notification icon mapping by `type`:
- `quote_accepted` / `contract_signed` → `ICN.check` (green)
- `quote_sent` / `quote_drafted`       → `ICN.send` (pink)
- `invoice_paid`                       → `ICN.card` (green)
- `customer_replied`                   → `ICN.msg`  (teal)
- `invoice_overdue`                    → `ICN.clock`(pink)

---

## §4 `Outstanding`

### Source

JSX: `Paperwork Monsters Dashboard.html` lines **2541–2588**.

### JSX (verbatim — the structurally interesting parts; inline-styled rows are repetitive)

```jsx
const Outstanding = () => (
  <div className="money">
    <div className="money__head">
      <div>
        <div className="money__label">Money owed to you</div>
        <div className="money__amt">$<Ticker value={6420}/></div>
      </div>
      <button className="qbtn qbtn--nudge" style={{padding:'8px 14px', fontSize:12}}>
        <I d={ICN.send} size={12}/> Nudge all
      </button>
    </div>

    {/* Aging segmented bar */}
    <div className="money__bar">
      <div className="money__bar-seg" style={{width:'52%', background:'var(--brand-green)'}}/>
      <div className="money__bar-seg" style={{width:'30%', background:'var(--coffee-400)'}}/>
      <div className="money__bar-seg" style={{width:'18%', background:'var(--brand-pink)'}}/>
    </div>
    <div className="money__legend">
      <div className="money__legend-item">
        <span className="money__legend-dot" style={{background:'var(--brand-green)'}}/> Current $3,340
      </div>
      <div className="money__legend-item">
        <span className="money__legend-dot" style={{background:'var(--coffee-400)'}}/> 1–14 days $1,920
      </div>
      <div className="money__legend-item">
        <span className="money__legend-dot" style={{background:'var(--brand-pink)'}}/> Overdue $1,160
      </div>
    </div>

    {/* Per-invoice rows (3 hardcoded examples in prototype) */}
    <div style={{borderTop:'1px dashed rgba(100,69,54,0.15)', paddingTop:14, display:'flex', flexDirection:'column', gap:10}}>
      {/* repeat: Hilltop Diner $1,160 (overdue), Sarah Chen $1,920 (due 3d), Maple Grove $3,340 (due Apr 30) */}
    </div>
  </div>
);
```

### Data source

- Total + per-invoice rows: `GET /invoices?status=pending` (v2 endpoint to add the filter).
- Aging buckets computed client-side:
  - `current`  — `dueDate > today`
  - `1–14 days` — `today >= dueDate >= today - 14`
  - `overdue`   — `dueDate < today - 14`
- Bar widths = bucket totals normalized to 100%.
- `Nudge all` button POSTs to `POST /invoices/:id/email` for each invoice in the overdue bucket (or wires to a future `POST /invoices/nudge-overdue` batch endpoint).

---

## Preact / Fresh translation (shared scaffold)

```tsx
// v2/frontend/components/dashboard/Panel.tsx — server primitive
type PanelProps = preact.JSX.HTMLAttributes & {
  title: string;
  count?: string;
  countTone?: 'green'|'coffee'|'pink';
  actionHref?: string;
  actionLabel?: string;
  children: preact.ComponentChildren;
};
export function Panel({ title, count, countTone='green', actionHref, actionLabel='See all →', children, ...rest }: PanelProps) {
  return (
    <div class="panel" {...rest}>
      <div class="panel__head">
        <h3 class="panel__title">{title}</h3>
        {count && <span class={`panel__count panel__count--${countTone}`}>{count}</span>}
        {actionHref && <a class="panel__action" href={actionHref}>{actionLabel}</a>}
      </div>
      {children}
    </div>
  );
}
```

Then each panel becomes `<Panel title="…" count="…" actionHref="…">{ rows }</Panel>`. Each panel reads its own data either at SSR (single endpoint) or in a small island for live updates.

## Island vs server

All four panels: **server components** at SSR. If you want live updates (e.g., poll for new activity every 30s), wrap the body in a tiny island that re-fetches and replaces the rows.

## Accessibility

- Panels are `<section aria-labelledby="panel-N-title">` with the h3 carrying the matching id.
- "See all →" / "Full log →" links: `aria-label` if the destination is not obvious from context.
- The aging bar in Outstanding is a chart — wrap in `<div role="img" aria-label="Aging breakdown: $3,340 current, $1,920 1-14 days, $1,160 overdue">`.
- The progress bars on Active jobs need `role="progressbar"` + `aria-valuenow={pct}` + `aria-valuemin={0}` + `aria-valuemax={100}`.

## Edge cases

- **Empty list:** show a friendly empty state per panel ("No active jobs — quote your first → /assistant"). Don't render an empty `.panel` body.
- **Long client names:** the `.job__title` already has `text-overflow: ellipsis`. Tooltip via `title={fullName}`.
- **Icons heuristic on jobs:** until `Quote.tradeType` exists, fall back to `ICN.hardhat` for any unmatched.
- **Nudge button rate-limit:** clicking `Nudge by text` shouldn't spam — disable for 60s after click and surface a toast "Sent" / "Already sent in last hour".
- **Below 1024px:** `.grid` collapses; both panels in a row stack.
