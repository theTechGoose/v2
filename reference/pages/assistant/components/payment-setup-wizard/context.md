# Payment-setup wizard (`.wiz__*`)

> Naming note: the plan calls this "payment-setup-wizard" but in the static export the live instance gathers Contract terms (config, customer, start, wraps, payment, warranty…). The component is the same generic wizard pattern — re-target with copy + step list.

## What
A guided multi-step Q&A embedded directly inside an assistant chat bubble. The user taps a preset answer (or "Custom") to advance. Completed answers collapse into chips at the top, the current question fills the middle, and remaining steps preview at the bottom — all on one mounted card, so the user can also see the whole arc at once.

## Layout
1. **Header** (`.wiz__head`) — icon tile · title + sub copy · "config" tag · "All-on-one" mode toggle.
2. **Completed chips** (`.wiz__chips` of `.wiz-chip`) — one per answered step. Edit pencil at the end.
3. **Active step** (`.wiz__step`):
   - Step counter (`.wiz__step-num`)
   - Question (`.wiz__step-q`)
   - 4 preset answer buttons + 1 `--custom` variant (`.wiz-opt` / `.wiz-opt--custom`)
   - Inline hint with the default policy (`.wiz__hint`)
4. **Remaining preview** (`.wiz__rest` of `.wiz-pill` chips with `.wiz-pill__num`).
5. **Footer** (`.wiz__foot`) — completion count + progress bar + finalize CTA.

## States
- `.wiz-opt:hover` — sunken background + slight scale.
- `.wiz-opt--custom` — bordered ghost variant.
- `.wiz__head-mode` — "All-on-one" mode toggle (no actual handler in the export; visual affordance only).

## Source
`pages/assistant/raw.html` lines 2420–2680 (CSS), 4424–4518 (markup).

## Animations
None directly (no `@keyframes`). Hover transitions on `.wiz-opt` and `.wiz__head-mode`.
