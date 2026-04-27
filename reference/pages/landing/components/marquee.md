# `Marquee` — Looping value-prop strip

## Purpose

Full-width horizontal scroller below the hero. Teal background with pink/green dot separators between six short value props. Pure CSS animation. Bilingual.

## Source

- HTML: `Paperwork Monsters Landing.html` lines **2106–2112**
- CSS: `styles.css` lines **391–416**
- JS: `Paperwork Monsters Landing.html` lines **125–139** (i18n re-renders the marquee track)

## HTML (verbatim)

```html
<div class="marquee" aria-hidden="true">
  <div class="marquee-track" id="marquee-track">
    <span data-en="30% average revenue increase|Professional quotes in minutes|Contracts with one tap|Invoices that track payments|No apps to download|Just text us"
          data-es="30% más ingresos en promedio|Cotizaciones pro en minutos|Contratos con un toque|Facturas que rastrean pagos|Sin apps que descargar|Solo escríbenos"></span>
  </div>
</div>
```

The single `<span>` carries pipe-delimited copy in both languages. The i18n script (`applyLang`) splits on `|`, builds two duplicated `<span>` runs (so the loop seam is invisible), and inserts coloured dots between items.

## CSS (verbatim)

```css
.marquee {
  background: var(--brand-teal); color: var(--mint-100);
  padding: 22px 0; overflow: hidden;
  border-top:    4px solid var(--brand-pink);
  border-bottom: 4px solid var(--brand-green);
  position: relative;
}
.marquee-track {
  display: flex; gap: 56px;
  white-space: nowrap;
  animation: marquee 38s linear infinite;
  font-family: var(--font-heading); font-weight: 800;
  font-size: 22px; letter-spacing: -0.01em;
}
.marquee-track span         { display: inline-flex; align-items: center; gap: 56px; }
.marquee-track .dot         { width: 10px; height: 10px; border-radius: 999px;
                              background: var(--brand-pink); flex-shrink: 0; }
.marquee-track .dot.green   { background: var(--brand-green); }
@keyframes marquee {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}
```

The `-50%` translate works because the JS duplicates the items into two adjacent runs — moving by half the track width loops invisibly.

## JS (verbatim — fragment from `applyLang()`)

```js
const mq = document.getElementById('marquee-track');
const items = mq.querySelector('span').getAttribute('data-' + lang).split('|');
mq.innerHTML = '';
for (let i = 0; i < 2; i++) {                      // duplicate for seamless loop
  const seg = document.createElement('span');
  seg.setAttribute('data-en', mq.dataset.en || '');
  items.forEach((item, j) => {
    const t = document.createTextNode(item);
    seg.appendChild(t);
    const dot = document.createElement('span');
    dot.className = 'dot' + (j % 2 === 0 ? '' : ' green');     // alternating colors
    seg.appendChild(dot);
  });
  mq.appendChild(seg);
}
```

## Preact / Fresh translation

```tsx
// v2/frontend/components/landing/Marquee.tsx — server component
import { langSignal } from "../../lib/lang-signal.ts";

const ITEMS = {
  en: ['30% average revenue increase', 'Professional quotes in minutes',
       'Contracts with one tap', 'Invoices that track payments',
       'No apps to download', 'Just text us'],
  es: ['30% más ingresos en promedio', 'Cotizaciones pro en minutos',
       'Contratos con un toque', 'Facturas que rastrean pagos',
       'Sin apps que descargar', 'Solo escríbenos'],
};

export function Marquee() {
  const items = ITEMS[langSignal.value];
  const run = (
    <span class="inline-flex items-center gap-14">
      {items.map((it, j) => (
        <>
          {it}
          <span class={`w-2.5 h-2.5 rounded-full shrink-0 ${j % 2 === 0 ? 'bg-pink-500' : 'bg-green-500'}`} />
        </>
      ))}
    </span>
  );
  return (
    <div aria-hidden="true"
         class="bg-teal-500 text-mint-100 py-5.5 overflow-hidden border-t-4 border-pink-500 border-b-4 border-b-green-500 relative">
      <div class="flex gap-14 whitespace-nowrap font-heading font-extrabold text-[22px] -tracking-[0.01em] animate-marquee">
        {run}
        {run}
      </div>
    </div>
  );
}
```

Add to `tailwind.config.ts`:

```ts
extend: {
  keyframes: {
    marquee: { from: { transform: 'translateX(0)' }, to: { transform: 'translateX(-50%)' } },
  },
  animation: { marquee: 'marquee 38s linear infinite' },
}
```

## Props

```ts
type MarqueeProps = {};
```

## Data source

Static, hardcoded above. Could become CMS-driven later (each pipe-delimited item from a single string field).

## Island vs server

**Server.** No JS needed — the language signal is read at server render; on language toggle the page re-renders the marquee run. (Alternatively make it an island and read `langSignal.value` reactively. Either works.)

## Accessibility

- `aria-hidden="true"` is correct — decorative.
- Honors `prefers-reduced-motion` automatically via the global `colors_and_type.css:248–253` rule (`animation-duration: 0.01ms`). Without animation it shows a static run, which is fine.

## Edge cases

- **Long copy in ES** ("30% más ingresos en promedio") doesn't break the loop because the duplicated run scales with content length.
- **First/last item adjacency:** the `-50%` loop assumes the duplicated runs are identical. Don't render an odd number of runs.
- **Pause on hover:** not in the prototype. Skip unless requested — the constant motion is intentional energy.
