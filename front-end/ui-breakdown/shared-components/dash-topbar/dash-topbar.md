# DashTopbar

App-shell top bar: hamburger + date/greeting + live-activity ticker. First child
of `<main class="main">` on every authenticated route.

## 1. Classification & behavior
- **Bucket:** `island` (`islands/DashTopbar.tsx`).
- **Interaction tier:** `island` (client-only state) with **polling**.
- **Client state owned:**
  - `unread: number` (held via `setUnread`, currently not rendered — the bell/
    badge UI is hidden until built).
  - `items: Notification[]` — recent activity list for the ticker.
  - `tickerIdx: number` — rotation index.
  - Greeting date is computed inline each render from `new Date()` + `langSignal`.
- **Data source per region:**
  - Greeting name → `greetingName` prop (SSR). Date → computed client-side from
    `WEEKDAY_KEYS`/`MONTH_KEYS` via `tFor(lang, …)` so it re-localizes live.
  - Ticker items → `clients/dashboard.ts` `dashboardClient.notifications(10)`;
    unread → `dashboardClient.unreadCount()`. Seeded from `initialNotifications`
    / `initialUnread` SSR props.
- **Honest-empty:** when `items.length === 0`, `ticker` is `null` and the whole
  pill is omitted — NO seeded "Cobblestone Cafe paid $1,000" fallback (it read
  as fake first-run activity). Likewise search + notification affordances are
  intentionally not rendered until those features ship.
- **Liveness — polling (request-response, NOT pushed):**
  - `setInterval` every **30 000ms** → `unreadCount()`.
  - `setInterval` every **10 000ms** → `notifications(10)`.
  - `setInterval` every **3 800ms** → advance `tickerIdx` (rotate displayed item).
  - **FLAG:** the 10s notifications poll is aggressive for low-change data and
    runs on every authed page. Fix: back off (30–60s) or move to a single
    shared poller / SSE, since the same data feeds DashSidebar's cache.
- **Cross-island coupling:** hamburger dispatches a global
  `pm:sb-toggle` CustomEvent that `DashSidebar` listens for (collapse on desktop
  / drawer on mobile). Event-bus pattern — see DashSidebar spec for the
  shared-signal fix.
- **No server mutation, no `location.reload()`.**
- **Data-shape hazards:**
  - `greetingDate` prop is **`@deprecated` and ignored** — the date is computed
    in-component. Don't pass it expecting it to render.
  - Ticker title is injected via `dangerouslySetInnerHTML` (`ticker.html`) —
    server-derived markup (e.g. `<strong>…</strong>`), trusted, no user input.
    Rebuild must treat `Notification.title` as HTML, not text.
  - `greetingOverride` (used by the Assistant route) replaces the greeting line
    verbatim, bypassing the `dashTopbar.greeting` template.
  - `fmtAgo` clamps to `>=1m`; non-finite dates → `""`.

## 2. Anatomy
```
<header class="topbar">
  <button class="topbar__menu" aria-label="Toggle sidebar"            ← hamburger (inline 3-line path)
          onClick=dispatch('pm:sb-toggle')>
  <div class="topbar__greet">
    <div class="topbar__greet-line">{Weekday · Month D}</div>
    <div class="topbar__greet-name">{greetingOverride ?? "Hey, {name} 👋"}</div>
  </div>
  <div style="flex:1" aria-hidden />                                  ← spacer (pushes ticker right)
  {ticker && <a class="topbar__ticker" href="/dashboard#activity">    ← only when items exist
    <span class="topbar__ticker-dot" />                              ← pulsing green dot
    <span class="topbar__ticker-track" aria-live="polite">
      <span class="topbar__ticker-item" key={idx} dangerouslySetInnerHTML />
    </span>
    <span class="topbar__ticker-time">{time} ago</span>
  </a>}
</header>
```
- **Slots/children:** none. `.topbar__search`/`.topbar__btn` exist in CSS but are
  not rendered by this island.
- **Icon dependency:** uses the `I` renderer from `lib/dash-icons.tsx` with an
  inline `<path d="M3 6h18M3 12h18M3 18h18"/>` (hamburger) — no `ICN` lookup.
  `js/dash-icons.tsx` copied for self-containment.

## 3. Props
| name | type | default | control | signal? |
|---|---|---|---|---|
| `greetingName` | string (required) | — | text | no |
| `greetingDate` | string | — | text | no — **@deprecated/ignored** |
| `greetingOverride` | string | `undefined` | text | no |
| `initialUnread` | number | `0` | number | no |
| `initialNotifications` | `Notification[]` | `[]` | (json) | no |
| `lang` | `"en"\|"es"` | (reads `langSignal`) | select | no |

`Notification` shape: `{ title: string (HTML), createdAt: ISO string, … }`.

## 4. States → cases
| state | meaning | case |
|---|---|---|
| default | greeting + ticker with items | `cases/default/default.json` |
| empty | no notifications → ticker omitted | `cases/empty/empty.json` |
| override | `greetingOverride` line (Assistant route) | `cases/override/override.json` |
| es | Spanish greeting/date localization | `cases/es/es.json` |

## 5. Events
- `ev.expect(e => e.source === "button.topbar__menu" && e.type === "click")` →
  dispatches `CustomEvent("pm:sb-toggle")`.
- `ev.expect(e => e.source === "a.topbar__ticker" && e.type === "click")` → nav
  `/dashboard#activity`.
- Internal timers (not user events): unread poll 30s, notifications poll 10s,
  ticker rotate 3.8s.

## 6. Motion (extracted)
- **Ticker dot:** `tickerPulse` 1.6s ease-in-out infinite — expanding
  box-shadow halo `0→6px` then fade.
- **Ticker item swap:** `tickerSlideIn` 360ms `--ease-bounce` — `opacity 0→1` +
  `translateY(8px→0)`. Re-keyed by `tickerIdx` so each rotation re-triggers.
  **Jank finding:** the item is `position:absolute; inset:0`; on swap the new
  item animates in but the old one is replaced (Preact key change), so there's
  no cross-fade overlap — clean. The pulsing dot's `box-shadow` animation paints
  on the main thread but is tiny; acceptable.
- **Hamburger / ticker hover:** `translateY(-1px)` over 160/180ms.
- **Reduced motion:** no component-local block; relies on the global tokens
  reduced-motion clamp (`animation/transition-duration: 0.01ms`). Verify the
  pulse + slide are effectively stilled.

## 7. Responsive
- **Breakpoint 640px** (own CSS). `<=640px`: `.topbar` becomes
  `position:sticky; top:0` with a more opaque mint background; `.topbar__ticker`
  and `.topbar__search` are `display:none` (only hamburger + greeting remain);
  greeting-name shrinks to 14px. Above 640px: static 60px bar, ticker visible
  (max-width 280px, right-aligned).

## 8. A11y
- `<header>` landmark; hamburger is a `<button>` with `aria-label` (i18n
  `dashTopbar.toggleSidebar`). Ticker is an `<a>` with `aria-label`
  (`dashTopbar.liveActivity`); the rotating text region is `aria-live="polite"`
  so SR users hear new activity. Spacer div is `aria-hidden`.
- **Gaps:** ticker injects HTML via `dangerouslySetInnerHTML`; ensure server
  markup stays SR-friendly. No reduced-motion-specific handling locally.

## 9. Used on
Shared across the same **11 authenticated routes** as DashSidebar (every page
that renders the app-shell `<main>`): dashboard, clients, quotes, contracts,
invoices, payments, settings, assistant (+ `[threadId]`, uses `greetingOverride`),
admin, accounts-manager. Evidence: grep of `DashTopbar` import in `routes/`.
Shared — single app top bar.
