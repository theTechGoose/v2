# `Phone` — Mobile dashboard preview (decorative on desktop)

> **Decorative on desktop only.** This is a 380×760 iPhone-frame mockup that shows what the dashboard looks like on mobile. It's rendered side-by-side with the desktop view in the prototype to communicate intent. **In production it does NOT ship as a component on the desktop dashboard** — instead, the actual responsive layout shows on real phones. Document it as a *spec for the mobile responsive layout*.

## Source

- JSX: `Paperwork Monsters Dashboard.html` lines **2622–2762**
- Inline CSS: search Dashboard.html for `.phone`, `.phone__screen`, `.phone__notch`, `.phone__status`, `.phone__top`, `.phone__scroll`, `.phero`, `.pkpis`, `.pkpi`, `.psection-head`, `.pcard`, `.pjob`, `.ptabs`, `.ptab`, `.home-indicator`

## Layout

```
.phone
└── .phone__screen
    ├── .phone__notch                  ← top notch
    ├── .phone__status                 ← time + signal/wifi/battery
    ├── .phone__top                    ← avatar + greeting + bell
    ├── .phone__scroll                 ← scrollable content
    │   ├── .phero                     ← "2 wins today" pill + headline + CTA
    │   ├── .pkpis (4 mini stat cards) ← grid 2×2
    │   ├── psection: Money owed (3 invoices)
    │   └── psection: Quotes waiting (top 2 from QUOTES)
    ├── .ptabs                         ← bottom tab bar (Home / Jobs / [send] / Money / More)
    └── .home-indicator                ← bottom bar
```

## Key JSX excerpts (verbatim)

### Status bar + top greeting

```jsx
<div className="phone__notch"/>
<div className="phone__status">
  <span>9:41</span>
  <span className="phone__status-icons">
    <I d={ICN.signal}  size={13} sw={2.5}/>
    <I d={ICN.wifi}    size={13} sw={2.5}/>
    <I d={ICN.battery} size={15}/>
  </span>
</div>

<div className="phone__top">
  <div className="sb__avatar" style={{width:36, height:36, borderRadius:11, fontSize:12}}>DR</div>
  <div className="phone__top-greet">
    <div className="phone__top-greet-line">Tuesday</div>
    <div className="phone__top-greet-name">Hey, Diego 👋</div>
  </div>
  <button className="phone__bell">
    <I d={ICN.bell} size={15}/>
    <span className="phone__bell-dot"/>
  </button>
</div>
```

### Hero ("phero")

```jsx
<div className="phero">
  <div className="phero__decor"/>
  <div className="phero__win-chip">
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l2.39 7.36H22l-6.18 4.49L18.21 22 12 17.27 5.79 22l2.39-8.15L2 9.36h7.61z"/>
    </svg>
    2 wins today
  </div>
  <h2 className="phero__title">2 quotes <em>just got accepted</em>.</h2>
  <p className="phero__sub">Send a fresh one — text us the details and we'll handle it.</p>
  <a className="phero__cta" href="Paperwork Monsters Assistant.html"
     style={{textDecoration:'none'}}>
    <I d={ICN.crown} size={14}/> My assistant
  </a>
</div>
```

### Mobile KPIs (2×2 grid)

```jsx
<div className="pkpis">
  <div className="pkpi">
    <div className="pkpi__label">Active jobs</div>
    <div className="pkpi__val">7</div>
    <div className="pkpi__sub"><strong>▲ 2</strong> this week</div>
  </div>
  <div className="pkpi" style={{background: 'linear-gradient(165deg, var(--pink-50), #fff)'}}>
    <div className="pkpi__label">Money owed</div>
    <div className="pkpi__val">$6,420</div>
    <div className="pkpi__sub" style={{color:'var(--pink-700)'}}>1 invoice overdue</div>
  </div>
  <div className="pkpi">
    <div className="pkpi__label">Quotes out</div>
    <div className="pkpi__val">4</div>
    <div className="pkpi__sub">$12.8k in flight</div>
  </div>
  <div className="pkpi">
    <div className="pkpi__label">This month</div>
    <div className="pkpi__val">$18.4k</div>
    <div className="pkpi__sub"><strong>▲ 24%</strong> vs Mar</div>
  </div>
</div>
```

### Money owed list (3 hardcoded rows)

```jsx
<div>
  <div className="psection-head">
    <h3 className="psection-title">Money owed to you</h3>
    <span className="psection-link">All →</span>
  </div>
  <div className="pcard" style={{padding:'4px 14px'}}>
    {[
      { c: 'Hilltop Diner',     m: '11 days overdue · #INV-204', mc: 'var(--pink-700)',   mw: 700, a: '$1,160' },
      { c: 'Sarah Chen',        m: 'Due in 3 days · #INV-208',   mc: 'var(--coffee-500)', mw: 600, a: '$1,920' },
      { c: 'Maple Grove Apts.', m: 'Due Apr 30 · #INV-210',      mc: 'var(--green-600)',  mw: 600, a: '$3,340' },
    ].map((r, i) => (
      <div className="pjob" key={i} style={{gridTemplateColumns:'1fr auto'}}>
        <div>
          <h4 className="pjob__title">{r.c}</h4>
          <div className="pjob__meta" style={{color: r.mc, fontWeight: r.mw}}>{r.m}</div>
        </div>
        <div className="pjob__amt">{r.a}</div>
      </div>
    ))}
  </div>
</div>
```

### Quotes waiting (top 2 from `QUOTES`)

```jsx
<div>
  <div className="psection-head">
    <h3 className="psection-title">Quotes waiting</h3>
    <span className="psection-link">4 out →</span>
  </div>
  <div className="pcard" style={{padding:'4px 14px'}}>
    {QUOTES.slice(0, 2).map((q, i) => (
      <div className="pjob" key={i} style={{gridTemplateColumns:'1fr auto'}}>
        <div>
          <h4 className="pjob__title">{q.client}</h4>
          <div className="pjob__meta">
            {q.desc} · <span style={{
              color: q.hot ? 'var(--brand-green)' : 'var(--fg-muted)',
              fontWeight: q.hot ? 700 : 500
            }}>
              {q.hot ? 'Viewed twice 🔥' : q.sent.replace('Sent ','')}
            </span>
          </div>
        </div>
        <div className="pjob__amt">{q.amt}</div>
      </div>
    ))}
  </div>
</div>
```

### Bottom tab bar

```jsx
<div className="ptabs">
  <button className="ptab ptab--active">
    <span className="ptab__icon"><I d={ICN.home} size={18}/></span>
    Home
  </button>
  <button className="ptab">
    <span className="ptab__icon"><I d={ICN.hardhat} size={18}/></span>
    Jobs
  </button>
  <button className="ptab--text" aria-label="Just text us">
    <I d={ICN.send} size={22}/>
  </button>
  <button className="ptab">
    <span className="ptab__icon"><I d={ICN.invoice} size={18}/></span>
    Money
  </button>
  <button className="ptab">
    <span className="ptab__icon"><I d={ICN.user} size={18}/></span>
    More
  </button>
</div>
<div className="home-indicator"/>
```

The center `.ptab--text` is a different shape from the four side tabs — it's a pink filled circle that opens the assistant chat (the "fire off a fresh quote" CTA is the tab bar's center).

## CSS (key rules — read inline `<style>` for the canonical set)

The `.phone` rules in the prototype create a **realistic iPhone frame** with notch, status bar, scrollable body, and bottom tab bar. They include:

```css
.phone {
  width: 380px; height: 760px;
  background: #1a1a1a;
  border-radius: 48px;
  padding: 8px;
  box-shadow: 0 30px 60px rgba(100, 69, 54, 0.25), 0 0 0 1px rgba(0,0,0,0.05);
  position: relative;
}
.phone__screen {
  background: var(--mint-100);
  border-radius: 40px;
  height: 100%;
  display: flex; flex-direction: column;
  overflow: hidden;
  position: relative;
}
.phone__notch {
  position: absolute; top: 14px; left: 50%;
  transform: translateX(-50%);
  width: 110px; height: 28px; border-radius: 18px;
  background: #1a1a1a; z-index: 5;
}
.phone__scroll { flex: 1; overflow-y: auto; padding: 14px;
                 display: flex; flex-direction: column; gap: 16px; }

.ptabs {
  display: grid; grid-template-columns: repeat(5, 1fr);
  align-items: center; gap: 0;
  padding: 8px 0 14px;
  background: #fff;
  border-top: 1px solid var(--border);
}
.ptab        { display: flex; flex-direction: column; align-items: center; gap: 2px;
               background: transparent; border: 0; cursor: pointer;
               font-size: 10px; color: var(--fg-muted);
               font-family: var(--font-heading); font-weight: 700; }
.ptab--active{ color: var(--brand-green); }
.ptab__icon  { width: 28px; height: 28px; border-radius: 8px;
               display: flex; align-items: center; justify-content: center; }
.ptab--active .ptab__icon { background: var(--green-50); }
.ptab--text {
  width: 56px; height: 56px; border-radius: 999px;
  background: var(--brand-pink); color: #fff;
  display: flex; align-items: center; justify-content: center;
  border: 0; cursor: pointer;
  box-shadow: 0 8px 18px rgba(255,107,107,0.42);
  margin-top: -20px;
}
.home-indicator { width: 130px; height: 5px; border-radius: 3px;
                  background: #1a1a1a;
                  margin: 0 auto 6px; }
```

## How to translate this into the real mobile responsive layout

**Don't render `<Phone />` on desktop.** Instead:

1. **At ≤768px the dashboard layout switches**:
   - Hide `<Sidebar />`. Add a hamburger toggle in `<Topbar />` that slides the sidebar in as an overlay.
   - Replace `<Topbar />` with a smaller `phone__top`-style header: avatar + greeting + bell, no search.
   - Replace the desktop `<Hero />` with the `phero` variant (smaller, more punchy, with the win-chip and CTA).
   - Replace `<KpiCards />` (4 cols) with `pkpis` (2×2 grid).
   - Show **truncated** versions of the panels: top 3 invoices, top 2 quotes. Each section has a "All →" link to the full list page.
   - Hide `<Activity />` and `<Outstanding>`'s aging bar — surface them on dedicated routes (`/dashboard/activity`, `/dashboard/money`).
   - Add a fixed **bottom tab bar** (`.ptabs`) replacing the sidebar nav.

2. **At ≥769px the desktop layout shows**, no phone preview anywhere.

The bottom tab bar items map to:
- Home → `/dashboard`
- Jobs → `/dashboard/jobs`
- [Send center button] → `/assistant`
- Money → `/dashboard/money` (or `/dashboard/invoices`)
- More → `/dashboard/more` (or a drawer menu with Clients, Contracts, Settings, Logout)

## Props

```ts
type PhoneProps = {};   // No props if used as decoration on desktop.
                        // For the mobile responsive layout, each section reads from
                        // the same data source as its desktop counterpart — see panels.md.
```

## Data source

Same as the desktop dashboard — `GET /analytics/dashboard` + `GET /quotes?status=sent` + `GET /invoices?status=pending` + `GET /notifications?limit=4`.

## Island vs server

If shipping as desktop decoration: **server**. If used as the actual mobile responsive layout: each interactive piece (bottom tab bar active state, scroll position) is its own island.

## Accessibility

- Bottom tab bar should be `<nav aria-label="Mobile navigation">` with each `<a>` (not `<button>`) routing to its destination.
- `.ptab--active` should set `aria-current="page"`.
- The center send-button is a CTA, not a tab — make it visually distinct (already done) and use `<a href="/assistant" class="ptab--text" aria-label="Open AI assistant">`.
- Notch and home-indicator are decorative on a real device (the OS draws them), but in the desktop preview they're decoration → `aria-hidden="true"`.
- Status bar (9:41 + signal/wifi/battery icons) is decoration in the preview → `aria-hidden="true"`.

## Edge cases

- **Real iOS safe-area:** when shipping as the mobile layout, use `env(safe-area-inset-bottom)` so the home indicator doesn't overlap the tab bar.
- **Tab bar over keyboard:** on iOS, when the keyboard opens the bottom bar overlaps. Detect with `visualViewport.height` and hide.
- **Dark mode:** out of scope for v1. The mint-100 background reads light; a future `prefers-color-scheme: dark` would need a separate token mapping.
- **Notch on non-notched devices:** the prototype draws a notch unconditionally. On Android and older iPhones, skip the notch element.
- **Decorative chrome on mobile:** when this layout is the real layout (not a preview), drop `phone__notch` and `phone__status` — the OS provides them.
