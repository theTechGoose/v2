# `Pricing` — Without/With us comparison + pink callout

## Purpose

Centered section header + a single white pricing card (max-width 880 px). Inside: 3-column "math" grid (`Without us | arrow | With us`) where the right column is highlighted with a green dashed-to-solid border and a "CON NOSOTROS" pill. Below the math, a pink callout band ("$850 more in your pocket") with a white CTA button.

## Source

- HTML: `Paperwork Monsters Landing.html` lines **2331–2378**
- CSS: `styles.css` lines **954–1047**

## HTML (verbatim)

```html
<section class="pricing" id="pricing">
  <div class="container">
    <div class="section-head">
      <span class="eyebrow-pill" data-i18n="price.eyebrow">Pricing</span>
      <h2 data-i18n="price.h2html" data-html="1">Pay us from <em>what we make you</em></h2>
      <p data-i18n="price.lead">Quotes, contracts, invoices, pricing, follow-ups — we run your back office so you can stay on the job site. And it pays for itself.</p>
    </div>

    <div class="pricing-card">
      <div class="pricing-math">

        <div class="math-col">
          <div class="label" data-i18n="price.without">Without us</div>
          <div class="price">$ 5,000</div>
          <div class="breakdown">
            <div class="line"><span data-i18n="price.w1">Your guess at price</span><span>$ 5,000</span></div>
            <div class="line"><span data-i18n="price.w2">Hours doing paperwork</span><span data-i18n="price.w2v">~6 hrs</span></div>
            <div class="line"><span data-i18n="price.w3">Trust from clients</span><span data-i18n="price.w3v">So-so</span></div>
            <div class="keep"><span data-i18n="price.keep">You keep</span><span style="float:right">$ 5,000</span></div>
          </div>
        </div>

        <div class="math-arrow">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"/>
            <polyline points="12 5 19 12 12 19"/>
          </svg>
        </div>

        <div class="math-col us">
          <div class="label" data-i18n="price.with">With us</div>
          <div class="price" style="color:var(--brand-green)">$ 6,500</div>
          <div class="breakdown">
            <div class="line"><span data-i18n="price.u1">Real-data pricing</span><span>$ 6,500</span></div>
            <div class="line fee"><span data-i18n="price.u2">Our 10% fee</span><span>− $ 650</span></div>
            <div class="line"><span data-i18n="price.u3">Hours doing paperwork</span><span>0</span></div>
            <div class="keep"><span data-i18n="price.keep2">You keep</span><span style="float:right">$ 5,850</span></div>
          </div>
        </div>

      </div>

      <div class="pricing-callout">
        <div>
          <div class="ptext" data-i18n="price.callout">$850 more in your pocket.</div>
          <div class="psub"  data-i18n="price.calloutSub">A back office that pays for itself. Only charged when your client pays.</div>
        </div>
        <a href="#contact" class="btn-white cta-scroll" data-i18n="price.cta">Start Making More →</a>
      </div>

    </div>
  </div>
</section>
```

> **Bilingual gotcha:** the pseudo-element `::before` on `.math-col.us` says `'CON NOSOTROS'` (Spanish) — see CSS below. This is a **hardcoded Spanish string in the CSS** even when the page is in EN. Production should swap to `'WITH US' / 'CON NOSOTROS'` based on `lang`. Easiest fix: render the pill as a real `<span class="us-pill">` inside the column instead of a pseudo-element, then localize.

## CSS (verbatim)

```css
.pricing {
  padding: 110px 0;
  background: linear-gradient(180deg, transparent 0%, var(--mint-200) 100%);
}

.pricing-card {
  background: #fff;
  border-radius: var(--radius-2xl);
  padding: 48px;
  box-shadow: var(--shadow-xl);
  max-width: 880px; margin: 0 auto;
  position: relative; overflow: hidden;
  border: 1px solid var(--border);
}

.pricing-math {
  display: grid; grid-template-columns: 1fr auto 1fr;
  gap: 32px; align-items: stretch;
  margin-bottom: 32px;
}

.math-col {
  background: var(--mint-100);
  border-radius: var(--radius-xl);
  padding: 28px;
  border: 2px dashed var(--border);
}
.math-col.us {
  background: linear-gradient(135deg, var(--green-50) 0%, #fff 100%);
  border: 2px solid var(--brand-green);
  position: relative;
}
.math-col.us::before {
  content: 'CON NOSOTROS';                              /* ⚠ HARDCODED Spanish */
  position: absolute; top: -12px; left: 24px;
  background: var(--brand-green); color: #fff;
  font-family: var(--font-heading); font-weight: 800; font-size: 11px;
  padding: 4px 12px; border-radius: 999px; letter-spacing: 0.08em;
}

.math-col .label     { font-family: var(--font-heading); font-weight: 700; font-size: 13px;
                       color: var(--fg-muted); margin-bottom: 6px;
                       text-transform: uppercase; letter-spacing: 0.06em; }
.math-col .price     { font-family: var(--font-heading); font-weight: 800;
                       font-size: 40px; color: var(--brand-teal); letter-spacing: -0.025em;
                       line-height: 1; margin-bottom: 14px; }
.math-col .breakdown          { font-size: 13px; color: var(--fg-muted); }
.math-col .breakdown .line    { display: flex; justify-content: space-between; padding: 4px 0; }
.math-col .breakdown .fee     { color: var(--coffee-500); }
.math-col .breakdown .keep    { margin-top: 10px; padding-top: 10px;
                                 border-top: 1.5px solid var(--brand-green);
                                 font-family: var(--font-heading); font-weight: 800;
                                 font-size: 18px; color: var(--brand-green); }

.math-arrow      { display: flex; align-items: center; justify-content: center;
                   font-family: var(--font-heading); font-weight: 800; font-size: 20px;
                   color: var(--brand-pink); }
.math-arrow svg  { color: var(--brand-pink); }

.pricing-callout {
  background: var(--brand-pink); color: #fff;
  border-radius: var(--radius-xl);
  padding: 24px 28px;
  display: flex; align-items: center; justify-content: space-between;
  gap: 24px; flex-wrap: wrap;
}
.pricing-callout .ptext   { font-family: var(--font-heading); font-weight: 800;
                             font-size: 22px; line-height: 1.2; }
.pricing-callout .psub    { font-size: 14px; opacity: 0.9; margin-top: 4px; }
.pricing-callout .btn-white {
  background: #fff; color: var(--brand-pink);
  padding: 14px 26px; border-radius: 14px;
  font-family: var(--font-heading); font-weight: 800;
  font-size: 15px; text-decoration: none;
  display: inline-flex; align-items: center; gap: 8px;
  transition: transform 200ms;
  white-space: nowrap;
}
.pricing-callout .btn-white:hover { transform: translateY(-2px); }
```

Below 980 px (`styles.css:1170–1172`): `.pricing-card { padding: 32px }`, `.pricing-math { grid-template-columns: 1fr }`, `.math-arrow { transform: rotate(90deg) }`.

## Preact / Fresh translation

```tsx
// v2/frontend/components/landing/Pricing.tsx — server component

const COPY = (lang: 'en'|'es') => lang === 'es' ? {
  withoutLabel: 'Sin nosotros', withLabel: 'Con nosotros',
  withoutPrice: '$ 5.000', withPrice: '$ 6.500',
  w1: 'Tu adivinanza de precio',  w1v: '$ 5.000',
  w2: 'Horas en papeleo',         w2v: '~6 hrs',
  w3: 'Confianza del cliente',    w3v: 'Más o menos',
  keep: 'Te quedas con',          withoutKeep: '$ 5.000',
  u1: 'Precios con datos reales', u1v: '$ 6.500',
  u2: 'Nuestra comisión 10%',     u2v: '− $ 650',
  u3: 'Horas en papeleo',         u3v: '0',
  withKeep: '$ 5.850',
  pillUS: 'CON NOSOTROS',
  callout: '$850 más en tu bolsillo.',
  calloutSub: 'Una oficina que se paga sola. Solo cobramos cuando tu cliente paga.',
  cta: 'Empieza a ganar más →',
} : { /* EN equivalents — note pillUS: 'WITH US' */ };

export function Pricing({ lang }: { lang: 'en'|'es' }) {
  const c = COPY(lang);
  return (
    <section id="pricing" class="py-[110px] bg-gradient-to-b from-transparent to-mint-200">
      <div class="container mx-auto max-w-[1200px] px-[clamp(20px,5vw,56px)]">
        <SectionHead /* … */ />

        <div class="bg-white rounded-[32px] p-12 lg:p-12 p-8 shadow-xl max-w-[880px] mx-auto relative overflow-hidden border border-coffee-500/16">
          <div class="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-8 items-stretch mb-8">

            {/* WITHOUT */}
            <div class="bg-mint-100 rounded-xl p-7 border-2 border-dashed border-coffee-500/16">
              {/* …label / price / breakdown / keep… */}
            </div>

            {/* ARROW (rotates 90° on mobile) */}
            <div class="flex items-center justify-center text-pink-500 lg:rotate-0 rotate-90">
              <svg /* … */ />
            </div>

            {/* WITH (highlight + localized pill instead of ::before) */}
            <div class="bg-gradient-to-br from-green-50 to-white rounded-xl p-7 border-2 border-green-500 relative">
              <span class="absolute -top-3 left-6 bg-green-500 text-white font-heading font-extrabold text-[11px]
                            px-3 py-1 rounded-full tracking-[0.08em]">{c.pillUS}</span>
              {/* …label / green price / breakdown / fee / keep… */}
            </div>
          </div>

          <div class="bg-pink-500 text-white rounded-xl px-7 py-6 flex items-center justify-between gap-6 flex-wrap">
            <div>
              <div class="font-heading font-extrabold text-[22px] leading-tight">{c.callout}</div>
              <div class="text-sm opacity-90 mt-1">{c.calloutSub}</div>
            </div>
            <a href="#contact" class="bg-white text-pink-500 px-6.5 py-3.5 rounded-[14px] font-heading font-extrabold text-[15px]
                                       inline-flex items-center gap-2 transition-transform duration-200 hover:-translate-y-0.5 whitespace-nowrap">
              {c.cta}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
```

## Props

```ts
type PricingProps = { lang: 'en' | 'es' };
```

## Data source

Static. Numbers (`5,000` / `6,500` / `850`) are illustrative — update only when the marketing team changes the pitch.

## Island vs server

**Server.** No JS.

## Accessibility

- The math grid reads top-to-bottom: "Without us $5,000 / arrow / With us $6,500". With `<dl>` semantics it'd be more accurate (label/value pairs) but the current `<div>` structure is acceptable since the visual hierarchy is clear.
- The arrow SVG needs `aria-hidden="true"` and `focusable="false"`.
- The "CON NOSOTROS" / "WITH US" pill should be a real `<span>`, not a `::before` pseudo-element, so screen readers can read it.
- Callout button is a real `<a href="#contact">` — correct (anchor navigation).

## Edge cases

- **`::before` localization:** see warning above. Replace with a `<span>`.
- **Below 980px:** card padding shrinks, grid → 1 col, arrow rotates 90°. Already covered.
- **Currency formatting:** EN uses `$5,000`, ES uses `$5.000` (period as thousands sep). Hardcode in copy strings, don't try to format.
- **`flex-wrap` on callout:** the white CTA wraps under the heading on narrow widths. Acceptable.
