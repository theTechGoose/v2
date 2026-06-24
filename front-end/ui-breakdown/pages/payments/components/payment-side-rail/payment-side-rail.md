# PaymentSideRail

The sticky `aside.qside` rail on /payments — four stacked `.qside__card`
widgets: **PSideFlow** (12-week cash-flow sparkline) · **PSideTopPayors**
(top-4 payors bars) · **PSideMix** (method-mix stacked bar + legend) · **PSideTip**
(static teal "Monster tip" card).

## 1. Classification & behavior
- **Bucket:** four local presentational components of the PaymentsPage island
  (`islands/PaymentsPage.tsx`: PSideFlow 805–881, PSideTopPayors 883–927,
  PSideMix 929–1005, PSideTip 1007–1028). Rendered inside `aside.qside`.
- **Interaction tier:** **static / island-child.** No client state, no fetch,
  no events. All four are pure functions of props.
- **Server actions + flash:** none. No buttons, no links, no mutations.
- **Data source per widget (all derived in-component from props):**
  - PSideFlow ← `landedAmounts: number[]` (the parent's `landed.map(p=>p.amount)`).
  - PSideTopPayors / PSideMix ← `landed: EnrichedPayment[]`.
  - PSideTip ← `lang` only (fully static copy).
  - **Honest-empty:** each renders its own empty copy — PSideFlow `flow.empty`
    (no weeks > 0), PSideTopPayors `payors.empty` (no entries), PSideMix
    `mix.empty` (no segments). PSideTip always renders.
- **Liveness:** none.
- **Data-shape hazards (the flagged concern for this rail):**
  - **All four recompute over the full `landed` array on EVERY render** — a
    per-render rollup over payments. On a real backend these mirror
    `DashboardStats.payments.{methodMixCents, topPayors}` +
    `revenue.sparkline12mo` (whole-account Σ scans). **[denormalize / precompute;
    don't scan on each render].**
  - **PSideFlow buckets by ARRAY INDEX, not by `receivedAt`:**
    `weeks[11 - (i % 12)] += a`. The "12-week trend" is **fabricated** — the
    x-axis has nothing to do with time, and the labels (Feb/Mar/Apr) are
    **hardcoded**, not derived from the data's dates. A real trend must bucket by
    `receivedAt` week.
  - **PSideTopPayors tallies by client display-name string** (`p.client`) — two
    customers with the same name collide into one bar; an unlinked payment
    (`client === "—"`) becomes a "—" payor.
  - **PSideMix tallies by method** across the 9-method enum; segments with
    `pct===0` are filtered out.
- **Anti-patterns / CSS HAZARD (FLAG — real visible bug):**
  - **PSideTopPayors markup references `.qside__rows / .qside__row /
    .qside__rank / .qside__row-body / .qside__row-name / .qside__bar /
    .qside__bar-fill / .qside__row-amt` — NONE of which are defined in any
    `static/*.css`.** The widget renders as default block flow; only the inline
    `width`/`background` on `.qside__bar-fill` lands, but with no track and no
    explicit height it is effectively invisible. QuotesPage's equivalent rail
    uses the **styled** `.qbig*`/`.qbar*` family. **Fix:** add the missing
    `.qside__*` rules OR switch to `.qbig*`/`.qbar*` (reproduced in
    `css/payment-side-rail.css`). PSideFlow / PSideMix / PSideTip are
    inline-styled and render correctly.

## 2. Anatomy
```
<aside class="qside">                          ← sticky, top:16px (static ≤1200px)

  <div class="qside__card">                    ← PSideFlow
    <div class="qside__title">Cash-flow shape</div>
    <div class="qside__sub">Last 12 weeks · {amount} this week | nothing yet</div>
    {hasData ? <svg> area+line+dots (inline, 220×60) </svg>
             : flow.empty text}
    <div inline-flex>Feb · Mar · Apr</div>      ← HARDCODED labels
  </div>

  <div class="qside__card">                     ← PSideTopPayors (UNSTYLED inner)
    <div class="qside__title">Top payors this month</div>
    <div class="qside__sub">Who actually showed up with money</div>
    {top.length ? <div class="qside__rows">{ .qside__row × ≤4:
        .qside__rank | .qside__row-body(.qside__row-name + .qside__bar>.qside__bar-fill) | .qside__row-amt }</div>
                : payors.empty text}
  </div>

  <div class="qside__card">                      ← PSideMix
    <div class="qside__title">How they paid</div>
    <div class="qside__sub">Method mix this month</div>
    {segments.length ? <stacked bar (inline)> + <legend grid 1fr 1fr (inline)>
                     : mix.empty text}
  </div>

  <div class="qside__card" style="teal gradient, white text">   ← PSideTip (static)
    <div class="qside__title">Monster tip</div>
    <p>Zelle and Cash App … up to 5 days … deposits …</p>
  </div>
</aside>
```
- Deps: `fmtMoney`, `methodLabel`, `tFor`. PSideFlow builds an inline SVG with a
  `linearGradient id="cfArea"`. No shared icons.

## 3. Props (per sub-component)
| component | name | type | default | widget | signal? |
|---|---|---|---|---|---|
| PSideFlow | `lang` | `Lang` | — | select | no |
| PSideFlow | `landedAmounts` | `number[]` (CENTS) | — | number[] | no |
| PSideTopPayors | `lang` | `Lang` | — | select | no |
| PSideTopPayors | `landed` | `EnrichedPayment[]` | — | object[] | no |
| PSideMix | `lang` | `Lang` | — | select | no |
| PSideMix | `landed` | `EnrichedPayment[]` | — | object[] | no |
| PSideTip | `lang` | `Lang` | — | select | no |

## 4. States → cases
| state | meaning | case |
|---|---|---|
| populated | all four widgets with data (sparkline, bars, mix, tip) | `cases/populated/populated.json` |
| empty | fresh account — Flow/Payors/Mix show empty copy; Tip still renders | `cases/empty/empty.json` |
| single-method | mix is one segment at 100% | `cases/single-method/single-method.json` |
| es | Spanish titles/subs/empty/tip | `cases/es/es.json` |

## 5. Events
- None. The rail is non-interactive (no clicks, no nav).

## 6. Motion (extracted)
- **None component-local.** The cards are static. (No sparkline draw-in, no bar
  grow — the `.qbar__fill width 1.2s` transition only exists on the *styled
  alternative* classes, which the current markup doesn't use.)
- **Sticky:** `.qside { position: sticky; top:16px }` — scroll-follow, not an
  animation.
- **Reduced motion:** no-op (nothing animates).

## 7. Responsive (from quotes.css)
- `≤1200px`: the rail goes `position:static` (drops below the main column,
  stops sticking) — this is set on `.qside` in the page layout media query.
- The `.qside__card` width follows the `.qlay` rail track (320px desktop → full
  width once stacked).

## 8. A11y
- The inline SVG sparkline has no `role`/`aria-label`/`<title>` — it's an
  unlabeled graphic. **Fix:** add `role="img"` + an `aria-label` summarizing the
  trend, or a visually-hidden text equivalent.
- PSideMix conveys method shares with color swatches + text labels (not
  color-only) — OK, but the swatch `<span>`s are decorative with no label.
- PSideTopPayors, being unstyled, still exposes its text (rank/name/amount) to
  AT in source order — readable but visually broken.

## 9. Used on
`/payments` only (the `aside.qside` rail in PaymentsPage). CSS =
`css/payment-side-rail.css` (the `.qside` shell from `static/quotes.css` + the
flagged-undefined `.qside__*` inner classes + the `.qbig*`/`.qbar*` styled
alternative).
