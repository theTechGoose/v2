# `Track` — Collapsible group section

> ✅ **Build in v1.** Pure UI primitive — wraps each lifecycle stage group on the page.

## Purpose

A collapsible section header used to group quotes by pipeline track. Three `<Track>`s on the page:

1. **`01 Out for response`** — `sent + opened + cooling + stale` quotes (default open)
2. **`02 Drafting`** — `draft` quotes (default collapsed)
3. **`03 Decided this month`** — `won + lost` quotes (default collapsed)

The header is one row: chevron + 2-digit track number (pink) + title + count. Clicking anywhere on the header toggles the body. The body uses a `grid-template-rows: 1fr ↔ 0fr` transition so the height animates smoothly without measuring children.

## Source

- **JSX:** `Paperwork Monsters Quotes.html` lines **5213–5230**
- **CSS:** Quotes.html lines **1836–1885** (`.qtrack*`)

## JSX (verbatim)

```jsx
const Track = ({ num, title, count, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`qtrack ${open ? '' : 'qtrack--collapsed'}`}>
      <header className="qtrack__head" onClick={() => setOpen(!open)}>
        <span className="qtrack__chev"><I d={ICN.chev} size={14} sw={2.5}/></span>
        <span className="qtrack__num">{num}</span>
        <span className="qtrack__title">{title}</span>
        <span className="qtrack__count">{count} {count === 1 ? 'quote' : 'quotes'}</span>
      </header>
      <div className="qtrack__body">
        <div className="qtrack__body-inner">
          {children}
        </div>
      </div>
    </section>
  );
};
```

## CSS (key rules)

```css
.qtrack { margin-bottom: 28px; }
.qtrack__head {
  display: flex; align-items: baseline; gap: 12px;
  margin-bottom: 14px;
  cursor: pointer;
  user-select: none;
  padding: 6px 0;
  border-bottom: 1px solid rgba(26,83,92,0.08);
  transition: border-color var(--dur-fast) var(--ease-out);
}
.qtrack__head:hover { border-color: rgba(26,83,92,0.2); }

.qtrack__chev {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px;
  color: var(--brand-teal);
  transition: transform 240ms var(--ease-bounce);
  transform: rotate(90deg);              /* open state — chevron points down */
}
.qtrack--collapsed .qtrack__chev { transform: rotate(0deg); }   /* closed — points right */

.qtrack__num {
  font-family: var(--font-heading);
  font-size: 11px; font-weight: 800;
  letter-spacing: 0.1em;
  color: var(--brand-pink);
}
.qtrack__title {
  font-family: var(--font-heading);
  font-weight: 800; font-size: 20px;
  color: var(--brand-teal);
  letter-spacing: -0.01em;
  line-height: 1;
}
.qtrack__count {
  font-family: var(--font-body);
  font-size: 13px; color: var(--fg-muted);
  margin-left: auto;
}

.qtrack__body {
  display: grid;
  grid-template-rows: 1fr;
  transition: grid-template-rows 320ms var(--ease-out),
              margin-top 320ms var(--ease-out);
  margin-top: 14px;
}
.qtrack__body-inner {
  overflow: hidden;
  min-height: 0;
}
.qtrack--collapsed .qtrack__body { grid-template-rows: 0fr; margin-top: 0; }
```

The `grid-template-rows: 1fr ↔ 0fr` trick is what makes the height transition work without JS measurement. Don't replace it with a `max-height` hack — that breaks when children are dynamic.

## Preact / Fresh translation

```tsx
// v2/frontend/islands/quotes/Track.tsx — ISLAND (toggle state)
import { useState, useEffect } from "preact/hooks";
import * as I from "../../components/ui/icons.tsx";

export type TrackProps = {
  num:          string;        // "01", "02", "03" — 2-digit zero-padded
  title:        string;
  count:        number;
  defaultOpen?: boolean;
  storageKey?:  string;        // e.g. "quotes:track:out-for-response" — persists open/close per user
  children:     preact.ComponentChildren;
};

export function Track(props: TrackProps) {
  const [open, setOpen] = useState(props.defaultOpen ?? true);

  // Persist preference if storageKey is provided
  useEffect(() => {
    if (!props.storageKey) return;
    const stored = localStorage.getItem(props.storageKey);
    if (stored !== null) setOpen(stored === '1');
  }, []);

  useEffect(() => {
    if (!props.storageKey) return;
    localStorage.setItem(props.storageKey, open ? '1' : '0');
  }, [open]);

  const headingId = `qtrack-${props.num}-h`;
  const bodyId    = `qtrack-${props.num}-b`;

  return (
    <section class={`qtrack ${open ? '' : 'qtrack--collapsed'}`}>
      <button
        type="button"
        class="qtrack__head"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={bodyId}
        id={headingId}
      >
        <span class="qtrack__chev" aria-hidden="true"><I.Chev size={14} sw={2.5} /></span>
        <span class="qtrack__num">{props.num}</span>
        <span class="qtrack__title">{props.title}</span>
        <span class="qtrack__count">
          {props.count} {props.count === 1 ? 'quote' : 'quotes'}
        </span>
      </button>
      <div class="qtrack__body" id={bodyId} role="region" aria-labelledby={headingId}>
        <div class="qtrack__body-inner" aria-hidden={!open}>
          {props.children}
        </div>
      </div>
    </section>
  );
}
```

The prototype uses a `<header>` with a click handler. Production must use a `<button>` so keyboard users can expand/collapse with Enter/Space and SRs announce the role + state. Style overrides reset the button defaults (`background: transparent; border: 0; padding: 6px 0; width: 100%; text-align: left; cursor: pointer; font: inherit; color: inherit;` should land on `.qtrack__head`).

## Props

```ts
type TrackProps = {
  num:          string;
  title:        string;
  count:        number;
  defaultOpen?: boolean;
  storageKey?:  string;
  children:     ComponentChildren;
};
```

## Data source

`count` is computed by the parent (`<QuotesPage>`) from the same `QPIPELINE` array passed to the cards. The `<Track>` doesn't fetch anything itself.

## Island vs server

**Island.** Toggle is local state; nothing else.

The body's content (the cards or rows) renders at SSR inside `<Track>` — when collapsed, the content is hidden via CSS (`grid-template-rows: 0fr` on `.qtrack__body` clips overflow on `.qtrack__body-inner`). Cards inside still hydrate as their own islands when needed (the `<QuoteCard>` flip state is per-card).

## Accessibility

- The header must be a `<button>` with `aria-expanded` + `aria-controls` pointing at the body region.
- The body region is `role="region"` with `aria-labelledby` pointing at the header — SRs treat each track as a navigable landmark.
- The chevron rotates on toggle; it's purely decorative (`aria-hidden="true"`). The expanded/collapsed state is communicated via `aria-expanded`.
- When collapsed, the body is `display: grid; grid-template-rows: 0fr` which hides content visually and via overflow — but the children still receive focus via Tab. Add `aria-hidden={!open}` on `.qtrack__body-inner` AND make sure focusable children inside don't get tab-focus when collapsed (use `inert` if available, else `tabindex="-1"` on focusable descendants).
- Honour `prefers-reduced-motion: reduce` — disable the chevron rotation transition and the grid-rows transition; toggling becomes instant.
- The title (20 px, 800 weight, brand teal) on white background is high-contrast. The track number (11 px, brand pink) is borderline on white at small sizes — verify 4.5:1.

## Edge cases

- **`count === 0`:** the prototype renders the track even when empty — header shows "Drafting · 0 quotes" with an empty body. Acceptable for v1 (gives the contractor an empty container they can mentally file new quotes into) but consider hiding the track or rendering an empty-state message inside (e.g. "No drafts. **Start one →**") for stronger UX.
- **`count === 1`:** "1 quote" — pluralisation handled in the JSX.
- **Three tracks all collapsed:** the page shows only headers — that's fine, contractor has hidden everything intentionally. Don't auto-open anything.
- **Storage key changes between sessions:** `localStorage` is per-origin; the keys don't conflict across pages because they're prefixed (`quotes:track:*`).
- **Long track title (e.g. localised):** the title has no `text-overflow` rule. At narrow viewports (< 600 px), the count chip can overflow to a new line — the `flex` layout handles this naturally.
- **Deep nesting:** tracks aren't designed to nest. If a future page wants nested tracks, document the indent rules separately; don't try to make this primitive recursive.
- **Reduced motion + collapsed-by-default:** on first paint the chevron is at `rotate(0deg)` (closed); make sure the JSX renders with the right class so there's no flash of "open then collapse" when the JS hydrates. (`defaultOpen={false}` should produce `class="qtrack qtrack--collapsed"` at SSR.)
