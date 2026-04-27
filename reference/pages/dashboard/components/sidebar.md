# `Sidebar` — Collapsible left navigation

## Purpose

Fixed-width left rail (~240px expanded, ~64px collapsed). Contains: brand mark, "My assistant" CTA (links to `/assistant`), main nav (Dashboard, Jobs, Clients, Quotes, Contracts, Invoices, Payments, Conversations) with badge counts, "Account" section header + Settings link, user-profile footer with avatar + business name + chevron menu trigger.

## Source

- JSX: `Paperwork Monsters Dashboard.html` lines **2241–2292**
- Inline CSS: Dashboard.html lines ~600–950 (`.sb`, `.sb__brand`, `.sb__textus`, `.sb__nav`, `.nav-item`, `.sb__footer`, etc.)
- Nav data: `NAV` array at lines **2230–2239**

## Static seed (verbatim — `Dashboard.html:2230–2239`)

```js
const NAV = [
  { id:'home',      icon:'home',     label:'Dashboard' },
  { id:'jobs',      icon:'hardhat',  label:'Jobs',          count: 7 },
  { id:'clients',   icon:'user',     label:'Clients' },
  { id:'quotes',    icon:'quote',    label:'Quotes',        count: 4 },
  { id:'contracts', icon:'contract', label:'Contracts' },
  { id:'invoices',  icon:'invoice',  label:'Invoices',      count: 3 },
  { id:'payments',  icon:'pay',      label:'Payments' },
  { id:'messages',  icon:'msg',      label:'Conversations', count: 2 },
];
```

## JSX (verbatim)

```jsx
const Sidebar = ({ collapsed, onToggle, active, setActive }) => (
  <aside className={`sb ${collapsed ? 'sb--collapsed' : ''}`}>
    <div className="sb__inner">

      <div className="sb__brand">
        <div className="sb__brand-logo">
          <img src={window.LOGO_DATA_URL} alt="" style={{width:30, height:30, objectFit:'contain'}}/>
        </div>
        <div className="sb__brand-text">
          <div className="sb__brand-name">Paperwork Monsters</div>
        </div>
      </div>

      <a className="sb__textus" href="Paperwork Monsters Assistant.html"
         title="My assistant — AI quote builder">
        <div className="sb__textus-icon"><I d={ICN.crown} size={18}/></div>
        <div className="sb__textus-text"><span>My assistant</span></div>
      </a>

      <div className="sb__divider"/>

      <nav className="sb__nav">
        {NAV.map(item => (
          <button
            key={item.id}
            className={`nav-item ${active === item.id ? 'nav-item--active' : ''}`}
            onClick={() => setActive(item.id)}
          >
            <span className="nav-item__icon"><I d={ICN[item.icon]} size={18}/></span>
            <span className="nav-item__label">{item.label}</span>
            {item.count != null && <span className="nav-item__count">{item.count}</span>}
          </button>
        ))}
        <div className="sb__label">Account</div>
        <button className={`nav-item ${active === 'settings' ? 'nav-item--active' : ''}`}
                onClick={() => setActive('settings')}>
          <span className="nav-item__icon"><I d={ICN.cog} size={18}/></span>
          <span className="nav-item__label">Settings</span>
        </button>
      </nav>

      <div className="sb__footer">
        <div className="sb__avatar">DR</div>
        <div className="sb__user-text">
          <div className="sb__user-name">Diego R.</div>
          <div className="sb__user-biz">Riley Roofing Co.</div>
        </div>
        <button className="sb__cog" aria-label="Account">
          <I d={<><path d="M6 9l6 6 6-6"/></>} size={14}/>
        </button>
      </div>

    </div>
  </aside>
);
```

## CSS (key rules — verbatim from Dashboard.html inline `<style>`)

The inline CSS is large; here are the load-bearing rules. **Read Dashboard.html lines 264–1745 for the full set.**

```css
.app           { display: grid; grid-template-columns: var(--sidebar-w) 1fr;
                 min-height: 100vh; background: var(--bg); }
.app:has(.sb--collapsed) { grid-template-columns: 64px 1fr; }

.sb            { background: #fff; border-right: 1px solid var(--border);
                 position: sticky; top: 0; height: 100vh; overflow-y: auto; }
.sb__inner     { display: flex; flex-direction: column; height: 100%;
                 padding: 16px 12px; gap: 4px; }

.sb__brand     { display: flex; align-items: center; gap: 10px;
                 padding: 4px 8px 12px; }
.sb__brand-logo{ width: 38px; height: 38px; border-radius: 11px;
                 background: var(--mint-200); display: flex;
                 align-items: center; justify-content: center; flex-shrink: 0; }
.sb__brand-name{ font-family: var(--font-heading); font-weight: 800;
                 font-size: 14px; color: var(--brand-teal);
                 letter-spacing: -0.01em; white-space: nowrap; overflow: hidden; }

/* "My assistant" big CTA chip ----------------------------------- */
.sb__textus    { display: flex; align-items: center; gap: 10px;
                 padding: 12px 12px;
                 background: linear-gradient(135deg, var(--brand-pink), var(--pink-600));
                 color: #fff; border-radius: 14px;
                 box-shadow: 0 8px 18px rgba(255,107,107,0.32);
                 text-decoration: none;
                 transition: transform 200ms var(--ease-bounce); }
.sb__textus:hover { transform: translateY(-1px); }
.sb__textus-icon { width: 28px; height: 28px; border-radius: 8px;
                   background: rgba(255,255,255,0.18);
                   display: flex; align-items: center; justify-content: center; }
.sb__textus-text { font-family: var(--font-heading); font-weight: 800; font-size: 13px;
                   white-space: nowrap; overflow: hidden; }

.sb__divider   { height: 1px; background: var(--border); margin: 12px 4px; }

.sb__nav       { display: flex; flex-direction: column; gap: 2px; flex: 1; }
.sb__label     { font-family: var(--font-heading); font-weight: 800;
                 font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase;
                 color: var(--fg-subtle); padding: 16px 12px 4px; }

.nav-item      { display: flex; align-items: center; gap: 12px;
                 padding: 9px 12px; border-radius: 10px;
                 font-family: var(--font-heading); font-weight: 600; font-size: 13.5px;
                 color: var(--fg-muted); background: transparent; border: 0;
                 cursor: pointer; width: 100%; text-align: left;
                 transition: all 120ms; position: relative; }
.nav-item:hover           { background: var(--mint-200); color: var(--brand-teal); }
.nav-item--active         { background: var(--green-50); color: var(--brand-green); }
.nav-item--active::before { content:''; position: absolute; left: -12px; top: 6px; bottom: 6px;
                            width: 3px; border-radius: 0 3px 3px 0; background: var(--brand-green); }
.nav-item__icon           { display: flex; align-items: center; justify-content: center; }
.nav-item__label          { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nav-item__count {
  background: var(--pink-100); color: var(--pink-700);
  font-size: 10px; font-weight: 800; padding: 2px 7px; border-radius: 999px;
  font-family: var(--font-heading); letter-spacing: 0.02em;
}

.sb__footer {
  display: grid; grid-template-columns: auto 1fr auto;
  gap: 10px; align-items: center;
  padding: 12px; margin-top: 8px;
  background: var(--mint-200); border-radius: 12px;
}
.sb__avatar    { width: 34px; height: 34px; border-radius: 10px;
                 background: var(--brand-teal); color: #fff;
                 font-family: var(--font-heading); font-weight: 800; font-size: 13px;
                 display: flex; align-items: center; justify-content: center; }
.sb__user-name { font-family: var(--font-heading); font-weight: 800;
                 font-size: 13px; color: var(--brand-teal); }
.sb__user-biz  { font-size: 11px; color: var(--fg-muted); margin-top: 1px; }
.sb__cog       { width: 28px; height: 28px; border-radius: 8px;
                 border: 0; background: rgba(0,0,0,0.04); color: var(--fg-muted);
                 cursor: pointer; }

/* ----- Collapsed state ----- */
.sb--collapsed .sb__brand-text,
.sb--collapsed .sb__textus-text,
.sb--collapsed .nav-item__label,
.sb--collapsed .nav-item__count,
.sb--collapsed .sb__user-text,
.sb--collapsed .sb__cog,
.sb--collapsed .sb__label                { display: none; }
.sb--collapsed .sb__textus               { justify-content: center; padding: 12px 0; }
.sb--collapsed .nav-item                 { justify-content: center; padding: 10px 0; }
.sb--collapsed .sb__footer               { justify-content: center; padding: 8px; }
```

## Preact / Fresh translation

```tsx
// v2/frontend/islands/Sidebar.tsx — island
import { useEffect, useState } from "preact/hooks";
import * as I from "../components/ui/icons.tsx";

type NavId = 'home'|'jobs'|'clients'|'quotes'|'contracts'|'invoices'|'payments'|'messages'|'settings';

type ServerProfile = { name: string; businessName: string; initials: string };
type ServerCounts  = { jobs: number; quotes: number; invoices: number; messages: number };

export function Sidebar(props: {
  active: NavId,
  profile: ServerProfile,
  counts:  ServerCounts,
}) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const stored = localStorage.getItem('sb_collapsed');
    if (stored) setCollapsed(stored === '1');
  }, []);
  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('sb_collapsed', next ? '1' : '0');
  }

  const NAV = [
    { id: 'home',      href: '/dashboard',          Icon: I.Home,     label: 'Dashboard' },
    { id: 'jobs',      href: '/dashboard/jobs',     Icon: I.Hardhat,  label: 'Jobs',          count: props.counts.jobs },
    { id: 'clients',   href: '/dashboard/clients',  Icon: I.User,     label: 'Clients' },
    { id: 'quotes',    href: '/dashboard/quotes',   Icon: I.Quote,    label: 'Quotes',        count: props.counts.quotes },
    { id: 'contracts', href: '/dashboard/contracts',Icon: I.Contract, label: 'Contracts' },
    { id: 'invoices',  href: '/dashboard/invoices', Icon: I.Invoice,  label: 'Invoices',      count: props.counts.invoices },
    { id: 'payments',  href: '/dashboard/payments', Icon: I.Pay,      label: 'Payments' },
    { id: 'messages',  href: '/dashboard/messages', Icon: I.Msg,      label: 'Conversations', count: props.counts.messages },
  ] as const;

  return (
    <aside class={`sb ${collapsed ? 'sb--collapsed' : ''}`}>
      <div class="sb__inner">
        <div class="sb__brand">
          <div class="sb__brand-logo"><img src="/logo-monster.png" alt="" width={30} height={30} /></div>
          <div class="sb__brand-text"><div class="sb__brand-name">Paperwork Monsters</div></div>
        </div>

        <a class="sb__textus" href="/assistant" title="My assistant — AI quote builder">
          <div class="sb__textus-icon"><I.Crown size={18} /></div>
          <div class="sb__textus-text"><span>My assistant</span></div>
        </a>

        <div class="sb__divider" />

        <nav class="sb__nav">
          {NAV.map(item => (
            <a key={item.id} href={item.href}
               class={`nav-item ${props.active === item.id ? 'nav-item--active' : ''}`}>
              <span class="nav-item__icon"><item.Icon size={18}/></span>
              <span class="nav-item__label">{item.label}</span>
              {item.count != null && <span class="nav-item__count">{item.count}</span>}
            </a>
          ))}
          <div class="sb__label">Account</div>
          <a href="/dashboard/settings"
             class={`nav-item ${props.active === 'settings' ? 'nav-item--active' : ''}`}>
            <span class="nav-item__icon"><I.Cog size={18}/></span>
            <span class="nav-item__label">Settings</span>
          </a>
        </nav>

        <div class="sb__footer">
          <div class="sb__avatar">{props.profile.initials}</div>
          <div class="sb__user-text">
            <div class="sb__user-name">{props.profile.name}</div>
            <div class="sb__user-biz">{props.profile.businessName}</div>
          </div>
          <button class="sb__cog" onClick={toggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            <I.Chevron size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
}
```

Note the **two key changes from the prototype:**
1. `<button>` with `onClick={setActive}` becomes `<a href="/dashboard/x">` — the Fresh route handles navigation; no client-side state for `active`. Pass `active` as a server prop derived from the request URL.
2. `setActive` is gone; `collapsed` is the only client state, persisted to `localStorage`.

## Props

```ts
type SidebarProps = {
  active: 'home'|'jobs'|'clients'|'quotes'|'contracts'|'invoices'|'payments'|'messages'|'settings',
  profile: { name: string, businessName: string, initials: string },
  counts:  { jobs: number, quotes: number, invoices: number, messages: number },
};
```

## Data source

- `profile` — `GET /profile` (see `backend.md` §3.C). Initials computed server-side from `name` (e.g., "Diego R." → "DR").
- `counts` — `GET /analytics/dashboard` (see `backend.md` §3.D). Specifically `quotes.draft + quotes.sent` for the quotes badge, `invoices.pending + invoices.overdue` for invoices, etc. The exact mapping depends on what "count" means per nav item — confirm with product before wiring (e.g. is "Jobs:7" all active jobs, or just unscheduled ones?).

## Island vs server

**Island.** The `collapsed` state needs client interactivity and `localStorage`. The rest could be server-rendered, but co-locating in one island is simpler.

## Accessibility

- `<aside>` carries an implicit `role="complementary"` — fine for sidebar nav.
- Wrap the nav in `<nav aria-label="Main">` so SR users can identify it.
- `nav-item--active` should also set `aria-current="page"`.
- Collapsed state hides labels visually but keep them in the DOM (don't `display: none` if SR needs them) — instead, when collapsed, add `aria-label={item.label}` to the `<a>` so SR announces the destination even though only the icon is visible.
- "My assistant" CTA needs `aria-label="My assistant — AI quote builder"` (the prototype's `title` doesn't reach SR users on tap).
- Sidebar toggle button at the bottom needs `aria-expanded={!collapsed}` and `aria-controls="sb-nav-id"`.

## Edge cases

- **No counts loaded:** render `null` for the badge; don't show "0".
- **Long business name** ("Riley Roofing & General Contracting LLC"): `.sb__user-biz` is `font-size: 11px` with no overflow rule — set `overflow: hidden; text-overflow: ellipsis; white-space: nowrap;` to clip.
- **Mobile (<768px):** sidebar should slide in from the left as an overlay, controlled by the topbar hamburger. Add a `sb--overlay` class with `position: fixed; left: 0; transform: translateX(-100%);` and toggle `transform: translateX(0)` when open.
- **Active route on first paint:** read from URL on the server (`url.pathname.startsWith('/dashboard/quotes')` → `active='quotes'`).
- **Logout:** the `.sb__cog` chevron at the bottom in the prototype is just decorative. In production, swap it for a small dropdown menu containing "Account settings", "Billing", "Logout" (calls `POST /auth/logout`).
