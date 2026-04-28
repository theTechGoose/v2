# `QuotesHero` — Editorial pipeline header

> ✅ **Build in v1.** Pure presentation. Counts derive from the same `GET /quotes` payload that drives the cards.

## Purpose

The page header. Left side: a small pulsing "The pipeline this week" eyebrow, a 28–44 px headline that names the **dollar value of open quotes** + **stale-quote count** in the same line, and a subtitle that names the open count, distinct-clients count, and stale count again with a CTA-shaped imperative ("start there, then hit the hot ones while they're still warm"). Right side: a single pink pill-shaped "New quote" CTA.

The page's emotional weight lives in the headline — opening on the dollar value of work-in-flight is intentional. Contractors don't think of quotes as a list; they think of them as money that hasn't landed yet. The hero leads with the money.

## Source

- **JSX:** `Paperwork Monsters Quotes.html` lines **4989–5014**
- **CSS:** Quotes.html lines **1748–1796** (`.qph*`) and the responsive collapse at **2377**
- **Helper:** `fmtMoney(n)` at line 4987 — `(n) => n.toLocaleString()`. Promote to `frontend/lib/format.ts`.

## JSX (verbatim)

```jsx
const QuotesHero = () => {
  const open = QPIPELINE.filter(q => ['draft','sent','opened','cooling','stale'].includes(q.stage));
  const openTotal = open.reduce((s,q) => s + q.value, 0);
  const stale = QPIPELINE.filter(q => q.stage === 'stale');
  return (
    <div className="qph">
      <div>
        <div className="qph__eyebrow">
          <span className="qph__eyebrow-dot"/>
          The pipeline this week
        </div>
        <h1 className="qph__title">
          <em>${fmtMoney(openTotal)}</em> of work sitting with clients,<br/>
          {stale.length} {stale.length === 1 ? 'quote' : 'quotes'} that need a nudge.
        </h1>
        <p className="qph__sub">
          {open.length} open quotes across {new Set(open.map(q => q.client)).size} clients. The monsters
          flagged <strong>{stale.length}</strong> as cooling off — start there, then hit the hot ones while they're still warm.
        </p>
      </div>
      <button className="qph__cta">
        <I d={ICN.plus} size={14} sw={2.5}/> New quote
      </button>
    </div>
  );
};
```

## CSS (key rules)

```css
.qph {
  display: flex; align-items: flex-end; justify-content: space-between;
  gap: 24px;
  padding: 18px 0 22px;
  border-bottom: 1px solid rgba(26,83,92,0.08);
  margin-bottom: 22px;
}
.qph__eyebrow {
  display: inline-flex; align-items: center; gap: 8px;
  font-family: var(--font-heading);
  font-size: 11px; font-weight: 700;
  letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--brand-pink);
  margin-bottom: 6px;
}
.qph__eyebrow-dot {
  width: 6px; height: 6px; border-radius: 999px; background: var(--brand-pink);
}
.qph__title {
  font-family: var(--font-heading);
  font-weight: 800; font-size: clamp(28px, 4vw, 44px);
  color: var(--brand-teal); line-height: 1.05;
  letter-spacing: -0.02em;
  margin: 0 0 12px;
  text-wrap: balance;
}
.qph__title em { color: var(--brand-pink); font-style: normal; }

.qph__sub {
  font-family: var(--font-body);
  font-size: 14.5px; color: var(--fg-muted); line-height: 1.5;
  max-width: 520px;
  text-wrap: pretty;
}
.qph__sub strong { color: var(--brand-teal); font-weight: 700; }

.qph__cta {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 13px 20px;
  background: var(--brand-pink); color: #fff; border: none;
  border-radius: var(--radius-pill);
  font-family: var(--font-heading); font-weight: 800; font-size: 13px;
  letter-spacing: 0.01em;
  cursor: pointer;
  box-shadow: 0 8px 18px -8px rgba(255,107,107,0.55);
  transition: transform var(--dur-fast) var(--ease-out);
  flex-shrink: 0;
}
.qph__cta:hover { transform: translateY(-1px); }

@media (max-width: 1200px) {
  .qph { flex-direction: column; align-items: flex-start; }
}
```

## Preact / Fresh translation

```tsx
// v2/frontend/components/quotes/QuotesHero.tsx — server component
import * as I from "../ui/icons.tsx";
import { fmtMoney } from "../../lib/format.ts";

export type QuotesHeroProps = {
  openCount:    number;       // count where stage in ['draft','sent','opened','cooling','stale']
  openTotal:    number;       // Σ q.value for the open set, in whole dollars
  staleCount:   number;       // count where stage === 'stale'
  clientCount:  number;       // size of `new Set(openQuotes.map(q => q.clientId))`
};

export function QuotesHero(props: QuotesHeroProps) {
  return (
    <div class="qph">
      <div>
        <div class="qph__eyebrow">
          <span class="qph__eyebrow-dot" />
          The pipeline this week
        </div>
        <h1 class="qph__title">
          <em>${fmtMoney(props.openTotal)}</em> of work sitting with clients,<br />
          {props.staleCount} {props.staleCount === 1 ? 'quote' : 'quotes'} that need a nudge.
        </h1>
        <p class="qph__sub">
          {props.openCount} open quotes across {props.clientCount} clients. The monsters flagged{' '}
          <strong>{props.staleCount}</strong> as cooling off — start there, then hit the hot ones while they're still warm.
        </p>
      </div>
      <a href="/quotes/new" class="qph__cta">
        <I.Plus size={14} sw={2.5} /> New quote
      </a>
    </div>
  );
}
```

The CTA is `<button>` in the prototype but should be `<a href>` in production — opens the new-quote flow.

## Props

```ts
type QuotesHeroProps = {
  openCount:   number;
  openTotal:   number;
  staleCount:  number;
  clientCount: number;
};
```

## Data source

All four fields derive from `GET /quotes`:

- `openCount` = `quotes.filter(q => ['draft','sent','opened','cooling','stale'].includes(q.stage)).length`
- `openTotal` = same set, `Σ q.value` (whole dollars; the prototype uses `q.value` as a JS number, production should use cents internally and divide for display)
- `staleCount` = `quotes.filter(q => q.stage === 'stale').length`
- `clientCount` = `new Set(openQuotes.map(q => q.clientId)).size`

Compute server-side at SSR. The headline numbers re-render on each navigation; no live polling.

## Island vs server

**Server.** No interactivity beyond the CTA link.

## Accessibility

- Single `<h1>` per page — fine.
- The `<em>` inside the headline is purely visual; SRs read with default emphasis. Keep the `<em>` over `<span>`.
- `.qph__eyebrow-dot` is decorative (no animation here, unlike `<ClientsHero>`'s pulsing version) — `aria-hidden` is implicit since it's a static decoration.
- The `<br/>` in the title is a visual line break only. SRs read across it as a continuous sentence ("$32,400 of work sitting with clients, 2 quotes that need a nudge.") — that's the right phrasing.
- The CTA's `box-shadow` lift on hover is decorative; ensure `:focus-visible { outline: 2px solid var(--brand-pink); outline-offset: 3px; }`.

## Edge cases

- **`openCount === 0`:** the headline reads "$0 of work sitting with clients, 0 quotes that need a nudge." which is technically correct but useless. Render an empty-state hero instead — different copy ("No quotes in flight yet — let's send your first one.") and a single full-width pink CTA.
- **`staleCount === 0` (everything is fresh):** the headline still works ("...0 quotes that need a nudge.") but the subtitle's "start there" copy is a lie. Swap to a positive subtitle: "{openCount} open quotes across {clientCount} clients. Nothing's gone cold — just keep sending."
- **`openCount === 1`:** "1 open quote" / "1 client" — pluralisation matters and the prototype handles `quote/quotes` for stale but not for open. Production should: `${openCount} open ${openCount === 1 ? 'quote' : 'quotes'} across ${clientCount} ${clientCount === 1 ? 'client' : 'clients'}`.
- **Very large `openTotal` (e.g. $128,000):** the headline uses `text-wrap: balance` and `clamp(28px, 4vw, 44px)`. At 44 px, "$128,000 of work sitting with clients," fits comfortably even at 1024 px. No special handling needed.
- **No stale + no open (brand-new contractor):** see the `openCount === 0` empty-state above — that shape covers this.
- **Mobile (<1200 px):** `.qph` flips to `flex-direction: column` so the CTA drops below the headline. Below 768 px, the CTA should also become full-width — production should add this; the prototype doesn't.
