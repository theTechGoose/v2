# `ProblemCards` — 3-column "the problem" section

## Purpose

Centered section header + 3 white cards in a row. Each card has a large gradient-text number (`01`, `02`, `03`), a heading, and one descriptive paragraph. Cards lift on hover.

## Source

- HTML: `Paperwork Monsters Landing.html` lines **2114–2141**
- CSS: `styles.css` lines **456–489**

## HTML (verbatim)

```html
<section class="problem">
  <div class="container">
    <div class="section-head">
      <span class="eyebrow-pill" data-i18n="problem.eyebrow">The problem</span>
      <h2 data-i18n="problem.h2html" data-html="1">Good work deserves <em>good paperwork</em></h2>
      <p data-i18n="problem.lead">You know your trade. But chasing down quotes on scrap paper and guessing at prices is costing you real money.</p>
    </div>

    <div class="problem-grid">
      <div class="problem-card">
        <span class="num">01</span>
        <h3 data-i18n="problem.c1.h">Leaving money on the table</h3>
        <p data-i18n="problem.c1.p">Without solid pricing info, most contractors bid too low. That means less money in your pocket for the same hard work.</p>
      </div>
      <div class="problem-card">
        <span class="num">02</span>
        <h3 data-i18n="problem.c2.h">Paperwork that doesn't look right</h3>
        <p data-i18n="problem.c2.p">Handwritten quotes on notebook paper don't build trust. Clients pick the contractor who looks like they have it together.</p>
      </div>
      <div class="problem-card">
        <span class="num">03</span>
        <h3 data-i18n="problem.c3.h">Hours you're not getting paid for</h3>
        <p data-i18n="problem.c3.p">Every hour figuring out paperwork is an hour you could be on a job site earning real money.</p>
      </div>
    </div>
  </div>
</section>
```

`<em>` inside the h2 is colored pink and remains italic-styled-not-italic — the i18n payload (`problem.h2html`) is HTML, not text, so it preserves the `<em>` wrapping. This is the **only place on landing** that uses HTML i18n; carry the pattern forward.

## CSS (verbatim)

```css
.problem { padding: 110px 0; }

.problem-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px;
}
.problem-card {
  background: #fff;
  border-radius: var(--radius-xl);
  padding: 32px;
  box-shadow: var(--shadow-md);
  position: relative;
  transition: transform 240ms var(--ease-bounce), box-shadow 240ms;
}
.problem-card:hover { transform: translateY(-4px); box-shadow: var(--shadow-lg); }

.problem-card .num {
  font-family: var(--font-heading); font-weight: 800;
  font-size: 56px;
  background: linear-gradient(135deg, var(--brand-pink) 0%, var(--coffee-500) 100%);
  -webkit-background-clip: text; background-clip: text;
  color: transparent;
  line-height: 1; letter-spacing: -0.03em;
  display: block; margin-bottom: 14px;
  opacity: 0.5;
}
.problem-card h3 {
  font-family: var(--font-heading); font-weight: 800;
  font-size: 22px; line-height: 1.2; color: var(--brand-teal);
  margin: 0 0 12px; letter-spacing: -0.01em;
}
.problem-card p {
  margin: 0; font-size: 15px; line-height: 1.6;
  color: var(--fg-muted);
}
```

`.section-head` and `.eyebrow-pill` are shared primitives — defined in `styles.css` lines 421–453 (also used by every other section).

## Preact / Fresh translation

```tsx
// v2/frontend/components/landing/ProblemCards.tsx — server component
import { SectionHead } from "../ui/SectionHead.tsx";

const CARDS = {
  en: [
    { n: '01', h: 'Leaving money on the table',          p: "Without solid pricing info, most contractors bid too low. That means less money in your pocket for the same hard work." },
    { n: '02', h: "Paperwork that doesn't look right",   p: "Handwritten quotes on notebook paper don't build trust. Clients pick the contractor who looks like they have it together." },
    { n: '03', h: "Hours you're not getting paid for",   p: "Every hour figuring out paperwork is an hour you could be on a job site earning real money." },
  ],
  es: [/* … */],
};

export function ProblemCards({ lang }: { lang: 'en' | 'es' }) {
  const cards = CARDS[lang];
  return (
    <section class="py-[110px]">
      <div class="container mx-auto px-[clamp(20px,5vw,56px)] max-w-[1200px]">
        <SectionHead
          eyebrow={lang === 'es' ? 'El problema' : 'The problem'}
          headingHTML={lang === 'es'
            ? 'Buen trabajo merece <em class="text-pink-500 not-italic">buen papeleo</em>'
            : 'Good work deserves <em class="text-pink-500 not-italic">good paperwork</em>'}
          lead={/* … */}
        />
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {cards.map(c => (
            <div class="bg-white rounded-xl p-8 shadow-md transition-all duration-200 ease-bounce hover:-translate-y-1 hover:shadow-lg">
              <span class="block font-heading font-extrabold text-[56px] leading-none -tracking-[0.03em] mb-3.5 opacity-50
                           bg-clip-text text-transparent bg-gradient-to-br from-pink-500 to-coffee-500">{c.n}</span>
              <h3 class="font-heading font-extrabold text-[22px] leading-tight text-teal-500 mb-3 -tracking-[0.01em]">{c.h}</h3>
              <p class="m-0 text-[15px] leading-[1.6] text-teal-500/72">{c.p}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

`SectionHead` should be a shared `components/ui/` primitive — **every section uses it**. Signature:

```ts
type SectionHeadProps = { eyebrow: string; headingHTML: string; lead?: string; };
```

Renders `<div class="text-center max-w-[720px] mx-auto mb-14"><span class="eyebrow-pill">…</span><h2 dangerouslySetInnerHTML={{__html: headingHTML}}/><p>…</p></div>` — see `styles.css:434–453` for the exact rules.

## Props

```ts
type ProblemCardsProps = { lang: 'en' | 'es' };
```

## Data source

Static.

## Island vs server

**Server component.** No JS.

## Accessibility

- `<section>` should have an accessible name — the h2 inside `SectionHead` provides it via `aria-labelledby` if you want to be explicit.
- `<em>` inside h2 carries no semantic meaning here — purely visual (pink tint). Optionally swap for `<span class="text-pink-500">` to avoid mis-styling for SR users.
- Decorative gradient numbers are rendered as text (not images) — already accessible.

## Edge cases

- **Below 980px:** grid collapses to single column (`styles.css:1164`).
- **Long ES headings:** "Papeles que no se ven bien" is shorter than EN; layout doesn't shift.
- **Number gradient text:** `background-clip: text` requires `-webkit-background-clip: text` for Safari — keep both.
- **Hover state on touch:** the lift effect triggers on tap; consider `@media (hover: hover)` to disable on touch devices.
