# `FeaturesGrid` — 2×2 feature cards

## Purpose

Section header + 2×2 grid of feature cards. Each card has a 64×64 colored icon box (pink/green/teal/coffee), a heading, and a description. Cards lift on hover and gain a `green-100` border.

## Source

- HTML: `Paperwork Monsters Landing.html` lines **2193–2244**
- CSS: `styles.css` lines **648–686**

## HTML (verbatim)

```html
<section class="features" id="features">
  <div class="container">
    <div class="section-head">
      <span class="eyebrow-pill" data-i18n="feat.eyebrow">What we do</span>
      <h2 data-i18n="feat.h2html" data-html="1">We take care of the <em>business side</em></h2>
      <p data-i18n="feat.lead">From the first quote to the final invoice — we handle it so you can stay on the job.</p>
    </div>

    <div class="features-grid">

      <div class="feature">
        <div class="feature-icon pink">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2v4"/><path d="M12 18v4"/>
            <path d="M4.93 4.93l2.83 2.83"/><path d="M16.24 16.24l2.83 2.83"/>
            <path d="M2 12h4"/><path d="M18 12h4"/>
            <circle cx="12" cy="12" r="4"/>
          </svg>
        </div>
        <div>
          <h3 data-i18n="feat.f1.h">Fair prices, not guesses</h3>
          <p data-i18n="feat.f1.p">Real construction pricing data, adjusted for today's costs. Get a low, middle, and high range so you know exactly where you stand.</p>
        </div>
      </div>

      <div class="feature">
        <div class="feature-icon green">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            <polyline points="9 12 11 14 15 10"/>
          </svg>
        </div>
        <div>
          <h3 data-i18n="feat.f2.h">Contracts that protect you</h3>
          <p data-i18n="feat.f2.p">One tap turns your quote into a real contract. Protect your work and look professional to your clients.</p>
        </div>
      </div>

      <div class="feature">
        <div class="feature-icon teal">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="9" y1="15" x2="15" y2="15"/>
            <line x1="9" y1="11" x2="15" y2="11"/>
          </svg>
        </div>
        <div>
          <h3 data-i18n="feat.f3.h">Simple invoicing</h3>
          <p data-i18n="feat.f3.p">Job done? We turn it into an invoice. Keep track of who's paid and who hasn't — without a spreadsheet.</p>
        </div>
      </div>

      <div class="feature">
        <div class="feature-icon coffee">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
          </svg>
        </div>
        <div>
          <h3 data-i18n="feat.f4.h">Just text us</h3>
          <p data-i18n="feat.f4.p">No fancy apps. No complicated software. Text us the job details and we do the rest. Simple as that.</p>
        </div>
      </div>

    </div>
  </div>
</section>
```

## CSS (verbatim)

```css
.features { padding: 110px 0; }

.features-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 24px; }

.feature {
  background: #fff;
  border-radius: var(--radius-xl);
  padding: 36px;
  box-shadow: var(--shadow-md);
  display: flex; gap: 24px; align-items: flex-start;
  transition: all 240ms var(--ease-bounce);
  border: 1px solid transparent;
}
.feature:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow-lg);
  border-color: var(--green-100);
}

.feature-icon {
  width: 64px; height: 64px; border-radius: 18px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; color: #fff;
}
.feature-icon.pink   { background: var(--brand-pink);  box-shadow: 0 8px 16px rgba(255,107,107,0.3); }
.feature-icon.green  { background: var(--brand-green); box-shadow: 0 8px 16px rgba( 81,152, 67,0.3); }
.feature-icon.teal   { background: var(--brand-teal);  box-shadow: 0 8px 16px rgba( 26, 83, 92,0.3); }
.feature-icon.coffee { background: var(--coffee-500);   box-shadow: 0 8px 16px rgba(100, 69, 54,0.3); }

.feature h3 {
  font-family: var(--font-heading); font-weight: 800;
  font-size: 22px; color: var(--brand-teal);
  margin: 0 0 8px; letter-spacing: -0.01em;
}
.feature p { margin: 0; font-size: 15px; line-height: 1.55; color: var(--fg-muted); }
```

Below 980 px: `.features-grid { grid-template-columns: 1fr; }` (`styles.css:1166`).

## Preact / Fresh translation

```tsx
// v2/frontend/components/landing/FeaturesGrid.tsx — server component

import { SunIcon, ShieldCheckIcon, FileTextIcon, MessageSquareIcon } from "../ui/icons.tsx";

const FEATURES = (lang: 'en'|'es') => [
  { color: 'pink',   icon: <SunIcon          width={28} height={28} stroke={2.2} />, h: …, p: … },
  { color: 'green',  icon: <ShieldCheckIcon  width={28} height={28} stroke={2.2} />, h: …, p: … },
  { color: 'teal',   icon: <FileTextIcon     width={28} height={28} stroke={2.2} />, h: …, p: … },
  { color: 'coffee', icon: <MessageSquareIcon width={28} height={28} stroke={2.2} />, h: …, p: … },
];

const ICON_BG = {
  pink:   'bg-pink-500   shadow-[0_8px_16px_rgba(255,107,107,0.3)]',
  green:  'bg-green-500  shadow-[0_8px_16px_rgba(81,152,67,0.3)]',
  teal:   'bg-teal-500   shadow-[0_8px_16px_rgba(26,83,92,0.3)]',
  coffee: 'bg-coffee-500 shadow-[0_8px_16px_rgba(100,69,54,0.3)]',
} as const;

export function FeaturesGrid({ lang }: { lang: 'en'|'es' }) {
  return (
    <section id="features" class="py-[110px]">
      <div class="container mx-auto max-w-[1200px] px-[clamp(20px,5vw,56px)]">
        <SectionHead /* … */ />
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {FEATURES(lang).map(f => (
            <div class="bg-white rounded-xl p-9 shadow-md flex gap-6 items-start
                        border border-transparent transition-all duration-[240ms] ease-bounce
                        hover:-translate-y-[3px] hover:shadow-lg hover:border-green-100">
              <div class={`w-16 h-16 rounded-[18px] flex items-center justify-center shrink-0 text-white ${ICON_BG[f.color]}`}>
                {f.icon}
              </div>
              <div>
                <h3 class="font-heading font-extrabold text-[22px] text-teal-500 m-0 mb-2 -tracking-[0.01em]">{f.h}</h3>
                <p class="m-0 text-[15px] leading-[1.55] text-teal-500/72">{f.p}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

The four SVGs are inline-able as `components/ui/icons.tsx` exports — keep the exact paths from the verbatim HTML. Don't bring in lucide-react / heroicons just for these four; the prototype already has the exact glyphs.

## Props

```ts
type FeaturesGridProps = { lang: 'en' | 'es' };
```

## Data source

Static.

## Island vs server

**Server.** No JS.

## Accessibility

- Each feature is a `<div>` — fine, but the icon box should have `aria-hidden="true"` (decorative, the heading carries the meaning).
- Heading hierarchy: section h2 → 4× h3 inside cards. Correct.
- Color of the icon box conveys nothing semantic — it's purely decorative.

## Edge cases

- **Below 980px:** grid → 1 col (already covered).
- **Long ES copy:** "Facturación sencilla" / "¿Trabajo terminado? Lo convertimos en factura..." longer than EN; row heights vary — `align-items: flex-start` keeps icons fixed at top.
- **Hover on touch:** lift triggers on tap; same hover-media-query advice as in `problem-cards.md`.
