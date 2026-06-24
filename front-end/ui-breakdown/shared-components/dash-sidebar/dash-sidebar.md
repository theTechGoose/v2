# DashSidebar

App-shell left navigation rail. First child of `<div class="app">`. Renders on
all 11 authenticated routes.

## 1. Classification & behavior
- **Bucket:** `island` (file lives in `islands/DashSidebar.tsx`).
- **Interaction tier:** `island` (client-only state) + cross-island event bus.
- **Client state owned:**
  - `collapsed: boolean` — desktop rail width toggle, persisted to
    `localStorage["pm:sb-collapsed"]` (`"1"`/`"0"`), seeded from it on mount.
  - `mobileOpen: boolean` — mobile drawer open/closed (not persisted).
  - `s: SbState` — `{ counts, identity, lang, superAdmin }` projected from the
    shared dashboard cache.
- **Data source per region:**
  - Counts (clients/quotes/contracts/invoices badges), identity (display name,
    business, initials), language, superAdmin flag → **`lib/dash-cache.ts`**
    (`readCached()` seeds first paint synchronously; `refreshDash()` fetches;
    `subscribeDash()` keeps it in lockstep with sibling islands). The cache is
    fed by `clients/dashboard.ts` (`/analytics/dashboard` + profile). Counts use
    *active* totals only: `clients=customers`, `quotes=quotes.sent`,
    `contracts=contracts.signed`, `invoices=invoices.pending`.
  - Nav entries are a hard-coded `NAV` array (home/clients/quotes/contracts/
    invoices/payments) + a super-admin-only Admin entry.
- **Honest-empty:** a badge is omitted unless `count != null && count > 0` — a
  fresh account shows no pills (deliberate; an empty pill "looks broken").
  `identity` block is omitted entirely until a name or business exists.
- **Server mutations:**
  - Logout → `POST /api/auth/logout` then `globalThis.location.href = "/"`. This
    is a logout *navigation* (cookie cleared), not a refresh-after-mutation, so
    the full nav is acceptable; flash feedback is N/A.
- **Cross-island coupling (ANTI-PATTERN, minor):** listens for a global
  `pm:sb-toggle` CustomEvent (dispatched by `DashTopbar`'s hamburger) to drive
  collapse (desktop, `innerWidth >= 641`) or the drawer (mobile). This is an
  event-bus instead of a shared signal — fragile if either island fails to
  hydrate. Fix: lift `collapsed`/`mobileOpen` into a shared `@preact/signals`
  store both islands import, removing the string-keyed window event.
- **Liveness:** request-response. No websocket, no polling here (counts refresh
  is push-driven via `subscribeDash`, plus one `refreshDash()` on mount).
- **Reactivity:** reads `langSignal.value` so the whole rail re-localizes
  instantly when Settings flips language.
- **Data-shape hazards:**
  - `projectSidebar` tolerates `snap === null` (returns `INITIAL_STATE`).
  - Initials derivation: single-word name → first 2 chars upper; else first +
    last initial; falls back to `"•"`.
  - `showNav={false}` (accounts-manager view) renders the rail chrome with **no
    nav tabs** — counts still fetch but nothing badges.

## 2. Anatomy
```
<>  (fragment)
  {mobileOpen && <div class="sb-backdrop" onClick=close aria-hidden>}    ← mobile only
  <aside class="sb [sb--collapsed] [sb--open]">
    <div class="sb__inner">
      <a class="sb__brand" href="/dashboard">                            ← logo img + brand name
        <div class="sb__brand-logo"><img src="/logo-monster-card.png"/></div>
        <div class="sb__brand-text"><div class="sb__brand-name">{brand.name}</div></div>
      </a>
      <a class="sb__textus" href="/assistant">                           ← "My Assistant" CTA
        <div class="sb__textus-icon"><I crown/></div>
        <div class="sb__textus-text"><span>{nav.assistant}</span></div>
      </a>
      <div class="sb__divider" />
      {showNav && <nav class="sb__nav">                                  ← NAV.map → .nav-item
        a.nav-item[.nav-item--active] × 6 (icon + label + optional count pill)
        {superAdmin && a.nav-item → /admin (shield, "Admin", not i18n'd)}
      </nav>}
      <div class="sb__bottom">
        {identity && <a class="sb__footer" href="/settings">}            ← avatar initials + name/biz + chevron (INLINE-styled)
        <div class="sb__bottom-head"><button class="sb__toggle">         ← collapse/expand (hamburger+arrow glyph)
        <button class="nav-item nav-item--logout" onClick=logout>        ← logout
      </div>
    </div>
  </aside>
```
- **Slots/children:** none (no `children`); fully self-composed.
- **Icon dependency:** glyphs come from `lib/dash-icons.tsx` (`I` renderer +
  `ICN` map). Copied into `js/dash-icons.tsx`. Uses `ICN`:
  `home,user,quote,contract,invoice,pay` (nav), `crown` (assistant),
  `chev` (footer), `logout`, `shield` (admin); plus an inline hamburger+arrow
  `<path>` for the toggle.

## 3. Props
| name | type | default | control | signal? |
|---|---|---|---|---|
| `active` | string (`home\|clients\|quotes\|contracts\|invoices\|payments\|admin\|messages`) | `"home"` | select | no |
| `showNav` | boolean | `true` | boolean | no |

(Both are SSR props passed by the route. All other display data comes from the
client cache, not props.)

## 4. States → cases
| state | meaning | case |
|---|---|---|
| default | expanded rail, `active="home"`, counts present, identity present | `cases/default/default.json` |
| collapsed | `sb--collapsed` (84px rail, labels/counts/text hidden) | `cases/collapsed/collapsed.json` |
| active-quotes | `active="quotes"` highlights Quotes (green pill) | `cases/active-quotes/active-quotes.json` |
| empty | fresh account: no counts, no identity footer | `cases/empty/empty.json` |
| super-admin | Admin tab visible | `cases/super-admin/super-admin.json` |
| mobile-open | `<=640px`, drawer slid in + backdrop | `cases/mobile-open/mobile-open.json` |
| no-nav | `showNav={false}` (accounts-manager chrome only) | `cases/no-nav/no-nav.json` |

State is internal (`_signals`/`_innerHtml` not applicable to useState islands in
isolate — model via `localStorage` seed + viewport for collapsed/mobile, and via
mocked cache projection for counts/identity). Cases below set the props plus a
`_signals` hint for the projected `SbState` the harness should stub.

## 5. Events
- `ev.expect(e => e.source === "a.sb__brand" && e.type === "click")` → nav `/dashboard`.
- `ev.expect(e => e.source === "a.sb__textus" && e.type === "click")` → nav `/assistant`.
- `ev.expect(e => e.source === "a.nav-item" && e.type === "click")` → nav to item.href.
- `ev.expect(e => e.source === "button.sb__toggle" && e.type === "click")` →
  toggles `collapsed`, writes `localStorage["pm:sb-collapsed"]`.
- `ev.expect(e => e.source === "button.nav-item--logout" && e.type === "click")`
  → POST `/api/auth/logout`, then redirect `/`.
- `ev.expect(e => e.source === "div.sb-backdrop" && e.type === "click")` → `mobileOpen=false`.
- External: `globalThis` `pm:sb-toggle` (received) →
  `innerWidth>=641 ? toggle() : setMobileOpen(o=>!o)`.

## 6. Motion (extracted)
- **Rail width:** `transition: width 280ms cubic-bezier(.34,1.56,.64,1)`
  (bouncy ease) on `.sb` when toggling collapsed. **Jank finding:** animating
  `width` triggers layout on every frame; on slow devices the nav text reflows.
  Fix: keep `width` (rail must reserve real space) but `content-visibility`/
  `will-change: width` to hint compositing; labels already `display:none` on
  collapse so no clip-fade.
- **Toggle glyph:** `transform: rotate(180deg)` over `220ms` bounce when
  collapsed — chevron points right.
- **Assistant CTA hover:** `translateY(-2px) + brightness(1.05)` over `200ms` bounce.
- **`pm-assistant-shake` keyframes** exist (a periodic nudge) but **no selector
  currently assigns the animation** — the CTA does not shake at rest. Dead-ish
  keyframe; hover/focus + reduced-motion already null it.
- **Mobile drawer:** `transform: translateX(-100%→0)` over `240ms` bounce;
  backdrop `sbFadeIn` opacity `0→1` over `180ms` ease-out.
- **Reduced motion:** `.sb__textus { animation: none }` under
  `@media (prefers-reduced-motion: reduce)`. The width/transform transitions are
  additionally clamped to `0.01ms` by the global tokens reduced-motion block.

## 7. Responsive (this component's own breakpoints)
- **Breakpoint is 640px / 641px** — NOT the product-default 720px. Verify here.
- `> 640px` (desktop): static flex rail, 216px expanded / 84px collapsed.
- `<= 640px`: `position:fixed`, width 260px, translated off-canvas
  (`translateX(-100%)`); `.sb--open` slides it in; `.sb-backdrop` scrim appears.
  The parent `.app` switches to block/body-scroll on mobile (see app-shell).

## 8. A11y
- `<aside>` landmark; nav items are real `<a>`; toggle + logout are `<button>`.
- Toggle has dynamic `aria-label` (`sidebar.expand`/`sidebar.collapse`) +
  `title`. Backdrop is `aria-hidden`. Brand/assistant links have `title`.
- Footer avatar span is `aria-hidden` (initials are decorative; name follows).
- **Gaps:** the mobile drawer has no focus trap and no `Esc`-to-close; opening it
  doesn't move focus into the drawer. Active item relies on color/weight only —
  no `aria-current="page"` (add it for SR users).
- Reduced motion handled (see Motion).

## 9. Used on
Shared across **11 authenticated routes** (all import `islands/DashSidebar.tsx`):
`/dashboard`, `/clients`, `/quotes`, `/contracts`, `/invoices`, `/payments`,
`/settings`, `/assistant` (+ `/assistant/[threadId]`, `active="messages"`),
`/admin`, `/accounts-manager` (`showNav={false}`). Evidence: grep of `DashSidebar`
import across `routes/`. Shared — single source of app navigation.
