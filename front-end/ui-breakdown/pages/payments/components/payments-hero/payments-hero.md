# PaymentsHero

The `.pph` editorial page header for /payments — a "money landed" treatment.
Left = pink eyebrow + a big amount headline (`$X showed up this month.`) or a
`fresh` empty variant + a sub line + two assistant-seeded CTAs. Right =
`.pph__stack`, up to three rotated `.pph__stub` recent-payment cards
(decorative, `aria-hidden`).

## 1. Classification & behavior
- **Bucket:** local presentational component of the PaymentsPage island
  (`islands/PaymentsPage.tsx` lines 463–589). Not its own island — renders
  inside the page island, sharing its hydration boundary.
- **Interaction tier:** **static / island-child.** No client state, no fetch,
  no callbacks. Pure props in, markup out.
- **Server actions + flash:** none. Both CTAs are plain `<a href>` navigations
  into the assistant — `recordCta` → `/assistant?seed=<recordSeed>`,
  `exportCta` → `/assistant?seed=<exportSeed>`. They do NOT record/export here
  (consistent with the page being read-only). No PRG, no toast.
- **Data source:** all props, computed by the parent island from
  `paymentsClient.list()` + the joined invoices/customers. **Honest-empty:** the
  `fresh` branch (when `monthTotal===0 && transitTotal===0 && attentionCount===0`)
  renders a friendly "Nothing's landed yet — *let's change that*." headline + the
  freshSub explainer instead of a `$0` number.
- **Liveness:** none (request-response via parent).
- **Data-shape hazards:**
  - `monthTotal`/`transitTotal` are **per-render client-side Σ rollups** over the
    landed/transit arrays in the parent (mirror of
    `DashboardStats.payments.receivedYtdCents` / a settling subset). **[precompute
    / denormalize].**
  - `attentionCount` is **always 0** in practice — the `attention` status is
    never produced (the `Payment` DTO carries no status signal), so the
    `subUnstick`/`subAnd` clause never appears. Documented dead branch.
  - The sub-line concatenation is order-dependent: `subPlus … subOnTheWay`
    (transit) → `subAnd … subUnstick` (attention) → `subMonsters` tail; when
    transit is 0 it collapses to a single `everyDollar` clause.
- **Anti-patterns:** the stub stack is decorative (`aria-hidden="true"`) — good.
  The two CTAs reading as actions ("Record a payment", "Export this month") but
  actually punting to the assistant is a mild expectation mismatch, inherited
  from the page's read-only stance.

## 2. Anatomy
```
<header class="pph">
  <div class="pph__main">
    <div class="pph__eyebrow"><I check/> Payments · {Month}</div>
    <h1 class="pph__title" [style fresh→smaller clamp]>
      {fresh ? "Nothing's landed yet — <em>let's change that</em>."
             : <><span class="pph__title-amount"><sup>$</sup>{N}</span>
                  <span class="pph__title-tail">showed up this month.</span></>}
    </h1>
    <p class="pph__sub">
      {fresh ? freshSub
             : (transit>0 ? "Plus <strong>$X</strong> on the way" : "Every dollar logged.")
               + (attention>0 ? " and <strong>N</strong> that need a quick text…" : "")
               + (transit>0 ? ". The monsters logged every dollar." : "")}
    </p>
    <div class="pph__cta-row">
      <a class="pph__cta" href="/assistant?seed=…"><I plus/> Record a payment</a>
      <a class="pph__ghost" href="/assistant?seed=…"><I arrow/> Export this month</a>
    </div>
  </div>
  <div class="pph__stack" aria-hidden="true">
    {stubs.map((p,i) => <div class="pph__stub pph__stub--{i+1}">
       <div class="pph__stub-head">
         <div class="pph__stub-av" style="background:{METHOD_AV_BG[method]}">{initials}</div>
         <div class="pph__stub-meta"><div class="pph__stub-client">{client}</div>
           <div class="pph__stub-when">{whenLabel} · {invoiceRef}</div></div>
       </div>
       <div class="pph__stub-amount">{fmtMoney(amount)}</div>
       <div class="pph__stub-foot">
         <span class="pph__stub-method"><I METHOD_ICON[method]/> {methodLabel}</span>
         <span class="pph__stub-tag">Landed</span>
       </div>
    </div>)}
  </div>
</header>
```
- Local deps (live in PaymentsPage.tsx): `METHOD_AV_BG` (per-method avatar
  gradient, lines 80–90), `METHOD_ICON`/`P2PIcon` (lines 92–144), `methodLabel`
  (lines 77–78), `fmtMoney`, `tFor`, `I`/`ICN` (`check`/`plus`/`arrow`).
- **Icon dependency:** `I` + `ICN.check|plus|arrow`; per-method `METHOD_ICON`.

## 3. Props
| name | type | default | widget | signal? |
|---|---|---|---|---|
| `lang` | `Lang` (required) | — | select | no (parent passes `langSignal.value`) |
| `monthTotal` | number (CENTS, required) | — | number | no |
| `transitTotal` | number (CENTS, required) | — | number | no |
| `attentionCount` | number (required) | — | number | no |
| `stubs` | `EnrichedPayment[]` (required, sliced to 3) | — | object[] | no |

`stubs` items use: `id`, `method`, `initials`, `client`, `whenLabel`,
`invoiceRef`, `amount` (the parent's `recentLanded.slice(0,3)`).

## 4. States → cases
| state | meaning | case |
|---|---|---|
| populated | `$X showed up this month.` + 3 stubs + "Plus $Y on the way" | `cases/populated/populated.json` |
| fresh | all totals 0 → empty headline variant, no stubs | `cases/fresh/fresh.json` |
| no-transit | landed only, `transitTotal=0` → sub = "Every dollar logged." | `cases/no-transit/no-transit.json` |
| es | Spanish UI language | `cases/es/es.json` |

## 5. Events
- No JS handlers. Both CTAs are `<a>` navigations (predicate-wise:
  `ev.expect(e => e.source==="a.pph__cta" && e.type==="click")` = a navigation
  to `/assistant?seed=…`, not a handler).

## 6. Motion (extracted)
- **CTA hover:** `.pph__cta` `transform: translateY(-1px)` over
  `160ms var(--ease-bounce)`; `.pph__ghost:hover` background fade `160ms`.
- **Stub stack hover:** `.pph__stack:hover .pph__stub--1/2/3` each translate up
  ~1–3px (keeping their individual rotations) over `280ms var(--ease-bounce)`
  (the `.pph__stub` `transition: transform 280ms var(--ease-bounce), box-shadow
  240ms ease`). The three stubs are absolutely positioned and rotated
  (-4.2°/2.6°/-1.3°) at top 0/70/140px.
  - **Jank finding:** transforms-only, GPU-friendly — smooth. The stack has
    `overflow:visible` so the rotated cards aren't clipped.
- **Reduced motion:** no component-local guard — relies on the global tokens
  reduced-motion clamp. Verify hover lift/CTA nudge go instant.

## 7. Responsive (own `@media`, from static/payments.css)
- `≤760px`: `.pph` → 1 column (stack drops below the copy), padding tightens;
  `.pph__stack` grows to 320px tall and the stubs re-fan **vertically**
  (left-aligned, rotations softened to -2.6°/1.6°/-0.8° at top 0/90/180px) so
  each is clearly visible on a narrow screen.

## 8. A11y
- `.pph__stack` is `aria-hidden="true"` — correct (purely decorative).
- The eyebrow check glyph + CTA glyphs are inline SVGs with no labels, but the
  adjacent text carries meaning — acceptable.
- Headline uses a real `<h1>` (good page-heading semantics). The `<em>` in the
  fresh variant is styled non-italic (`font-style:normal`) but still conveys
  emphasis to AT.
- CTAs are real `<a>` — keyboard-operable.

## 9. Used on
`/payments` only (rendered by PaymentsPage). CSS = `css/payments-hero.css`
(extracted verbatim from `static/payments.css`).
