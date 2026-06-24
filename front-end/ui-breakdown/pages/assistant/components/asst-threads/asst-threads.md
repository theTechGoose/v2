# AsstThreads

The conversation-list sidebar (left column) of the assistant workspace —
recency-grouped thread rows, an "unread event" pulse, a status chip per row, a
"New conversation" CTA, and a QuickBooks-style collapse-to-rail toggle.

## 1. Classification & behavior
- **Bucket:** `island` (`islands/AsstThreads.tsx`).
- **Interaction tier:** `island` (client-only state) **with live polling**.
- **Client state owned:**
  - `threads: Conversation[]` — seeded from the `initialThreads` prop (SSR), then
    replaced on every poll/focus/mount-sync by `assistantClient.conversations(50)`.
  - `collapsed: boolean` — rail/expanded; seeded from
    `localStorage["pm:threads-collapsed"]` (`"1"`/`"0"`), persisted on toggle.
    Side-effect: toggles `asst--threads-collapsed` on the **parent `.asst` grid**
    (via `asideRef.current.parentElement.classList.toggle`) so the grid's first
    column narrows to 64px — a DOM-reach-up, documented hazard below.
  - `lang` — read from `langSignal.value` during render (NOT the `lang` prop,
    which is an ignored SSR seed) so the list re-localizes live on a Settings
    language flip.
- **Data source:** `GET /agents/conversations?limit=50` via
  `assistantClient.conversations(50)`. The list re-fetches on a timer, on tab
  `visibilitychange→visible`, and once on mount.
- **Liveness — POLLING (flag):** `setInterval(refresh, POLL_MS)` where
  `POLL_MS = 8_000` (8s). This is how a customer accept-contract event (which sets
  `hasUnreadEvent` + bumps `updatedAt` server-side) surfaces here without a hard
  reload — the unread dot/badge appears within ≤8s. **No websocket** (the voice
  push path lives in AsstChat, not here). On a fetch error it keeps the last good
  list rather than blanking.
- **Honest-empty:** when `groups.length === 0` it renders
  `.threads__empty` ("No conversations yet" via `asstThreads.empty`). The
  `.threads__count` always shows `threads.length` (can be 0).
- **Anti-patterns:**
  - **8s poll** — acceptable for a low-frequency sidebar but a fixed-interval
    poll; a rebuild could move it to the same websocket the chat already holds.
  - **DOM reach-up:** mutates `parentElement.classList` instead of the parent
    owning the collapsed class. Brittle if the DOM nesting under `.asst` changes.
  - No `location.reload()`.
- **Data-shape hazards:**
  - `updatedAt` is normally an ISO-8601 string; `tsOf()` defensively also accepts
    a numeric epoch string and disambiguates seconds vs ms by magnitude
    (`<1e12 ⇒ ×1000`) so a seconds-epoch value doesn't render as "1970 → Nd ago".
  - `deriveChip` walks the chain **backwards** (invoice → contract → quote →
    phase) so the chip reflects the latest stage reached. It relies on the
    DENORMALIZED `quoteStatus` / `contractStatus` / `invoiceStatus` fields on
    Conversation (no N+1). Quote only ever reaches `"sent"` in this flow (customer
    acceptance is a contract event), so there is no quote-accepted branch.

## 2. Anatomy
```
<aside class="threads [threads--collapsed]" ref=asideRef>
  <div class="threads__head">
    <button class="threads__toggle" onClick=toggleCollapsed>   ← hamburger / collapse-arrow icon swaps on state
    <h3 class="threads__title">{t conversations}</h3>
    <span class="threads__count">{threads.length}</span>
  </div>
  <a href="/assistant" class="threads__new">                   ← New conversation (full SSR nav, not an island action)
    <I plus/> <span class="threads__new-label"/> <span class="threads__new-kbd">{⌘N}</span>
  </a>
  <div class="threads__list">
    EMPTY → <div class="threads__empty"/>
    else groups.map(group =>                                    ← Today / Yesterday / This Week / Earlier
      <div class="threads__group-label">{group.label}</div>
      group.items.map(c =>
        <a href="/assistant/{c.id}" class="thread [thread--active] [thread--unread]">
          <div class="thread__head">
            [hasUnreadEvent → <span class="thread__unread-dot"/>]
            <span class="thread__client">{customerName||title||t newConversation}</span>
            <span class="thread__time">{fmtTime(updatedAt)}</span>
          </div>
          <div class="thread__preview">{preview ?? "—"}</div>
          <div class="thread__chips"><span class="thread__chip thread__chip--{kind}">{label}</span></div>
        </a>))
  </div>
</aside>
```
- **Icon dependency:** `I` + `ICN.plus` from `lib/dash-icons.tsx` (copied to
  `js/dash-icons.tsx`); the toggle hamburger paths are inline `<path>`.
- **Recency grouping:** `groupByRecency()` buckets by `updatedAt` into Today /
  Yesterday (≥ today-1d) / This Week (≥ today-7d) / Earlier; empty buckets drop.
- **Time format:** `fmtTime()` → `"just now"` (<1m) · `"Nm"` (<1h) · `"Nh"`
  (<1d) · localized weekday (<7d) · `M/D` (older).

## 3. Props
| name | type | default | control | signal? |
|---|---|---|---|---|
| `initialThreads` | `Conversation[]` (required) | — | (json) | no — SSR seed, then replaced by poll |
| `activeId` | `string` | `undefined` | text | no |
| `lang` | `"en"\|"es"` | (ignored) | select | **ignored SSR seed** — island reads `langSignal.value` |

## 4. States → cases
| state | meaning | case |
|---|---|---|
| default | grouped list, one row active | `cases/default/default.json` |
| unread | a thread with `hasUnreadEvent` → pulsing dot + bold client | `cases/unread/unread.json` |
| collapsed | `threads--collapsed` rail (labels/list hidden) | `cases/collapsed/collapsed.json` |
| empty | `initialThreads=[]` → `.threads__empty` | `cases/empty/empty.json` |
| chip-variants | rows exercising draft/sent/paid/needs chips | `cases/chip-variants/chip-variants.json` |

> Isolate note: the poll will try to fetch `/agents/conversations` with no
> backend; in isolate it 404s/throws and `refresh()` swallows it, so the rows
> stay on the seeded `initialThreads`. Cases use real seed shapes from
> `lib/asst-seed.ts` (t1–t7) mapped onto the `Conversation` shape.

## 5. Events
- `ev.expect(e => e.source === "button.threads__toggle" && e.type === "click")`
  → toggles `collapsed`; writes `localStorage["pm:threads-collapsed"]`; toggles
  `asst--threads-collapsed` on the parent grid.
- Row click is a real `<a href="/assistant/{id}">` navigation (no island handler).
- "New conversation" is `<a href="/assistant">` navigation.

## 6. Motion (extracted)
- **Unread dot:** `@keyframes thread-pulse` — `box-shadow 0 0 0 0 → 0 0 0 6px`
  (green, fading alpha) over `1.6s ease-out infinite`. The only keyframe this
  component owns.
- **New CTA:** `transform: translateY(-1px)` on hover, `180ms`.
- **Row:** `background 140ms` on hover/active.
- **Reduced motion:** no component-local guard — relies on the global tokens
  reduced-motion clamp (`animation-duration: 0.01ms !important`). Verify the
  pulse stills.

## 7. Responsive
- The column is sized by the parent `.asst` grid (`280px` first column; `64px`
  when `asst--threads-collapsed` at ≥1201px). Below the threads-hidden
  breakpoint the column is removed by the page CSS, not by this island. Verify
  against assistant-page.css (`.asst` grid ~7806) + assistant.css (collapse
  ~3733). No `@media` queries are owned by this component itself.

## 8. A11y
- Toggle is a real `<button>` with `aria-label`/`title` that swap on state — good.
- Rows are `<a>` links — keyboard-operable.
- Unread dot has `aria-label` (`asstThreads.newEvent`).
- **Gap:** the recency group labels are plain `<div>`s, not list semantics; the
  list is not a `role="list"`/`listitem` structure. Minor.

## 9. Used on
Both assistant route variants: `routes/assistant/index.tsx` (no `activeId`) and
`routes/assistant/[threadId].tsx` (`activeId={threadId}`). CSS in
`static/assistant-page.css` (column/rows) + `static/assistant.css` (collapse).
