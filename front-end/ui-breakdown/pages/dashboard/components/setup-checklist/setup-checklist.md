# SetupChecklist

The post-onboarding "finish setting up" card on the dashboard. It lists the
high-leverage profile items onboarding doesn't collect (logo, payment method,
insurance, address pieces, etc.), shows a completeness bar, and **self-hides**
once every item is done or the user dismisses it. Rendered between the
`.assistant-cta` banner and the KPIs by `DashboardPage`.

> **PROJECT FACT — no nav gate.** The product deliberately does NOT block
> navigation on profile completeness. Profile is collected *here*, on the
> dashboard, via this dismissible checklist — there is no `loadProfileGate`
> redirect, no onboarding wall. A rebuild MUST NOT reintroduce a redirect that
> forces the user to finish their profile before they can use the app. This card
> is the entire mechanism: opt-in nudges, fully skippable.

## 1. Classification & behavior
- **Bucket:** `island` (file lives in `islands/SetupChecklist.tsx`).
- **Interaction tier:** `island` — client-only state + one client fetch on
  mount. No server mutation here; the items are `<a href="/settings">` links that
  navigate to Settings where the actual editing happens.
- **Client state owned (`useState`):**
  - `snap: ProfileSnapshot | null` — the profile fetched on mount; `null` until
    it lands (and the whole island renders `null` while `null`).
  - `dismissed: boolean` — set `true` by the "Hide" button; **session-only, NOT
    persisted** (it returns on the next page load). FLAG: a refresh re-shows the
    card even after the user hid it — consider persisting to `localStorage`.
- **Data source:** `clients/profile.ts` → `profileClient.get()` →
  **`GET /profile`** (returns a `ProfileSnapshot`). Fetched in a mounted
  `useEffect([])` with an `alive` guard; `.catch(() => {})` swallows errors
  (a failed fetch leaves `snap` `null` → the island renders nothing, fails
  closed). It does NOT use `lib/dash-cache.ts` — it owns this read so the
  dashboard route stays SSR-clean and only pays for `/profile` when the checklist
  might actually show.
- **Honest-empty / self-hide (three render-null gates):**
  1. `!snap || dismissed` → `null` (still loading, or user hid it).
  2. After computing `items`, `remaining = items.filter(!done)`; if
     `remaining.length === 0` → `null` (everything done — card disappears).
  3. So the card only appears when the profile loaded AND at least one item is
     incomplete AND the user hasn't dismissed it.
- **Item completeness logic (per `ProfileSnapshot` field):**
  - `name` ← `snap.user.name?.trim()`
  - `biz` ← `snap.identity?.businessName?.trim()`
  - `email` ← `snap.user.email?.trim()`
  - `logo` ← `snap.identity?.logoFileId`
  - `address` ← `snap.address?.postal?.trim() || snap.address?.street?.trim()`
  - `payment` ← any `snap.identity?.acceptedPaymentMethods[*].enabled === true`
  - `insurance` ← `snap.insurance?.provider?.trim()`
  - `pct = round((done / total) * 100)` drives the bar + `aria-valuenow`.
- **Reactive language:** reads `langSignal.value` at render → re-localizes live
  on a Settings language flip. The `/profile` fetch is only for completeness
  data, not language.
- **Server mutations / PRG / flash:** none here. (Editing happens on `/settings`.)
- **`location.reload()`:** none. ✅
- **Liveness:** request-response, fetch-once-on-mount. No polling, no
  `setInterval`, no websocket. It does NOT re-fetch when the user returns from
  Settings — a freshly-completed item won't tick off until a full reload (the
  page is a fresh island mount on navigation, so in practice it re-fetches per
  visit).
- **Data-shape hazards:** all field reads are optional-chained + `?? null`
  guarded, tolerant of a partial `ProfileSnapshot` (`identity`/`address`/
  `insurance` can each be `null`). `acceptedPaymentMethods` is iterated with
  `Object.values(...).some(m => m?.enabled === true)` — tolerant of missing/
  partial method entries.

## 2. Anatomy
```
(snap === null || dismissed || remaining === 0) → null
else:
<section class="panel" aria-label="Finish setting up"          ← inline pink-gradient override
         style="padding:18px 22px;margin-bottom:18px;…pink gradient + 0.25 pink border">
  <div> (flex space-between, wrap)
    <div>
      <div> eyebrow "Setup checklist" (#d94e4e, .14em upper)
      <h3> "Finish setting up — {n} thing(s) left" (Nunito 800 18px teal)
    <button type=button aria-label="Hide checklist" onClick=setDismissed> "Hide"
  <div role="progressbar" aria-valuenow={pct} …>                ← 4px track, pink gradient fill
    <div style="width:{pct}%; transition:width 480ms">
  <ul style="grid auto-fit minmax(220px,1fr)">                  ← item grid
    <li> × 7 {
      <span aria-hidden>  ← 20px circle: green #519843 "✓" if done, faint teal empty if not
      <a href="/settings"> item.label (muted+400 if done, fg+600 if not)
    }
```
- **Slots/children:** none.
- **No icon dependency** — the check is a literal `"✓"` glyph, not an `ICN`.
- **Styling:** 100% inline; uses the shared `.panel` class as a shell then
  overrides it inline (pink gradient + pink border). See css/setup-checklist.css
  for the class-named equivalents.

## 3. Props
| name | type | default | control | signal? |
|---|---|---|---|---|
| — | — | — | — | — |

The island takes **no props** — the route mounts it bare (`<SetupChecklist />`).
All display data comes from the `/profile` fetch; language from `langSignal`.

## 4. States → cases
All data is client-fetched, so isolate models it via `_mocks` (the `GET /profile`
response). Dismiss is internal `useState` — model via `_signals`. Language via
`_signals`.

| state | meaning | case |
|---|---|---|
| partial | profile loaded, several items incomplete → card shows with a partial bar | `cases/partial/partial.json` |
| almost-done | only 1 item left → "…1 thing left" singular heading | `cases/almost-done/almost-done.json` |
| all-done | every item complete → renders `null` (card gone) | `cases/all-done/all-done.json` |
| loading | `snap === null` (fetch in flight) → renders `null` | `cases/loading/loading.json` |
| dismissed | user clicked "Hide" → renders `null` (session-only) | `cases/dismissed/dismissed.json` |

## 5. Events
- `ev.expect(e => e.source === "button[aria-label='Hide checklist']" && e.type === "click")`
  → sets `dismissed=true` → card unmounts (NOT persisted; returns next load).
- `ev.expect(e => e.source === "a[href='/settings']" && e.type === "click")` →
  nav `/settings` (each item row is a link to Settings).
- No emitted custom events; no form submit; no fetch on click.

## 6. Motion (extracted — setup-checklist.css)
- **The only motion is the progress fill:** the `role="progressbar"` inner div
  has `transition: width 480ms` (linear; no named easing). When `pct` changes
  (e.g. an item completes between renders), the bar slides to the new width over
  480ms.
- No `@keyframes`. No hover effects. The card is otherwise static.
- **Jank finding:** none of note — a single `width` transition on a 4px bar is
  cheap (it does trigger layout on the fill element, but the track is fixed-size
  so no surrounding reflow).
- **Reduced motion:** no component-local override; the **global tokens `@media
  (prefers-reduced-motion: reduce)`** clamps the 480ms width transition to
  `0.01ms`.

## 7. Responsive (own @media)
- **None of its own.** The item grid is intrinsically responsive via
  `grid-template-columns: repeat(auto-fit, minmax(220px, 1fr))` — it reflows from
  multi-column to single-column as the container narrows, with no media query.
  The header row uses `flex-wrap: wrap` so "Finish setting up…" and "Hide" stack
  on very narrow widths.

## 8. A11y
- `<section aria-label="Finish setting up">` landmark; the bar is a proper
  `role="progressbar"` with `aria-valuemin/max/now` + an `aria-label`.
- "Hide" is a real `<button>` with `aria-label="Hide checklist"`.
- Each item is a real `<a href>` (keyboard-operable). The check bubble is
  `aria-hidden` (decorative); the label text conveys done/not-done only via color
  + font-weight — **GAP:** completion isn't exposed to SR beyond the visible "✓"
  (which is aria-hidden). Consider `aria-label` on the link including
  "(done)"/"(to do)" or a visually-hidden status word.
- Reduced motion handled globally (see Motion).

## 9. Used on
**`/dashboard` only.** Imported by `islands/DashboardPage.tsx`
(`import SetupChecklist from "./SetupChecklist.tsx"`) and rendered once, between
the assistant banner and the KPIs. Not shared. This is the sole profile-collection
surface — there is no separate onboarding gate (see PROJECT FACT above).
