# `DecidedRow` — Won / lost compact row

> ✅ **Build in v1.** Trivial UI; lives inside Track 03 ("Decided this month"). One row per won/lost quote.

## Purpose

A compact row that summarises a closed quote. Two-column layout on desktop (`.qdone`), one-column on narrow viewports. Each row is a 4-column grid:

| Column | Content |
|---|---|
| Badge | Green check (won) or coffee X (lost), 32×32 px gradient tile |
| Title block | Quote title (e.g. "Building C re-roof") + client/ID line ("Maple Grove Apartments · Q-1099") |
| Amount | Dollar value — strike-through + muted for lost, brand-teal solid for won |
| When | Relative time decided ("yesterday", "5d ago") |

The hover treatment (`border-color → mint-400, transform: translateX(2px)`) gives the row a subtle "I'm clickable" affordance — production should make the entire row a link to `/quotes/:id`.

## Source

- **JSX:** `Paperwork Monsters Quotes.html` lines **5232–5244**
- **CSS:** Quotes.html lines **2236–2282** (`.qdone*`)

## JSX (verbatim)

```jsx
const DecidedRow = ({ q }) => (
  <div className="qdone__row">
    <div className={`qdone__badge qdone__badge--${q.stage}`}>
      <I d={q.stage === 'won' ? ICN.check : ICN.x} size={16} sw={2.5}/>
    </div>
    <div>
      <div className="qdone__title">{q.title}</div>
      <div className="qdone__client">{q.client} · {q.id}</div>
    </div>
    <div className={`qdone__amt ${q.stage === 'lost' ? 'qdone__amt--lost' : ''}`}>${fmtMoney(q.value)}</div>
    <div className="qdone__when">{q.decidedDays === 1 ? 'yesterday' : `${q.decidedDays}d ago`}</div>
  </div>
);
```

## CSS (key rules)

```css
.qdone {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 10px;
}
@media (max-width: 1100px) { .qdone { grid-template-columns: 1fr; } }

.qdone__row {
  display: grid; grid-template-columns: auto 1fr auto auto;
  gap: 14px; align-items: center;
  padding: 14px 18px;
  background: #fff;
  border-radius: var(--radius-lg);
  border: 1px solid rgba(26,83,92,0.07);
  transition: border-color var(--dur-fast) var(--ease-out),
              transform var(--dur-fast) var(--ease-out);
}
.qdone__row:hover {
  border-color: var(--mint-400);
  transform: translateX(2px);
}

.qdone__badge {
  width: 32px; height: 32px;
  border-radius: 10px;
  display: grid; place-items: center;
  color: #fff;
  flex-shrink: 0;
}
.qdone__badge--won  { background: linear-gradient(135deg, #5FA34F, #3F7A33); }
.qdone__badge--lost { background: linear-gradient(135deg, #B89D90, #785544); }

.qdone__title {
  font-family: var(--font-heading);
  font-weight: 700; font-size: 13.5px;
  color: var(--brand-teal);
  line-height: 1.2;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.qdone__client {
  font-size: 11px; color: var(--fg-muted);
  margin-top: 2px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.qdone__amt {
  font-family: var(--font-heading);
  font-weight: 800; font-size: 14px;
  color: var(--brand-teal);
  letter-spacing: -0.01em;
}
.qdone__amt--lost {
  color: var(--fg-muted);
  text-decoration: line-through;
  text-decoration-thickness: 1px;
  opacity: 0.7;
}
.qdone__when {
  font-size: 11px; color: var(--fg-muted);
  font-family: var(--font-body);
  text-align: right;
}
```

## Preact / Fresh translation

```tsx
// v2/frontend/components/quotes/DecidedRow.tsx — server component
import * as I from "../ui/icons.tsx";
import { fmtMoney } from "../../lib/format.ts";

export type DecidedQuote = {
  id:           string;
  title:        string;
  client:       string;
  stage:        'won' | 'lost';
  value:        number;
  decidedDays:  number;       // days since decided
};

export function DecidedRow({ q }: { q: DecidedQuote }) {
  const when =
    q.decidedDays === 0  ? 'today' :
    q.decidedDays === 1  ? 'yesterday' :
    q.decidedDays <= 7   ? `${q.decidedDays}d ago` :
    q.decidedDays <= 28  ? `${Math.round(q.decidedDays / 7)}w ago` :
                           `${Math.round(q.decidedDays / 30)}mo ago`;

  const labelText = `${q.stage === 'won' ? 'Won' : 'Lost'}: ${q.title} for ${q.client}, $${fmtMoney(q.value)}, ${when}`;

  return (
    <a href={`/quotes/${q.id}`} class="qdone__row" aria-label={labelText}>
      <div class={`qdone__badge qdone__badge--${q.stage}`} aria-hidden="true">
        {q.stage === 'won' ? <I.Check size={16} sw={2.5} /> : <I.X size={16} sw={2.5} />}
      </div>
      <div>
        <div class="qdone__title">{q.title}</div>
        <div class="qdone__client">{q.client} · {q.id}</div>
      </div>
      <div class={`qdone__amt ${q.stage === 'lost' ? 'qdone__amt--lost' : ''}`}>
        ${fmtMoney(q.value)}
      </div>
      <div class="qdone__when">{when}</div>
    </a>
  );
}
```

The prototype renders each row as a `<div>`; production uses `<a href>` so the whole row is navigable. Reset link defaults inside `.qdone__row` (`text-decoration: none; color: inherit;`).

## Props

```ts
type DecidedQuote = {
  id:           string;
  title:        string;
  client:       string;
  stage:        'won' | 'lost';
  value:        number;
  decidedDays:  number;
};
```

## Data source

`GET /quotes?stage=won,lost&since=this-month` (or part of the same `/quotes` payload that drives the cards). Each row needs:

- `decidedDays` — `today − max(decidedAt, contractSignedAt)` rounded to whole days. The relative-time formatter in the JSX above improves on the prototype's `${decidedDays}d ago` (which is awkward at >7 days).
- `client` — same client display name used everywhere else.

Sort by `decidedDays` ascending (most recent first). The prototype renders won/lost in the order they appear in `QPIPELINE`; production should explicitly sort.

## Island vs server

**Server.** No state; just navigation links.

## Accessibility

- The whole row is a link. Use a single `<a>` with `aria-label` that combines stage + title + client + amount + when, so SRs read the row as one announcement.
- Badge is decorative (`aria-hidden="true"`); the stage word is in the `aria-label`.
- The `lost` strike-through on the amount is purely visual. SRs read "$1,900" — that's correct (the row is about a quote that was lost; the amount is informational, not currently-owed). Don't add complicated ARIA to communicate "this number isn't real anymore"; the surrounding context handles it.
- Hover transform (`translateX(2px)`) honours `prefers-reduced-motion: reduce`.

## Edge cases

- **`decidedDays === 0`:** "today" — the prototype's `${decidedDays}d ago` would render "0d ago" which reads weirdly. The Preact translation handles this.
- **`decidedDays > 30`:** "1mo ago" / "2mo ago". This row really only belongs in Track 03 ("Decided this month"), so anything > 30 days shouldn't show. If it does (because the contractor has < 30 quotes and the track gets backfilled), render the longer relative.
- **Very long title:** `text-overflow: ellipsis` truncates at one line. Hover shows full title via `<a title>` attribute (production should add).
- **Lost quote with `value === 0`:** shows "$0" with strike-through. Looks weird; consider hiding the amount column for $0 lost quotes — the badge already communicates "lost".
- **Many decided rows in a month (e.g. 40):** the 2-column grid (`.qdone`) handles arbitrary count. Track 03 starts collapsed by default so contractors don't see this until they expand it.
- **Mobile (<1100 px):** single column. The 4-cell row stays as-is — `auto 1fr auto auto` is fine at narrow widths because the title block has `min-width: 0` and ellipsis-truncates.
