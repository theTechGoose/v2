# `HowItWorks` — 3-step horizontal process

## Purpose

Section with three numbered circles (1 / 2 / 3) connected by a dashed horizontal line, each with a heading and description. Numbers are colored: pink, green, teal in order. The dashed connector is hidden below 980 px.

## Source

- HTML: `Paperwork Monsters Landing.html` lines **2246–2273**
- CSS: `styles.css` lines **689–729**

## HTML (verbatim)

```html
<section class="how" id="how-it-works">
  <div class="container">
    <div class="section-head">
      <span class="eyebrow-pill" data-i18n="how.eyebrow">Straight to the point</span>
      <h2 data-i18n="how.h2">How it works</h2>
      <p data-i18n="how.lead">Three steps. No forms. No software. We meet you where you already are — your phone.</p>
    </div>

    <div class="how-grid">
      <div class="how-step">
        <div class="num-circle">1</div>
        <h3 data-i18n="how.s1.h">Tell us about the job</h3>
        <p data-i18n="how.s1.p">Send us a text with the job details. We'll ask you one question at a time — no long forms, no hassle.</p>
      </div>
      <div class="how-step">
        <div class="num-circle">2</div>
        <h3 data-i18n="how.s2.h">Check your quote</h3>
        <p data-i18n="how.s2.p">We put together a professional quote with fair pricing. Look it over, change what you need, and give us the thumbs up.</p>
      </div>
      <div class="how-step">
        <div class="num-circle">3</div>
        <h3 data-i18n="how.s3.h">Send it and get paid</h3>
        <p data-i18n="how.s3.p">Send the quote to your client. When the job's done, we turn it into a contract and invoice. Everything's in one place.</p>
      </div>
    </div>
  </div>
</section>
```

## CSS (verbatim)

```css
.how { padding: 110px 0;
       background: linear-gradient(180deg, transparent 0%, rgba(255, 217, 217, 0.25) 100%); }

.how-grid {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 24px; position: relative;
}

/* dashed connecting line behind circles */
.how-grid::before {
  content: ''; position: absolute;
  top: 60px; left: 12%; right: 12%; height: 2px;
  background-image: linear-gradient(90deg, var(--coffee-300) 50%, transparent 50%);
  background-size: 12px 2px; background-repeat: repeat-x;
  z-index: 0;
}

.how-step { position: relative; z-index: 1; text-align: center; padding: 0 12px; }

.how-step .num-circle {
  width: 80px; height: 80px; margin: 0 auto 24px;
  border-radius: 50%;
  background: #fff;
  border: 3px solid var(--brand-pink);                /* default = pink */
  display: flex; align-items: center; justify-content: center;
  font-family: var(--font-heading); font-weight: 800;
  font-size: 36px; color: var(--brand-pink);
  letter-spacing: -0.03em;
  box-shadow: 0 8px 20px rgba(255, 107, 107, 0.25);
  position: relative;
}
.how-step:nth-child(2) .num-circle { border-color: var(--brand-green); color: var(--brand-green);
                                     box-shadow: 0 8px 20px rgba( 81,152, 67, 0.25); }
.how-step:nth-child(3) .num-circle { border-color: var(--brand-teal);  color: var(--brand-teal);
                                     box-shadow: 0 8px 20px rgba( 26, 83, 92, 0.25); }

.how-step h3 { font-family: var(--font-heading); font-weight: 800;
               font-size: 22px; color: var(--brand-teal);
               margin: 0 0 12px; letter-spacing: -0.01em; }
.how-step p  { margin: 0; font-size: 15px; color: var(--fg-muted); line-height: 1.6; }
```

Below 980 px (`styles.css:1167–1168`):
- `grid-template-columns: 1fr`
- `gap: 32px`
- The `::before` connector is hidden.

## Preact / Fresh translation

```tsx
// v2/frontend/components/landing/HowItWorks.tsx — server component

const STEPS = (lang: 'en'|'es') => lang === 'es' ? [
  { n: 1, h: 'Cuéntanos del trabajo', p: 'Mándanos un mensaje con los detalles…' },
  { n: 2, h: 'Revisa tu cotización',  p: 'Armamos una cotización profesional…' },
  { n: 3, h: 'Envía y cobra',         p: 'Mándale la cotización a tu cliente…' },
] : [
  { n: 1, h: 'Tell us about the job', p: "Send us a text with the job details…" },
  { n: 2, h: 'Check your quote',      p: 'We put together a professional quote…' },
  { n: 3, h: 'Send it and get paid',  p: "Send the quote to your client…" },
];

const CIRCLE_COLORS = [
  'border-pink-500  text-pink-500  shadow-[0_8px_20px_rgba(255,107,107,0.25)]',
  'border-green-500 text-green-500 shadow-[0_8px_20px_rgba(81,152,67,0.25)]',
  'border-teal-500  text-teal-500  shadow-[0_8px_20px_rgba(26,83,92,0.25)]',
];

export function HowItWorks({ lang }: { lang: 'en'|'es' }) {
  return (
    <section id="how-it-works"
             class="py-[110px] bg-gradient-to-b from-transparent to-pink-100/25">
      <div class="container mx-auto max-w-[1200px] px-[clamp(20px,5vw,56px)]">
        <SectionHead /* … */ />

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-6 relative
                    before:hidden lg:before:block
                    before:absolute before:top-[60px] before:left-[12%] before:right-[12%] before:h-0.5 before:z-0
                    before:bg-[linear-gradient(90deg,theme(colors.coffee.300)_50%,transparent_50%)]
                    before:bg-[length:12px_2px] before:bg-repeat-x">
          {STEPS(lang).map((s, i) => (
            <div class="relative z-10 text-center px-3">
              <div class={`w-20 h-20 mx-auto mb-6 rounded-full bg-white border-[3px]
                           flex items-center justify-center font-heading font-extrabold
                           text-[36px] -tracking-[0.03em] ${CIRCLE_COLORS[i]}`}>
                {s.n}
              </div>
              <h3 class="font-heading font-extrabold text-[22px] text-teal-500 m-0 mb-3 -tracking-[0.01em]">{s.h}</h3>
              <p class="m-0 text-[15px] text-teal-500/72 leading-[1.6]">{s.p}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

The `::before` connector is the trickiest piece — Tailwind's arbitrary `before:` utilities express it cleanly without writing any custom CSS.

## Props

```ts
type HowItWorksProps = { lang: 'en' | 'es' };
```

## Data source

Static.

## Island vs server

**Server.** No JS.

## Accessibility

- Use `<ol>` instead of `<div class="how-grid">` semantically — the steps are an **ordered** sequence. The visual circles can stay; just wrap each step in an `<li>`.
- The step numbers (1, 2, 3) inside the circles are redundant if the parent is `<ol>` — the SR will already say "1 of 3, 2 of 3…". Mark them `aria-hidden="true"`.
- Heading hierarchy: section h2 → 3× h3. ✓

## Edge cases

- **Below 980px:** dashed line hidden; steps stack vertically with 32 px gaps.
- **Long ES copy** is comparable in length; no special handling.
- **`background-image` dashed line vs Safari:** `background-size: 12px 2px` works in Safari ≥10. Verified pattern.
