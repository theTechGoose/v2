# `DocTabs` — Quote / Contract / Invoice tab mockup with counter

## Purpose

Tab switcher above a split panel: left side renders a faux document mockup (line items, totals), right side renders explanatory copy with a checklist. Tabs cycle through three documents: Quote (#PM-2641), Contract (#PM-2641-C), Invoice (#PM-2641-I). Below the panel, a teal "documents sent so far" counter strip animates from 0 → 48,217 when scrolled into view.

## Source

- HTML: `Paperwork Monsters Landing.html` lines **2143–2191**
- CSS: `styles.css` lines **497–646**
- JS:
  - Tab switching + content render: `Landing.html:218–321`
  - Counter animation (IntersectionObserver + RAF): `Landing.html:323–341`

## HTML (verbatim)

```html
<section class="docs">
  <div class="container">
    <div class="section-head">
      <span class="eyebrow-pill" data-i18n="docs.eyebrow">One text. Three documents.</span>
      <h2 data-i18n="docs.h2html" data-html="1">Quote, contract, invoice — <em>handled</em>.</h2>
      <p data-i18n="docs.lead">Send us a message. We send back a real document with real numbers — not a sketch on the back of an envelope.</p>
    </div>

    <div class="doc-tabs" role="tablist">
      <button class="doc-tab on" data-doc="quote">    <span class="step">01</span> <span data-i18n="docs.tab.quote">Quote</span></button>
      <button class="doc-tab"    data-doc="contract"> <span class="step">02</span> <span data-i18n="docs.tab.contract">Contract</span></button>
      <button class="doc-tab"    data-doc="invoice">  <span class="step">03</span> <span data-i18n="docs.tab.invoice">Invoice</span></button>
    </div>

    <div class="doc-stage">
      <div class="doc-mockup">
        <div class="doc-mockup-header">
          <h5 id="doc-title">Quote</h5>
          <div class="num">
            <strong id="doc-num">#PM-2641</strong>
            <span    id="doc-date">April 26, 2026</span>
          </div>
        </div>
        <div id="doc-lines"></div>
        <div class="doc-totals" id="doc-totals"></div>
      </div>

      <div class="doc-info" id="doc-info">
        <h3 id="doc-info-title"></h3>
        <p  id="doc-info-body"></p>
        <ul id="doc-info-list"></ul>
      </div>
    </div>

    <div class="doc-counter">
      <div>
        <div class="label" data-i18n="docs.counter.label">Documents sent so far</div>
        <div class="big" id="doc-counter-num">0</div>
      </div>
      <div class="types">
        <span data-i18n="docs.counter.t1">Quotes</span>
        <span data-i18n="docs.counter.t2">Contracts</span>
        <span data-i18n="docs.counter.t3">Invoices</span>
        <span data-i18n="docs.counter.t4">Change orders</span>
      </div>
    </div>
  </div>
</section>
```

## Static seed data (verbatim from `Landing.html:218–293`)

```js
const docContent = {
  en: {
    quote: {
      title: 'Quote', num: '#PM-2641', date: 'April 26, 2026',
      lines: [['Demolition & haul-off',         '1',      '$ 850',  '$ 850'],
              ['Cabinets — solid maple',        '12',     '$ 350',  '$ 4,200'],
              ['Quartz countertops (sq ft)',    '42',     '$ 95',   '$ 3,990'],
              ['Plumbing & install labor',      '3 days', '$ 650',  '$ 1,950']],
      totals: [['Subtotal','$ 10,990'],['Tax (estimate)','$ 880'],['Estimate','$ 11,870']],
      infoTitle: 'Fair prices, not guesses',
      infoBody:  "We pull from real construction pricing data — adjusted for today's costs and your zip code. You get a low, mid, and high range so you know exactly where you stand.",
      infoList:  ['Low / mid / high pricing ranges','Local material costs, refreshed weekly',
                  'Branded PDF you can text or email','Edit anything in one tap'],
    },
    contract: {
      title: 'Contract', num: '#PM-2641-C', date: 'April 26, 2026',
      lines: [['Scope: Kitchen remodel — Hernández', '', '', '✓'],
              ['Start date',                          '', '', 'May 2'],
              ['Substantial completion',              '', '', 'May 14'],
              ['Deposit (25%)',                       '', '', '$ 2,500'],
              ['Progress payment (50%)',              '', '', '$ 5,495'],
              ['Final payment',                       '', '', '$ 2,995']],
      totals: [['Total contract value','$ 10,990'],['Signed by client','✓ Apr 26'],['Status','Active']],
      infoTitle: 'Contracts that protect you',
      infoBody:  'One tap turns your quote into a real, lawyer-reviewed contract. Spell out the scope, the schedule, and the payments — so there are no surprises later.',
      infoList:  ['State-specific terms, ready to go','E-signature from your client',
                  'Auto deposit + progress milestones','Stored alongside the job, forever'],
    },
    invoice: {
      title: 'Invoice', num: '#PM-2641-I', date: 'May 14, 2026',
      lines: [['Kitchen remodel — completed',         '', '', '$ 10,990'],
              ['Change order: under-cabinet lighting','1','$ 420','$ 420'],
              ['Deposit received',                     '','','− $ 2,500'],
              ['Progress payment received',            '','','− $ 5,495']],
      totals: [['Balance due','$ 3,415'],['Due by','May 18, 2026'],['Pay online','tap to pay']],
      infoTitle: 'Simple invoicing, paid faster',
      infoBody:  "Job done? We turn the contract into an invoice. Track who's paid, who hasn't, and send a one-tap reminder when it's time.",
      infoList:  ['One-tap "pay now" link for clients','Automatic payment reminders',
                  'See balance due at a glance','Export for taxes and bookkeeping'],
    },
  },
  es: { /* mirror — see Landing.html:255–293 */ },
};
```

## CSS (key rules — verbatim)

### Tabs

```css
.docs {
  padding: 110px 0;
  background: linear-gradient(180deg, transparent 0%, var(--mint-200) 50%, transparent 100%);
}
.doc-tabs { display: flex; justify-content: center; gap: 10px;
            margin-bottom: 40px; flex-wrap: wrap; }
.doc-tab  {
  background: #fff;
  border: 1.5px solid var(--border);
  border-radius: var(--radius-pill);
  padding: 12px 24px;
  font-family: var(--font-heading); font-weight: 700;
  font-size: 15px; color: var(--brand-teal);
  cursor: pointer;
  transition: all 200ms var(--ease-bounce);
  display: inline-flex; align-items: center; gap: 8px;
}
.doc-tab .step { background: var(--mint-200); color: var(--brand-teal);
                 font-size: 11px; font-weight: 800; padding: 2px 8px; border-radius: 999px; }
.doc-tab.on   { background: var(--brand-teal); color: #fff; border-color: var(--brand-teal);
                transform: translateY(-1px);
                box-shadow: 0 8px 20px rgba(26, 83, 92, 0.3); }
.doc-tab.on .step { background: var(--brand-pink); color: #fff; }
```

### Stage panel + 4-color rainbow top stripe

```css
.doc-stage {
  background: #fff;
  border-radius: var(--radius-2xl);
  padding: 40px;
  box-shadow: var(--shadow-xl);
  display: grid; grid-template-columns: 1.4fr 1fr;
  gap: 48px; align-items: center;
  border: 1px solid var(--border);
  position: relative; overflow: hidden;
}
.doc-stage::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 4px;
  background: linear-gradient(90deg, var(--brand-pink), var(--brand-green), var(--brand-teal));
}
```

### Document mockup (left side)

```css
.doc-mockup {
  background: var(--mint-100);
  border-radius: var(--radius-xl);
  padding: 32px;
  font-family: var(--font-body);
  border: 1px dashed var(--border-strong);
  position: relative;
}
.doc-mockup-header {
  display: flex; justify-content: space-between; align-items: flex-start;
  padding-bottom: 16px;
  border-bottom: 2px solid var(--brand-teal);
  margin-bottom: 20px;
}
.doc-mockup-header h5 {
  font-family: var(--font-heading); font-weight: 800;
  font-size: 22px; color: var(--brand-teal);
  margin: 0; letter-spacing: -0.01em;
}
.doc-mockup-header .num         { font-family: var(--font-mono); font-size: 12px; color: var(--fg-muted);
                                   text-align: right; }
.doc-mockup-header .num strong  { display: block; color: var(--brand-teal);
                                   font-family: var(--font-heading); font-weight: 800;
                                   font-size: 14px; margin-bottom: 2px; }

.doc-line {
  display: grid; grid-template-columns: 1fr auto auto auto;
  gap: 16px; padding: 8px 0;
  font-size: 13px; color: var(--fg);
  border-bottom: 1px dashed rgba(100, 69, 54, 0.12);
}
.doc-line .desc            { color: var(--brand-teal); font-weight: 600; }
.doc-line .qty,
.doc-line .rate,
.doc-line .amt             { font-family: var(--font-mono); }
.doc-line .amt             { font-weight: 700; color: var(--brand-teal); }

.doc-totals               { margin-top: 16px; padding-top: 12px;
                            display: grid; gap: 4px; justify-content: end;
                            font-size: 13px; color: var(--fg-muted); }
.doc-totals .row          { display: grid; grid-template-columns: auto 100px;
                            gap: 24px; text-align: right; font-family: var(--font-mono); }
.doc-totals .row.total    { font-family: var(--font-heading); font-weight: 800;
                            font-size: 22px; color: var(--brand-pink);
                            margin-top: 8px; padding-top: 10px;
                            border-top: 2px solid var(--brand-teal); }
```

### Info column (right side) — h3 + p + checklist

```css
.doc-info h3 { font-family: var(--font-heading); font-weight: 800;
               font-size: 32px; line-height: 1.1; color: var(--brand-teal);
               margin: 0 0 16px; letter-spacing: -0.02em; }
.doc-info p  { font-size: 16px; color: var(--fg-muted); line-height: 1.6;
               margin: 0 0 20px; }
.doc-info ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 12px; }
.doc-info li { display: flex; align-items: flex-start; gap: 12px;
               font-size: 15px; color: var(--brand-teal); }
.doc-info li svg { flex-shrink: 0; margin-top: 2px; color: var(--brand-green); }
```

### Counter strip

```css
.doc-counter {
  margin-top: 32px;
  background: var(--brand-teal); color: #fff;
  border-radius: var(--radius-xl); padding: 24px 32px;
  display: flex; align-items: center; justify-content: space-between;
  gap: 32px;
  position: relative; overflow: hidden;
}
.doc-counter::after {                              /* pink halo bottom-right */
  content: ''; position: absolute; right: -50px; top: -50px;
  width: 220px; height: 220px; border-radius: 50%;
  background: rgba(255, 107, 107, 0.18);
}
.doc-counter .label  { font-family: var(--font-heading); font-weight: 700;
                        font-size: 14px; opacity: 0.7;
                        text-transform: uppercase; letter-spacing: 0.08em; }
.doc-counter .big    { font-family: var(--font-heading); font-weight: 800;
                        font-size: 56px; line-height: 1; letter-spacing: -0.03em;
                        color: var(--brand-pink); }
.doc-counter .types  { display: flex; gap: 8px; flex-wrap: wrap; position: relative; z-index: 1; }
.doc-counter .types span {
  background: rgba(255,255,255,0.12);
  border-radius: var(--radius-pill);
  padding: 8px 16px;
  font-family: var(--font-heading); font-weight: 700; font-size: 13px;
}
```

## JS (verbatim — tab switcher + counter)

### Render-on-tab

```js
let activeDoc = 'quote';
function renderDoc(key) {
  activeDoc = key;
  const d = docContent[curLang][key];
  document.getElementById('doc-title').textContent = d.title;
  document.getElementById('doc-num').textContent   = d.num;
  document.getElementById('doc-date').textContent  = d.date;
  document.getElementById('doc-lines').innerHTML   = d.lines.map(l =>
    `<div class="doc-line">
       <span class="desc">${l[0]}</span>
       <span class="qty">${l[1]}</span>
       <span class="rate">${l[2]}</span>
       <span class="amt">${l[3]}</span>
     </div>`
  ).join('');
  document.getElementById('doc-totals').innerHTML = d.totals.map((t, i) =>
    `<div class="row${i === d.totals.length - 1 ? ' total' : ''}">
       <span>${t[0]}</span><span>${t[1]}</span>
     </div>`
  ).join('');
  document.getElementById('doc-info-title').textContent = d.infoTitle;
  document.getElementById('doc-info-body').textContent  = d.infoBody;
  const checkSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  document.getElementById('doc-info-list').innerHTML = d.infoList.map(x => `<li>${checkSvg} ${x}</li>`).join('');
}
window.renderActiveDoc = () => renderDoc(activeDoc);

document.querySelectorAll('.doc-tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.doc-tab').forEach(x => x.classList.remove('on'));
    t.classList.add('on');
    renderDoc(t.dataset.doc);
  });
});
```

### Counter (IntersectionObserver + cubic-out RAF)

```js
const counter = document.getElementById('doc-counter-num');
const target = 48217;
let counterFired = false;
new IntersectionObserver(es => es.forEach(e => {
  if (e.isIntersecting && !counterFired) {
    counterFired = true;
    const start = performance.now(); const dur = 1800;
    const tick = ts => {
      const p = Math.min(1, (ts - start) / dur);
      const ease = 1 - Math.pow(1 - p, 3);
      counter.textContent = Math.round(target * ease)
        .toLocaleString(curLang === 'es' ? 'es-ES' : 'en-US');
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}), { threshold: 0.3 }).observe(counter);
```

The counter target `48217` is hardcoded in the prototype. **In production, fetch from `GET /analytics/dashboard` (see `backend.md` §3.D) — there's no field exactly matching "documents sent globally", but a derived `quotes.total + contracts.total + invoices.total` aggregated across all contractors would do. For v1 launch, leave hardcoded — the value is marketing-decorative, not data-bound.**

## Preact / Fresh translation

```tsx
// v2/frontend/islands/DocTabs.tsx — island (state + counter timer)
import { useState, useEffect, useRef } from "preact/hooks";
import { langSignal } from "../lib/lang-signal.ts";
import { CONTENT } from "../lib/landing-doc-content.ts";   // the docContent above

type DocKey = 'quote' | 'contract' | 'invoice';

export function DocTabs() {
  const [active, setActive] = useState<DocKey>('quote');
  const lang = langSignal.value;
  const d = CONTENT[lang][active];

  // Counter
  const [count, setCount] = useState(0);
  const counterRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!counterRef.current) return;
    const target = 48217;
    let fired = false;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || fired) return;
      fired = true;
      const start = performance.now();
      const tick = (ts: number) => {
        const p = Math.min(1, (ts - start) / 1800);
        const ease = 1 - Math.pow(1 - p, 3);
        setCount(Math.round(target * ease));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, { threshold: 0.3 });
    io.observe(counterRef.current);
    return () => io.disconnect();
  }, []);

  return (
    <section class="py-[110px] bg-gradient-to-b from-transparent via-mint-200 to-transparent">
      {/* …section-head, tabs, doc-stage, doc-counter… */}
    </section>
  );
}
```

The static EN/ES content moves to `lib/landing-doc-content.ts`. Tabs are a `role="tablist"` / `role="tab"` / `role="tabpanel"` triad — see Accessibility below.

## Props

```ts
type DocTabsProps = {};
```

## Data source

Static seed (`docContent`). Counter is hardcoded `48217` for v1 — see note above.

## Island vs server

**Island.** Tab clicks change rendered content; counter animates on scroll-into-view.

## Accessibility

The prototype has `role="tablist"` on the tab container but **doesn't wire up `role="tab"` / `role="tabpanel"` / `aria-selected` / keyboard arrow nav.** Production must add:

- `role="tab"` + `aria-selected={active === key}` + `aria-controls="doc-stage"` on each tab
- `role="tabpanel"` + `aria-labelledby={activeTabId}` on the doc-stage
- Arrow-key navigation between tabs (Left/Right cycles)
- `tabIndex={active === key ? 0 : -1}` so only the active tab is in the natural tab order

Counter is a number changing rapidly — wrap in `aria-hidden="true"` so screen readers don't announce every tick. Provide a static screen-reader-only fallback: `<span class="sr-only">Documents sent so far: 48,217</span>`.

## Edge cases

- **Tab click before counter fires:** the IO is watching the counter, not the panel. Independent state. ✓
- **Lang switch with non-quote tab active:** call `renderDoc(activeDoc)` after `applyLang()` (the prototype does — `Landing.html:141`). The Preact translation re-derives `d` from the signal automatically.
- **Counter scroll past then back:** `counterFired` is a one-shot flag — counter doesn't re-animate. Intentional.
- **Locale formatting:** `toLocaleString('es-ES')` produces `48.217` (period separator), `'en-US'` produces `48,217`. Drives `lang` from signal.
- **`renderDoc` `<svg>` in i18n list:** the prototype injects raw SVG via `innerHTML`. In Preact use a JSX `<CheckIcon />` component to avoid `dangerouslySetInnerHTML`.
- **Below 980px:** stage collapses to single column (`styles.css:1165`); counter goes vertical (`styles.css:1174`). Tabs already wrap (`flex-wrap: wrap`).
