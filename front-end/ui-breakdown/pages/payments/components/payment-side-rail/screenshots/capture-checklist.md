# Capture checklist — PaymentSideRail

**Theme:** light only.
**Auth:** dev master OTP `000000`.

## Route / URL
- `http://localhost:5280/payments` — the `aside.qside` rail on the right of the
  `.qlay` grid (desktop). Child of the PaymentsPage island; its four widgets
  follow the seeded `landed` payments.

## Viewports (page-layout `@media`)
- **1280px** — rail is **sticky** (`top:16px`) beside the tracks. Scroll the
  page to confirm it follows.
- **1200px** — `.qside` goes `position:static` and the rail drops **below** the
  main column (full width). Shoot at ~1199px.

## Element(s) to crop
- Each of the four `.qside__card`s individually:
  1. **PSideFlow** — the inline SVG sparkline (area + line + dots) + the
     hardcoded Feb/Mar/Apr axis labels.
  2. **PSideTopPayors** — crop to **evidence the UNSTYLED bug**: undefined
     `.qside__*` classes mean no bar track / no rank chip styling; compare to a
     styled `.qbig*`/`.qbar*` rail elsewhere.
  3. **PSideMix** — the stacked method-mix bar + the 2-column legend.
  4. **PSideTip** — the teal-gradient "Monster tip" card (white text).

## Transient states to drive
1. **populated** — seed with several landed payments across methods: all four
   widgets render with data.
2. **empty** — wiped account: Flow/Payors/Mix each show their empty copy; Tip
   still renders.
3. **single-method** — a seed where every landed payment is one method: PSideMix
   shows a single 100% segment + one legend row.
4. **es** — Spanish UI language: all titles/subs/empty/tip localize.

## Motion to film
- **None** — the rail is static (no draw-in, no bar grow). The only "motion" is
  the sticky scroll-follow at ≥1200px; capture that as a scroll, not an
  animation. No reduced-motion concern.

## Notes (bugs to evidence, do not fix for the shot)
- **PSideTopPayors renders unstyled** — this is the headline finding for this
  component; the crop should clearly show the broken bars.
- **PSideFlow's trend is fabricated** — bucketed by array index, not by
  `receivedAt`, and the Feb/Mar/Apr labels are hardcoded. The shape is decorative,
  not a real time series.
- The sparkline SVG is unlabeled (no `role="img"`/`aria-label`).
