# ClientsBoard

The interactive heart of `/clients`: a toolbar (search + filter chips + sort)
above a responsive grid of editorial "client cards", each with a tap-to-open
slide-up detail panel. A 280px right rail (leaderboard + segment mix) is slotted
in as `children`.

## 1. Classification & behavior
- **Bucket:** `island` (`islands/ClientsBoard.tsx`).
- **Interaction tier:** `island` (client-only state). Pure client-side filter +
  search + open/close over a frozen `cards` prop — no fetch of its own.
- **Client state owned:**
  - `filter: FilterId` (`"all" | ClientStatus`) — active chip. **URL-synced:**
    seeded from `?segment=` on mount (`filterFromSearch`), written back via
    `history.pushState({segment}, "", url)` on chip click (omits the param for
    `"all"`), and re-read on `popstate` (browser back/forward re-applies it).
    This is real routing-via-querystring, NOT a reload — good.
  - `query: string` — live search text (substring match across name /
    businessName / email / phoneNumber / address / notes).
  - `openId: string | null` — which card's detail panel is expanded (one at a
    time). Closed on outside-click (document listener) and on `Escape`.
- **Data source:** the backend's `CustomerCard[]` via the `cards` prop — passed
  down from the `ClientsPage` island (which fetched `/clients`). ClientsBoard
  does **no fetching, no seed, no derivation the backend already owns**
  (`status`, `balanceCents`, `daysSinceContact` arrive precomputed). All
  display mapping (gradient palette, status chip text, story line, CTA verb,
  since-badge tier, balance formatting, address fallback) is done through the
  shared **`lib/clients-display.ts`** helpers (copied to `js/clients-display.ts`):
  `moodFor`, `initialsOf`, `segmentLabel`, `storyLineFor`, `ctaFor`,
  `balanceDisplay`, `addressFor`, `sinceBadge`.
- **Honest-empty:** when `rows.length === 0` it renders `.ccards2__empty` with
  either `clientsBoard.empty.noClients` (the roster is genuinely empty) or
  `clientsBoard.empty.noMatches` (filter/search hides everything) — the branch
  is chosen by `cards.length === 0`. Filter chip counts always render (incl. 0).
- **Liveness:** none. No polling/websocket. The `cards` prop is a frozen
  snapshot from the parent's single on-mount fetch.
- **Anti-patterns:** none in this island. (The whole-page-island /
  `location.reload` concern lives one level up in `ClientsPage`, not here.) It
  correctly uses `pushState`/`popstate` rather than reloading on filter change.
- **Data-shape hazards:**
  - **Per-status filter counts** (`filterCounts`, a `useMemo` that loops `cards`
    and increments `counts[c.status]++`) are recomputed client-side from the
    frozen array. Cheap here (≤ a few dozen cards), but the SAME counts on a
    real backend are status-bucket aggregates over the whole roster — see
    data-model.md hazard #6 (status-bucketed counters; don't scan per visit).
    The seed encodes the identical pattern as `CLIENTS.filter(...).length`.
  - `c.status` is assumed to be exactly one of the six `FilterId`s; any other
    value silently fails to increment any bucket (the `counts[c.status]++` would
    write an untracked key) — relies on the backend honoring the union.
  - Search is a plain client-side `.includes` over the already-loaded array
    (fine), so it can't find clients beyond the fetched page if pagination is
    ever added.

## 2. Anatomy
```
<>  (fragment — no wrapper element)
  <div class="ctoolbar2">
    <div class="ctoolbar2__search">
      <I search/> <input placeholder=… value=query onInput=setQuery/>
    </div>
    <div class="ctoolbar2__filters">
      {FILTER_DEFS.map(f =>
        <button class="ctoolbar2__filter [--active]" aria-pressed onClick=selectFilter>
          {label} <span class="ctoolbar2__filter-count">{count}</span>
        </button>)}
    </div>
    <button class="ctoolbar2__sort">Warmth <I chevDown/></button>   ← STATIC (no handler)
  </div>

  <div class="clay2">                                ← two-pane grid (1fr + 280px)
    <div class="ccards2">                            ← auto-fill minmax(300px,1fr)
      {rows.map((c,i) => <ClientCard .../>)}
      {rows.length===0 && <div class="ccards2__empty">{empty copy}</div>}
    </div>
    <div class="cside2">{children}</div>             ← right-rail slot (TopClients + ClientsSegments)
  </div>
</>

ClientCard (local sub-component):
<div class="ccard2 [ccard2--open]" style="--mood-*; animation-delay:{i*35}ms" onClick=onCardClick>
  <div class="ccard2__mood">                          ← gradient banner
    <div class="ccard2__mood-tex"/>
    <SinceBadge days unit/>                            ← giant ghost number
    <div class="ccard2__status"><dot/> {mood.label}</div>
    {vip && <div class="ccard2__crown"><I crown/></div>}
  </div>
  <div class="ccard2__av">{initials}</div>             ← overlapping avatar tile
  <div class="ccard2__body">
    <h3 class="ccard2__name"/> [<div class="ccard2__biz"/>]
    <div class="ccard2__seg">{seg} · {lastWhenRel}</div>
    <p class="ccard2__story">{storyLine}</p>           ← clamped to 4 lines
  </div>
  <div class="ccard2__foot">
    <button class="ccard2__nudge">{cta} <arrow→></button>   ← STATIC (no handler)
    <div class="ccard2__bal-wrap"><lbl>Balance</lbl><val class=…>{balance}</val></div>
  </div>

  <div class="ccard2__panel" onClick=stopPropagation>   ← absolute, slides up when --open
    <div class="ccard2__panel-head"> av + name/biz/seg·mood + <button x onClick=onClose/> </div>
    <div class="ccard2__panel-rows">
      [phone <a tel:>] [email <a mailto:>] [address (always; static div)]
    </div>
    <div class="ccard2__panel-actions">
      <button>Message</button> <button --pink>Open card</button>   ← both STATIC
    </div>
  </div>
</div>
```
- **Icon dependency:** `I` + `ICN.{search,crown,x,phone,mail,pin,arrow,msg,eye}`
  from `lib/dash-icons.tsx` (copied to `js/dash-icons.tsx`). The sort caret uses
  an inline `<path d="m6 9 6 6 6-6"/>`.
- **Sub-components:** `ClientCard` and `SinceBadge` are defined in the same file
  (not exported) — spec'd here, not as separate folders.

## 3. Props
| name | type | default | widget | signal? |
|---|---|---|---|---|
| `cards` | `CustomerCard[]` (required) | — | (data) | no |
| `children` | `ComponentChildren` | `undefined` | (slot — right rail) | no |
| `lang` | `"en" \| "es"` | `"en"` | select | no |

`ClientCard` (internal) props: `c: CustomerCard`, `idx: number`,
`isOpen: boolean`, `onOpen()`, `onClose()`, `lang`. `SinceBadge` (internal):
`days: number`, `lang`.

## 4. States → cases
| state | meaning | case |
|---|---|---|
| default | full roster (12 seed cards), filter "all", nothing open | `cases/default/default.json` |
| filtered-owes | "Owe you" chip active → only `status:"owes"` rows | `cases/filtered-owes/filtered-owes.json` |
| search | query narrows the grid to matches | `cases/search/search.json` |
| card-open | one card's detail panel expanded (`ccard2--open`) | `cases/card-open/card-open.json` |
| empty-no-clients | `cards=[]` → "No clients yet…" empty cell | `cases/empty-no-clients/empty-no-clients.json` |
| empty-no-matches | non-empty roster but filter/search hides all | `cases/empty-no-matches/empty-no-matches.json` |
| es | Spanish UI language | `cases/es/es.json` |

## 5. Events
- `capture(page)`: `e.source === "button.ctoolbar2__filter" && e.type === "click"`
  → `selectFilter(id)`; updates `filter`, pushes `?segment=` (or deletes it for
  `all`).
- `capture(page)`: `e.source === "input" (in .ctoolbar2__search) && e.type === "input"`
  → `setQuery`; live-filters the grid.
- `capture(page)`: `e.source === "div.ccard2" && e.type === "click"` (not on
  `.ccard2__foot`/`.ccard2__panel`) → `onOpen` → sets `openId`.
- `capture(page)`: `e.source === "button.ccard2__panel-x" && e.type === "click"`
  → `onClose`.
- `capture(page)`: `document click outside .ccard2` OR `keydown Escape` →
  `setOpenId(null)`.
- `capture(page)`: `window popstate` → re-applies `filter` from URL.
- **STATIC / no handler (decorative for now):** `.ctoolbar2__sort` ("Warmth"),
  `.ccard2__nudge` (the CTA verb), `.ccard2__panel-act` ×2 ("Message",
  "Open card"). FLAG: these read as actions but are inert — wire them on rebuild.

## 6. Motion (extracted from clients.css)
- **Card hover:** `transform: translateY(-4px)` + deepened mood-tinted shadow
  over `320ms` (`transform` uses `--ease-bounce`, shadow `--ease-out`). Disabled
  when `--open` (`.ccard2--open:hover { transform:none }`).
- **Detail panel slide-up:** `transform: translateY(8% → 0)` over `380ms
  var(--ease-bounce)` + `opacity 0 → 1` over `240ms var(--ease-out)`; toggled by
  the `.ccard2--open` class. `pointer-events` flips none→auto.
- **Status dot:** `pulse-dot 2.4s infinite` (opacity 1↔0.4).
- **Close (x) button:** `transform: rotate(90deg)` on hover (`--dur-fast`).
- **Nudge arrow / panel-row arrow:** `translateX(2px)` on hover (`--dur-fast`).
- **DEAD KEYFRAME — `@keyframes ccard2-editorial-in`:** declared in clients.css
  but **never applied**. The card markup sets only `animation-delay:{i*35}ms`
  inline with no `animation-name`, so the staggered entrance never plays (a
  delay alone is inert). **Jank/fix:** add
  `animation: ccard2-editorial-in 420ms var(--ease-out) backwards;` to `.ccard2`
  so the inline per-card delay produces the intended cascade; gate it behind the
  global reduced-motion clamp. (Until then the cards just appear instantly.)
- **Reduced motion:** clients.css has **no** component-local reduced-motion block
  — it relies on the global tokens-CSS clamp (`animation/transition-duration →
  0.01ms !important`). Verify hover lift, panel slide, and pulse all still under
  the clamp.

## 7. Responsive (this component's own @media in clients.css)
- **`max-width:1100px`:** `.clay2` collapses to a single column (the right rail
  drops below the cards).
- **`max-width:768px`:** `.ccards2` → 1 column; `.ctoolbar2` → 1 column (search,
  filters, sort stack); `.ctoolbar2__filters` becomes horizontally scrollable
  (`overflow-x:auto`).
- Card grid itself is intrinsically responsive via
  `repeat(auto-fill, minmax(300px, 1fr))` above those breakpoints.

## 8. A11y
- Filter chips are real `<button>`s with `aria-pressed={active}` — good.
- **Gaps:**
  - The card is a `<div onClick>` (not a button) with no role/tabindex/key
    handler — the open interaction is mouse-only and not keyboard-operable; the
    expanded panel is not announced. Rebuild: make the card (or a header button
    inside it) keyboard-activatable with `aria-expanded`/`aria-controls`.
  - The detail panel has no focus trap and isn't a dialog; Escape closes it
    (good) but focus isn't moved in/out.
  - Search `<input>` has a `placeholder` but no associated `<label>`.
  - The since-badge giant number is decorative (`pointer-events:none;
    user-select:none`) — fine, but its day/week meaning isn't exposed to AT.

## 9. Used on
- `/clients` only. Mounted by the `ClientsPage` island (`islands/ClientsPage.tsx`)
  via `<ClientsBoard cards={cards} lang={lang}>…rail…</ClientsBoard>`. Evidence:
  sole import of `ClientsBoard` is in `islands/ClientsPage.tsx`. CSS lives in
  `static/clients.css` (loaded by `routes/clients/index.tsx` `<Head>`).
