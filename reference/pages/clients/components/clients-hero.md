# `ClientsHero` — Editorial page header

> ✅ **Build in v1.** Pure presentation. Headline counts come from the same `GET /clients` roll-up the cards use.

## Purpose

The full-bleed editorial header at the top of `/clients`. Left side: a small pulsing `Clients · 12 on the books` crumb, a 44 px headline ("The *twelve people* who keep the lights on."), and a one-line subtitle that surfaces the three meaningful numbers — active jobs in flight, dollars currently owed, and quiet clients worth a hello. Right side: a single pink pill-shaped "Add a client" CTA.

The headline emphasises two words in the brand pink (`<em>`), and **the count interpolates into the copy** ("twelve people", "12 on the books"). Both must reflect the live total — that's the only line of dynamic copy on this header.

## Source

- **JSX:** `Paperwork Monsters Clients.html` lines **3961–3978**
- **CSS:** Clients.html lines **2083–2124** (`.ph2`, `.ph2__crumb`, `.ph2__title`, `.ph2__sub`, `.ph2__cta`) and the responsive collapse at **2298**
- **The `pulse` keyframe** at `2095–2098` is reused by `.loopbar__lbl-dot` and `.cloop__title-dot`; defined once at the page-level CSS scope.

## JSX (verbatim)

```jsx
const ClientsHero = () => (
  <div className="ph2">
    <div>
      <div className="ph2__crumb">
        <span className="ph2__crumb-dot"/> Clients · {CLIENTS.length} on the books
      </div>
      <h1 className="ph2__title">
        The <em>twelve people</em><br/>who keep the lights on.
      </h1>
      <p className="ph2__sub">
        <strong>3 jobs in flight</strong> · <strong>$7,920</strong> currently owed to you · <strong>3 quiet</strong> clients worth a hello.
      </p>
    </div>
    <button className="ph2__cta">
      <I d={ICN.plus} size={14}/> Add a client
    </button>
  </div>
);
```

## CSS (key rules)

```css
.ph2 {
  display: flex; align-items: flex-end; justify-content: space-between;
  gap: 24px; padding: 8px 4px 0; margin-bottom: 24px;
}
.ph2__crumb {
  font-family: var(--font-body);
  font-size: 12px; color: var(--fg-subtle);
  letter-spacing: 0.06em; text-transform: uppercase;
  font-weight: 700; margin-bottom: 10px;
  display: inline-flex; align-items: center; gap: 8px;
}
.ph2__crumb-dot {
  width: 6px; height: 6px; border-radius: 999px;
  background: var(--brand-pink);
  animation: pulse 2.4s infinite;
}
@keyframes pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(255,107,107,0.55); }
  50%      { box-shadow: 0 0 0 6px rgba(255,107,107,0); }
}
.ph2__title {
  font-family: var(--font-heading);
  font-weight: 800; font-size: 44px;
  color: var(--brand-teal);
  line-height: 1.0; letter-spacing: -0.02em;
  margin: 0 0 12px;
  text-wrap: balance;
}
.ph2__title em { font-style: normal; color: var(--brand-pink); }
.ph2__sub {
  color: var(--fg-muted);
  font-size: 15px; line-height: 1.5;
  max-width: 520px;
}
.ph2__sub strong { color: var(--brand-teal); font-weight: 700; }
.ph2__cta {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 12px 18px;
  border-radius: var(--radius-pill);
  background: var(--brand-pink); color: #fff; border: none;
  font-family: var(--font-heading); font-weight: 800; font-size: 13px;
  cursor: pointer; flex-shrink: 0;
  box-shadow: 0 8px 18px -6px rgba(255,107,107,0.5);
  transition: transform var(--dur-fast) var(--ease-bounce), box-shadow var(--dur-fast) var(--ease-out);
}
.ph2__cta:hover { transform: translateY(-2px); box-shadow: 0 12px 22px -6px rgba(255,107,107,0.6); }

@media (max-width: 1100px) {
  .ph2 { flex-direction: column; align-items: flex-start; }
}
```

## Preact / Fresh translation

```tsx
// v2/frontend/components/clients/ClientsHero.tsx — server component
import * as I from "../ui/icons.tsx";

export type ClientsHeroProps = {
  total:       number;        // total clients on the books — drives crumb + headline interpolation
  totalWord:   string;        // "twelve" — pre-computed server-side; same total expressed as English numeral
  activeJobs:  number;        // active jobs in flight
  owedTotal:   string;        // "$7,920" — pre-formatted with currency
  quietCount:  number;        // # of clients in the 'cold' segment
};

export function ClientsHero(props: ClientsHeroProps) {
  return (
    <div class="ph2">
      <div>
        <div class="ph2__crumb">
          <span class="ph2__crumb-dot" /> Clients · {props.total} on the books
        </div>
        <h1 class="ph2__title">
          The <em>{props.totalWord} {props.total === 1 ? 'person' : 'people'}</em><br />
          who keep the lights on.
        </h1>
        <p class="ph2__sub">
          <strong>{props.activeJobs} jobs in flight</strong>
          {' · '}
          <strong>{props.owedTotal}</strong> currently owed to you
          {' · '}
          <strong>{props.quietCount} quiet</strong> {props.quietCount === 1 ? 'client' : 'clients'} worth a hello.
        </p>
      </div>
      <a href="/clients/new" class="ph2__cta">
        <I.Plus size={14} /> Add a client
      </a>
    </div>
  );
}
```

The CTA is styled as a `<button>` in the prototype but should be `<a href>` in production — "Add a client" navigates to a creation flow (`/clients/new` or a modal route).

## Props

```ts
type ClientsHeroProps = {
  total:      number;
  totalWord:  string;   // English word for `total` ("twelve"); server-side `numberToWords()`
  activeJobs: number;
  owedTotal:  string;   // currency-formatted, e.g. "$7,920"
  quietCount: number;
};
```

## Data source

All five fields are derived from the `GET /clients` roll-up that drives the cards grid:

- `total` = `clients.length`
- `totalWord` = English word form (server helper, e.g. `Intl.NumberFormat` won't do this — use a small lookup table for 1–20 and fall back to digits for >20)
- `activeJobs` = count where `status === 'active'`
- `owedTotal` = `Σ max(0, c.balance)` formatted with `$` and thousands separators
- `quietCount` = count where `status === 'cold'`

When `total` is 0 (new contractor, no clients yet), the page should render an **empty state** instead of this hero — different copy and a single big "Add your first client" CTA. See "Edge cases".

## Island vs server

**Server.** No client-side state; just data. Rendered at SSR alongside the rest of the page.

## Accessibility

- Single `<h1>` per page — fine.
- The `<em>` inside the headline is purely visual; screen readers should still read "The twelve people who keep the lights on" naturally because `<em>` carries default emphasis semantics. Don't replace it with `<span>`.
- `.ph2__sub` packs three facts separated by middle-dots. For SR clarity, the rendered string is fine ("3 jobs in flight · $7,920 currently owed to you · 3 quiet clients worth a hello") but consider wrapping in `<ul>` semantically with visually-hidden separators if the design allows.
- `.ph2__crumb-dot` pulses on a 2.4 s loop. Honour `@media (prefers-reduced-motion: reduce)` and disable the keyframe — the dot still reads as a static marker.
- The CTA's box-shadow + lift transform is purely decorative; ensure focus-visible state has a visible outline (the prototype doesn't define one explicitly).

## Edge cases

- **Zero clients (`total === 0`):** swap this hero out for an empty-state hero — different copy ("Your books are blank — let's add your first client.") and a single full-width pink CTA. Don't ship the `{0} people` interpolation; it reads weirdly.
- **One client (`total === 1`):** "The *one person* who keeps the lights on." The `keep` → `keeps` agreement matters and is easy to miss. Use `total === 1 ? 'person' : 'people'` and `total === 1 ? 'keeps' : 'keep'`.
- **More than 20 clients:** numerals only (skip `totalWord` lookup; render `"22 people"` instead of "twenty-two"). The headline still works at large counts.
- **Long `owedTotal`** (e.g. `$1,234,567`): the `.ph2__sub` is `max-width: 520px`; the line wraps naturally — no extra handling needed.
- **`activeJobs === 0` AND `quietCount === 0` AND `owedTotal === '$0'`:** the subtitle reads as three zero-statements. Consider a fallback subtitle for "all clear" days: "Nothing on fire — a calm day on the books."
- **Mobile (<1100 px):** `.ph2` flips to `flex-direction: column` so the CTA drops below the headline. Below 768 px, also reduce `.ph2__title` from 44 px to ~28 px and make the CTA full-width — the prototype doesn't define this, production should add it.
