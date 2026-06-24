# Capture checklist — InvoicesHero

**Theme:** light only.
**Auth:** dev master OTP `000000`.

## Route / URL
- `http://localhost:5280/invoices` — the hero is the `.qph` header at the top of
  the page (the editorial block above the KPI strip).

## Viewports (from quotes.css `@media`)
- **1280px** — hero is a flex row (`align-items:flex-end; justify-content:
  space-between`), CTA row to the right.
- **1200px** boundary — at ≤1200 `.qph` becomes `flex-direction:column;
  align-items:flex-start` (title/sub/CTAs stack). Shoot just above and just
  below 1200 to capture the reflow.
- **720px** — confirm the stacked layout + the `clamp(28px,4vw,44px)` title
  scaling down.

## Element(s) to crop
- The `<header class="qph">` block only (eyebrow dot → title → sub → optional
  at-risk line → CTA row with New invoice + Export CSV).

## Transient states to drive (the 5 headline variants — branch order matters)
1. **truly-empty** — 0 invoices → "No invoices yet — *let's start the river*."
   + sub.empty. (Fresh account.)
2. **fresh** — invoices exist, nothing outstanding, no forecast → "All clear —
   *nothing outstanding*." + "Nothing past due…".
3. **forecast-week** — `/api/invoices/forecast/this-week` returns
   `thisWeekCents>0` → "*$X* expected this week / across N payments" + the ≤3
   per-day breakdown in the sub (data-cy=forecast-breakdown) + the ⚠ at-risk
   line (data-cy=forecast-at-risk) when atRiskCents>0.
4. **forecast-next** — `nextWeekCents>0`, `thisWeekCents=0` → "Quiet week — *$X*
   coming next week."
5. **outstanding** (legacy) — forecast 404s/empty → "*$X* on the way / across N
   invoices" + "N is/are past due …".

> Driving forecast variants: the forecast is a fire-and-forget
> `fetch("/api/invoices/forecast/this-week")`. To force a variant, intercept that
> endpoint (or use isolate cases) — older backends 404 it, which is the
> outstanding fallback.

## Motion to film
- `.qph__cta:hover` → `translateY(-1px)` over `--dur-fast var(--ease-out)`. Film
  the hover lift on the New-invoice pink CTA. The Export-CSV ghost `<a>` has the
  same base `.qph__cta` transition. Re-shoot with reduced-motion (global clamp).
- The ⚠ at-risk line is a literal glyph (no animation; check the `#a83b3b`
  hardcoded danger color renders).

## Notes
- The `.qph__cta--ghost` look is 100% inline style (transparent bg + 1px
  currentColor border + margin-left:10px), NOT a class rule — verify the Export
  link reads as outlined, not solid pink. NO fabricated screenshots.
