# Payments

## Purpose
The cash-arrived view. Where Quotes shows pipeline and Invoices shows receivables, Payments shows what's actually landed (or is in transit). Big editorial hero of the dollar amount that "showed up this month", with a stack of fanned-out recent payment "stubs" on the right. Below: KPIs, a "Needs attention" track for stuck payments, "Just landed", and "In transit". Side rail with cash-flow visualization.

## Top-level structure
Standard chrome. `<PaymentsPage>` composes:

1. **`<PaymentsHero>`** — `.pph__*` editorial hero with title, eyebrow, sub-paragraph, two CTAs, and the right-side `.pph__stack` of three rotated `.pph__stub` cards.
2. **`<PaymentsKpis>`** — KPI grid (this page uses `.pkpi` rather than `.qkpi` — it's a Payments-specific styling).
3. **`.qlay`** layout — main column + `.qside` rail:
   - **Main**: 3 `<Track>` (`.qtrack__*`) sections.
     - `01 Needs attention` — only renders if `attention.length > 0`.
     - `02 Just landed` — recent (≤1d) as `<PaymentCard>` flip cards + `<LandedRow>` chips for older landed.
     - `03 In transit` — `defaultOpen={false}`.
   - **Side rail** (`<aside class="qside">`):
     - `<PSideFlow>` — cash flow chart.
     - `<PSideTopPayors>` — top contributors.
     - `<PSideMix>` — payment-method mix.
     - `<PSideTip>` — copy nudge.

## Layout chrome (uses `shared/`)
- `shared/sidebar`, `shared/topbar`, `shared/annotation-dots`, `shared/phone-preview`.
- The Track and side-rail container are shared with Quotes (`.qtrack__*`, `.qside`).

## Page-unique components
- [payment-header](components/payment-header/) — `.pph__*` editorial hero with the rotated stub stack on the right.
- [payment-card](components/payment-card/) — `.qcard__*` reused with payment-specific moods + content.
- [payment-track](components/payment-track/) — `.qtrack__*` reused.
- [payment-side-panel](components/payment-side-panel/) — `.qside` + `.qside__card` rail of stat cards.

## Notable interactions
- The 3-card payment "stub stack" is statically rotated with rotate/translate offsets. On `.pph__stack:hover`, each stub bumps up a few px without changing rotation.
- Each stub is themed by `p.method` — the avatar gradient differs by ach/card/check/cash.
- `<PaymentCard>` reuses `<QuoteCard>` markup with payment-specific moods (`moodForPayment`).

## Source
`extracted/Paperwork Monsters Payments.html` (also at `pages/payments/raw.html`).
