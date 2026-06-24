# LandedRow

The compact "tail of month" row (`.qdone__row`) for older-than-1-day landed
payments — a won-style check badge, the client name, a `method · when ·
invoiceRef` sub-line, and the amount. Rendered in the `.qdone` two-up grid below
the recent PaymentCards inside the Just-landed track.

## 1. Classification & behavior
- **Bucket:** local presentational component of the PaymentsPage island
  (`islands/PaymentsPage.tsx` lines 786–801; extracted to `js/LandedRow.tsx`).
- **Interaction tier:** **static / island-child.** No client state, no fetch,
  no events, no callbacks. (In the island source the row takes only `lang` + `p`
  and calls the module-level `methodLabel`; the extracted folder version threads
  `methodLabel` in as a prop to stay self-contained.)
- **Server actions + flash:** none. The row is not clickable — no flip, no
  navigation, no mutation (unlike the `.qcard` PaymentCard it sits beneath).
- **Data source:** the single `p: EnrichedPayment` prop (parent-derived
  `client`, `method`, `whenLabel`, `invoiceRef`, `amount`). **Honest-empty:** the
  parent only renders rows when `olderLanded.length > 0`; the row itself has no
  empty state.
- **Liveness:** none.
- **Data-shape hazards:**
  - `invoiceRef` is cosmetic (`INV-` + first 6 chars of `invoiceId`).
  - `whenLabel` is a relative humanization (`Today`/`Yesterday`/`Nd ago`) from
    `daysAgo` — by the time a payment is a `LandedRow` it's always `>1d`, so the
    label is always `"Nd ago"`.
  - No status branch: a LandedRow is, by construction, always a settled
    (`landed`) payment, so the badge is always the green `--won` variant.

## 2. Anatomy
```
<div class="qdone__row">
  <div class="qdone__badge qdone__badge--won"><I check size=13 sw=2.5/></div>
  <div class="qdone__body">                       ← UNSTYLED wrapper (see §6)
    <div class="qdone__title">{client}</div>
    <div class="qdone__sub">                       ← UNSTYLED (see §6)
      {methodLabel(lang, method)} · {whenLabel} · {invoiceRef}
    </div>
  </div>
  <div class="qdone__amt">{fmtMoney(amount)}</div>
</div>
```
- The `.qdone__row` grid template is `auto minmax(0,1fr) auto auto auto` — five
  tracks — but this markup only fills three slots (badge, body, amt), so the two
  trailing `auto` tracks collapse to 0. (The quotes/invoices won/lost rows that
  defined this grid had more cells.)
- Deps: `I`/`ICN.check`, `fmtMoney`, `methodLabel`/`tFor`.
- **Icon dependency:** `I` + `ICN.check` (the won badge glyph).

## 3. Props
| name | type | default | widget | signal? |
|---|---|---|---|---|
| `lang` | `Lang` (required) | — | select | no |
| `p` | `EnrichedPayment` (required) | — | object | no |
| `methodLabel` | `(lang, method) => string` | (island uses module fn) | (callback) | no |

`p` fields read: `client`, `method`, `whenLabel`, `invoiceRef`, `amount`.

## 4. States → cases
| state | meaning | case |
|---|---|---|
| default | a settled older payment row (check method) | `cases/default/default.json` |
| long-name | overflowing client name → ellipsis clip | `cases/long-name/long-name.json` |
| es | Spanish method + when label | `cases/es/es.json` |

## 5. Events
- None. The row is non-interactive (no click handler, not a link/button).

## 6. Motion (extracted, from quotes.css)
- **Hover:** `.qdone__row:hover` → `border-color: var(--mint-300)` +
  `transform: translateX(2px)`, over `var(--dur-fast) var(--ease-out)` (subtle
  slide). Only motion on the row.
- **Reduced motion:** no component-local guard — global tokens clamp; verify the
  hover slide goes instant.
- **CSS HAZARD (FLAG):** the markup uses `.qdone__body` (middle-cell wrapper) and
  `.qdone__sub` (the `method·when·invoiceRef` line), but `static/quotes.css` only
  defines `.qdone__title` / `.qdone__client` / `.qdone__when`. So **`.qdone__body`
  and `.qdone__sub` are UNSTYLED** — the sub-line falls back to inherited body
  text instead of the small muted `.qdone__client` treatment the design intends.
  **Fix:** rename `.qdone__sub` → `.qdone__client` (or add the missing rules).

## 7. Responsive (own `@media`, from quotes.css)
- `≤1100px`: the parent `.qdone` grid → 1 column (rows go full-width).
- `≤560px`: `.qdone__row` gap/padding tighten (`gap:8px; padding:12px`) and
  `.qdone__when` is hidden — though this markup has no `.qdone__when` cell, so
  that rule is a no-op here.

## 8. A11y
- The check badge is a decorative glyph with no label; the row's meaning is
  carried by the visible text (client/method/when/amount) — acceptable, though
  the badge could use an `aria-label="paid"`.
- The row is a `<div>` (not a list item) — wrapping the `.qdone` grid in a
  `<ul>`/`<li>` would give AT list semantics. Currently plain divs.

## 9. Used on
`/payments` only (the `.qdone` tail list under the Just-landed track's recent
cards). CSS = `css/landed-row.css` (the `.qdone*` block from `static/quotes.css`
+ the flagged-undefined `.qdone__body`/`.qdone__sub`).
