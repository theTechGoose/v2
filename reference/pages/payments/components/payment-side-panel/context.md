# Payment side panel (`.qside` + `.qside__card`)

## What
The 280px right-rail companion column on the Payments page. Sticky-positioned. Hosts four stacked stat cards:

1. **`<PSideFlow>` — Cash-flow shape**
   - 12-week sparkline of weekly cash totals.
   - Pink line + soft pink area-fill gradient (`#FF6B6B` 32% → 0%).
   - Renders an inline SVG with 12 dots; the most recent is a slightly bigger terminal.
   - Footer row of three labels: Feb · Mar · Apr.

2. **`<PSideTopPayors>` — Top payors this month**
   - Aggregates `landed` payments by client and ranks the top 4.
   - Each row: rank tag · name + green-gradient relative-share bar · amount.

3. **`<PSideMix>` — How they paid**
   - Single 14px-tall segmented bar showing method shares (ACH/Card/Check/Cash).
   - Method colors: ACH `#4F8C6B`, Card `#2A6F77`, Check `#9C8074`, Cash `#E07A8C`.
   - Below: 2-column legend with swatch + label + percentage.

4. **`<PSideTip>` — Monster tip**
   - Dark-teal gradient card with white copy.
   - Static one-paragraph message comparing ACH vs card processing costs.

## Common shell
Each card uses `.qside__card`:

```css
.qside__card {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  padding: 18px;
}
.qside__title { font-family: var(--font-heading); font-weight: 800; font-size: 14px; color: var(--brand-teal); }
.qside__sub   { font-size: 11px; color: var(--fg-muted); }
```

The PSideTip overrides background + color inline.

## Source
`pages/payments/raw.html` lines 5913–6023 (component logic + markup); CSS for the `.qside__card` shell at lines 2507–2530.

## Animations
None. SVG sparkline is static (no animate-on-mount).
