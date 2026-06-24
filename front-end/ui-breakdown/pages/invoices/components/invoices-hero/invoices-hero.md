# InvoicesHero

The editorial `.qph` page header for /invoices. Picks one of five headline
variants from the forecast + outstanding totals, shows a sub + optional at-risk
line, and the New-invoice + Export-CSV CTA row.

## 1. Classification & behavior
- **Bucket:** local presentational component of InvoicesPage
  (`islands/InvoicesPage.tsx` lines 566–724).
- **Interaction tier:** **static / island-child.** No client state of its own.
  One callback prop (`onNew`).
- **Server actions:** none. The Export link is a plain `<a href=
  /api/invoices/export.csv?year=YYYY>` (GET download, opens normally). The New
  button calls `onNew()` (parent opens the modal).
- **Data source:** all props (totals/counts/forecast/lang) computed by the
  parent island. **Honest-empty:** the `trulyEmpty` + `fresh` branches render a
  friendly headline when there are no invoices / nothing outstanding.
- **Liveness:** none.
- **Data-shape hazard:** the five-way branch order matters — truly-empty →
  fresh(no-forecast) → forecast-this-week → forecast-next-week → legacy
  outstanding. `haveForecast` requires ANY of the three forecast cents > 0.

## 2. Anatomy
```
<header class="qph"><div class="qph__copy">
  <div class="qph__eyebrow"><span dot/> {eyebrow}</div>
  <h1 class="qph__title" data-cy="forecast-hero"> {one of 5 variants, <em> on the money/key word} </h1>
  <p class="qph__sub"> {empty | forecast-breakdown(≤3) | "N past due …" | "nothing past due"} </p>
  {atRisk>0 && <p class="qph__sub" style=color:#a83b3b data-cy="forecast-at-risk">⚠ …</p>}
  <div class="qph__cta-row">
    <button class="qph__cta" data-cy="invoice-new"><I plus/> New invoice</button>
    <a class="qph__cta qph__cta--ghost" data-cy="invoice-export" inline-styled-ghost>Export {year} CSV</a>
  </div>
</div></header>
```
- `.qph__copy` and `.qph__cta--ghost` are **UNSTYLED** classes (no CSS rule);
  the ghost look is 100% inline style on the `<a>` (transparent bg + 1px current
  -color border + margin-left:10px). See `css/invoices-hero.css`.

## 3. Props
| name | type | default | widget | signal? |
|---|---|---|---|---|
| `outstandingTotal` | number (cents) | — | number | no |
| `outstandingCount` | number | — | number | no |
| `overdueCount` | number | — | number | no |
| `totalInvoiceCount` | number | — | number | no |
| `forecast` | `ForecastResult?` | undefined | object | no |
| `lang` | `Lang` | — | select | no |
| `onNew` | `() => void` | — | (callback→Events) | no |

## 4. States → cases
| state | meaning | case |
|---|---|---|
| truly-empty | 0 invoices | `cases/empty/empty.json` |
| fresh | invoices exist, nothing outstanding, no forecast | `cases/fresh/fresh.json` |
| forecast-week | thisWeekCents>0 → "$X expected this week" + breakdown | `cases/forecast-week/forecast-week.json` |
| forecast-next | nextWeekCents>0 → "$X coming next week" | `cases/forecast-next/forecast-next.json` |
| outstanding | legacy "$X on the way / across N invoices" + at-risk | `cases/outstanding/outstanding.json` |

## 5. Events
- `ev.expect(e => e.source==="button[data-cy=invoice-new]" && e.type==="click")`
  → `onNew()`.
- Export is a navigation (no JS handler).

## 6. Motion
- `.qph__cta:hover` → `translateY(-1px)` over `--dur-fast var(--ease-out)`. No
  other motion. Reduced-motion via global clamp.

## 7. Responsive (from quotes.css)
- `≤1200px`: `.qph` `flex-direction:column; align-items:flex-start`.

## 8. A11y
- The ⚠ at-risk line uses a literal "⚠" glyph (no `aria-label`); the danger
  color `#a83b3b` is a hardcoded hex (matches the public-surface danger token).
- CTA button + export link are real `<button>`/`<a>` — keyboard-OK.

## 9. Used on
`/invoices` only.
