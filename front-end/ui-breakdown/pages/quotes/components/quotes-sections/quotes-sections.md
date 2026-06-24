# QuotesSections

The six **server-rendered (static)** sections of `/quotes`, exported as separate
functions from one module: `QuotesHero`, `QuotesKpis`, `DecidedRow`, `QSideBig`,
`QSideRate`, `QSideTip`. The interactive bits (track collapse, card flip, delete)
live in islands; these are pure presentational components the page island
composes.

## 1. Classification & behavior

- **Bucket:** `static` / **page-composition** (`components/QuotesSections.tsx`).
  These are plain function components (no `useState`/effects/signals) — they
  render from props and are composed by `islands/QuotesPage.tsx`.
- **Interaction tier:** **static** — no client state of their own. Every value is
  a prop passed down from the page island (which owns the fetch). The one
  interactive element they *embed* is `DeleteQuoteButton` (icon variant) inside
  `DecidedRow` — an island.
- **Server action + flash:** none. No forms, no PRG here. (The embedded
  `DeleteQuoteButton` does the client-fetch + reload — flagged in its own spec;
  `DecidedRow` just places it.) The `QuotesHero` `.qph__cta` "New quote" button
  is a `type="button"` with **no `onClick`** — a **dead stub** (no handler
  anywhere; rebuild should wire it to the new-quote flow or remove it).
- **Island client-state + refresh:** N/A (static). They re-render only when the
  parent island re-renders (language flip / reload).
- **`location.reload()` FLAG:** not here — but `DecidedRow` embeds
  `<DeleteQuoteButton variant="icon">`, which reloads on delete. Flagged
  transitively (see delete-quote-button spec).
- **Data source:** none — all props. The parent (`QuotesPage`) derives them from
  `GET /quotes` (the `QuoteCard[]` → presentational `Quote[]`) +
  `/analytics/quotes/win-rate` + `/insight`.
- **Honest-empty:** **QuotesHero owns the empty state** — `empty = openCount===0`
  renders the "Nothing in the pipeline yet." headline + empty sub, hiding the
  money/stale copy. `QuotesKpis` shows `0`/`—` cells. `QSideBig` renders an empty
  `.qbig` list if `open=[]`. `QSideRate` shows `—` + "needs more" copy below the
  confidence threshold. `QSideTip` falls back to `quotesTip.default` when no
  insight text. So the section set degrades gracefully to a coherent empty page.
- **Liveness:** none.
- **Reactivity / i18n:** every label via `tFor(lang, …)`; a local `tnFor(lang,
  key, n)` helper does explicit-language plural picking (mirrors the reactive
  `tn()` but honors the resolved `lang` prop instead of `langSignal`, because
  these are SSR components).
- **Data-shape hazards:**
  - **Money is CENTS.** `outValue`/`openTotal`/`q.value` all flow into `fmtMoney`
    (cents). The parent's `mapCard` puts `estimatedTotal` (cents) into
    `q.value` — consistent. (The static seed literals are dollars; the live
    `mapCard` path is cents — see quote-card spec's unit hazard. Cases here use
    CENTS.)
  - **Win-rate confidence threshold.** `WIN_RATE_MIN_N = 5`: below 5 decided
    quotes the percentage is suppressed to `—` in BOTH `QuotesKpis` (gates the
    `qkpi__val`) and `QSideRate` (gates the gauge arc + number), showing a
    breakdown/"need N more" instead. A real one-accept "100%" is deliberately
    hidden until N≥5. Two components encode the same threshold — keep them in
    sync on rebuild.
  - **`QSideRate` recomputes its own pct** from `won/lost` props
    (`Math.round(won/decided*100)`), independent of the `winRate` value
    `QuotesKpis` receives — two slightly different rate computations on the same
    page (the KPI trusts the endpoint's `winRate`; the gauge recomputes). Verify
    they agree.
  - **`QSideBig` sorts by `value` desc and slices top 4**; `max = top4[0].value`
    drives the bar widths (`value/max*100%`). Empty `open` → `max=1` guard avoids
    div-by-zero.
  - **`DecidedRow` `when`** uses `decidedDays ?? 0`; `1 → "yesterday"`, else
    `"{n}d ago"`. A `decidedDays:0` would read "0d ago" (no "today" string).
  - **`QSideTip` is fully inline-styled** (teal gradient, white text, no class) —
    the only section without a CSS class hook.

## 2. Anatomy

```
QuotesHero ({openCount, openTotal, staleCount, clientCount, lang})
  <div class="qph">
    <div>
      <div class="qph__eyebrow"><span dot/> {eyebrow}</div>
      {empty   → <h1 class="qph__title"><em>{emptyLine1}</em><br/>{emptyLine2}</h1> + <p qph__sub>{emptySub}</p>}
      {allWarm → <h1><em>{fmtMoney(openTotal)}</em> {warmTitle}</h1> + warmSub}
      {else    → <h1><em>{fmtMoney(openTotal)}</em> {staleTitle(quotes,verb)}</h1> + staleSub(<strong>{staleCount}</strong>)}
    </div>
    <button class="qph__cta" type=button>{<I plus/>} {cta}</button>   ← DEAD STUB (no onClick)
  </div>

QuotesKpis ({outValue,outCount,draftCount,decidedCount,wonCount,lostCount,winRate,lang})
  <div class="qkpi"> 4× .qkpi__cell (first --accent):
    [Out for response → fmtMoney(outValue) / "{outCount} waiting"]
    [Drafting        → {draftCount} / sub]
    [Decided         → {decidedCount} / "{won} won · {lost} lost"]
    [Win rate        → {decided>=5 ? "{winRate}%" : "—"} / contextual sub]

DecidedRow ({q, lang})
  <div class="qdone__row">
    <div class="qdone__badge qdone__badge--{won|lost}"><I {check|x}/></div>
    <div><div qdone__title>{q.title}</div><div qdone__client>{q.client}</div></div>
    <div class="qdone__amt [qdone__amt--lost]">{fmtMoney(q.value)}</div>
    <div class="qdone__when">{when}</div>
    <DeleteQuoteButton id={q.id} variant="icon"/>                    ← [island]
  </div>

QSideBig ({open, lang})  → .qside__card > .qbig (top-4 by value, each row + .qbar fill)
QSideRate ({won, lost, lang}) → .qside__card > .qrate (SVG arc gauge + number/labels; gated by N≥5)
QSideTip ({text?, lang}) → inline-styled teal card (insight text ?? default)
```
- **Slots/children:** none — props only.
- **Icon dependency:** `I` + `ICN.plus`/`ICN.check`/`ICN.x` from
  `lib/dash-icons.tsx` (copied to `js/dash-icons.tsx`).
- **Embeds:** `DeleteQuoteButton` (icon variant) in `DecidedRow` [island].

## 3. Props

`QuotesHero`: `openCount:number`, `openTotal:number /*CENTS*/`,
`staleCount:number`, `clientCount:number`, `lang?:"en"|"es"`.
`QuotesKpis`: `outValue:number /*CENTS*/`, `outCount`, `draftCount`,
`decidedCount`, `wonCount`, `lostCount`, `winRate:number`, `lang?`.
`DecidedRow`: `q:Quote`, `lang?`.
`QSideBig`: `open:Quote[]`, `lang?`.
`QSideRate`: `won:number`, `lost:number`, `lang?`.
`QSideTip`: `text?:string`, `lang?`.

(`Quote` = the presentational seed shape from `lib/quotes-seed.ts` — see
quote-card spec §3.)

## 4. States → cases

| state | meaning | case |
|---|---|---|
| hero-stale | QuotesHero with stale quotes (money + "needs a nudge" copy) | `cases/hero-stale/hero-stale.json` |
| hero-warm | QuotesHero, all warm (no stale) | `cases/hero-warm/hero-warm.json` |
| hero-empty | QuotesHero honest-empty ("Nothing in the pipeline yet.") | `cases/hero-empty/hero-empty.json` |
| kpis-confident | QuotesKpis, decided≥5 → real win-rate % | `cases/kpis-confident/kpis-confident.json` |
| kpis-not-enough | QuotesKpis, decided<5 → "—" + "need more" | `cases/kpis-not-enough/kpis-not-enough.json` |
| decided-won | DecidedRow won (green badge, amount) | `cases/decided-won/decided-won.json` |
| decided-lost | DecidedRow lost (coffee badge, struck-through amount) | `cases/decided-lost/decided-lost.json` |
| side-rate-confident | QSideRate gauge filled (N≥5) | `cases/side-rate-confident/side-rate-confident.json` |
| side-rate-low | QSideRate "—" (N<5) | `cases/side-rate-low/side-rate-low.json` |
| es | Spanish labels across hero+kpis | `cases/es/es.json` |

> Isolate note: this is page-composition — `fixture.json` lists the embedded
> `components` and each case names which section + the props that section
> renders. Because the exports are separate functions, a case targets one
> section at a time (its `_name` says which); the props are bare. `DecidedRow`
> cases include the embedded `DeleteQuoteButton` (icon).

## 5. Events

- No own events (static). Transitively:
  - `ev.expect(e => e.source === "button.qph__cta" && e.type === "click")` → **no
    handler** (dead stub) — assert it does nothing.
  - `ev.expect(e => e.source === "button.qdone__del" && e.type === "click")` →
    bubbles into `DeleteQuoteButton` (icon). Owned by that island.

## 6. Motion (extracted)

- **`.qbar__fill` width:** `transition: width 1.2s var(--ease-out)` — the top-quote
  bars grow from 0 to their `value/max` width on (re)render. The slowest motion
  on the page.
- **`.qph__cta` hover:** `translateY(-1px)` over `--dur-fast`.
- **`.qdone__row` hover:** `translateX(2px)` + `border-color → --mint-300` over
  `--dur-fast`.
- **`.qdone__del` hover:** color/border/bg → pink (owned by DeleteQuoteButton).
- **`QSideRate` SVG** is **static** (no stroke-dashoffset animation) — the arc is
  rendered at its final `stroke-dasharray` directly.
- **No keyframes** (the only quotes.css keyframe, `q-pulse-dot`, belongs to
  QuoteCard).
- **Jank finding:** the 1.2s bar transition triggers on every parent re-render
  (e.g. language flip re-fetches → bars re-animate from 0). Mildly distracting on
  a no-op refresh; consider animating only on first mount.
- **Reduced motion:** no component-local guard; relies on the global tokens clamp
  (bar fill + hover transitions go instant).

## 7. Responsive

Own `@media` (in `static/quotes.css`, mirrored in this folder's css):
- **1200px:** `.qph` → column (CTA drops below the title); `.qkpi` 4 → 2 cols;
  `.qside` loses `position:sticky` (becomes `static`).
- **1100px:** `.qdone` 2 → 1 col (decided rows stack full-width).
- **768px:** `.qkpi` 2 → 1 col.
- **560px:** `.qdone__row` tightens padding/gap and **hides `.qdone__when`**.
Shoot the sections at 1280 / 1100 / 768 / 560.

## 8. A11y

- **QuotesHero CTA** is a real `<button type=button>` but **does nothing** — a
  focusable control with no action confuses keyboard/AT users. Rebuild: wire it
  or remove it.
- KPI / decided / sidebar values are plain text — fine, but the win-rate `—`
  fallback conveys "not enough data" only visually; consider an `aria-label`
  spelling it out.
- `QSideRate` SVG gauge has **no `role="img"`/`aria-label`** — the percentage is
  in adjacent text, so it's not invisible, but the arc itself is undescribed.
- DecidedRow badge (`✓`/`✗`) is an icon-only status — the won/lost meaning is
  carried by the badge color + struck amount; add a text/`aria` label of the
  outcome.
- Inherits the embedded `DeleteQuoteButton` a11y notes (native confirm).

## 9. Used on

`/quotes` only — all six exports are imported and composed by
`islands/QuotesPage.tsx`. No other consumer (grep of `QuotesSections` import).
`DecidedRow` is the only section that embeds an island
(`DeleteQuoteButton` icon variant, `QuotesSections.tsx:186`).
