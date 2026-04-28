# `ClientsToolbar` — Search + filter chips + sort

> ✅ **Build in v1.** Filter and sort happen client-side over the cards already in memory; the server returns the full list at SSR.

## Purpose

A single white pill-shaped toolbar that sits between the LoopBar and the cards grid. Three regions:

1. **Search input** (left, flex-1): a sunken pill containing a search icon + input. Placeholder reads "Search by name, address, phone, or last job…". Matches case-insensitively against `name`, `contact` (email), `last` (last-job summary), and `phone`.
2. **Filter chips** (middle, auto): one chip per filter (`All`, `Active jobs`, `Leads`, `Owe you`, `Regulars`, `Quiet`) each with a count pill. Single-select; clicking re-renders the cards grid by status.
3. **Sort button** (right, auto): currently a static "Warmth ▾" button. The prototype defines it but doesn't wire a sort menu — sort is hard-coded as descending `temp`. Production should ship a tiny menu (Warmth / Recent / Owed / Alphabetical).

## Source

- **JSX:** `Paperwork Monsters Clients.html` lines **3996–4022** (component) and **3918–3925** (the `FILTERS` data array)
- **CSS:** Clients.html lines **2198–2242** (`.ctoolbar2*`)
- The chevron used in the sort button is rendered inline via the `<I>` icon component with a custom path: `<I d={<><path d="m6 9 6 6 6-6"/></>} size={12} sw={2.5}/>`

## Static seed (verbatim)

```js
const FILTERS = [
  { id:'all',     label:'All',         count: CLIENTS.length },
  { id:'active',  label:'Active jobs', count: CLIENTS.filter(c=>c.status==='active').length },
  { id:'lead',    label:'Leads',       count: CLIENTS.filter(c=>c.status==='lead').length },
  { id:'owes',    label:'Owe you',     count: CLIENTS.filter(c=>c.status==='owes').length },
  { id:'regular', label:'Regulars',    count: CLIENTS.filter(c=>c.status==='regular').length },
  { id:'cold',    label:'Quiet',       count: CLIENTS.filter(c=>c.status==='cold').length },
];
```

## JSX (verbatim)

```jsx
const ClientsToolbar = ({ filter, setFilter, query, setQuery }) => (
  <div className="ctoolbar2">
    <div className="ctoolbar2__search">
      <I d={ICN.search} size={14}/>
      <input
        placeholder="Search by name, address, phone, or last job…"
        value={query}
        onChange={(e)=>setQuery(e.target.value)}
      />
    </div>
    <div className="ctoolbar2__filters">
      {FILTERS.map(f => (
        <button
          key={f.id}
          className={`ctoolbar2__filter ${filter===f.id ? 'ctoolbar2__filter--active' : ''}`}
          onClick={()=>setFilter(f.id)}
        >
          {f.label}
          <span className="ctoolbar2__filter-count">{f.count}</span>
        </button>
      ))}
    </div>
    <button className="ctoolbar2__sort">
      Warmth <I d={<><path d="m6 9 6 6 6-6"/></>} size={12} sw={2.5}/>
    </button>
  </div>
);
```

The filter logic in `ClientsPage` (Clients.html:4327–4337):

```js
const rows = CLIENTS.filter(c => {
  if (filter !== 'all' && c.status !== filter) return false;
  if (query.trim()) {
    const q = query.toLowerCase();
    return c.name.toLowerCase().includes(q) ||
           c.contact.toLowerCase().includes(q) ||
           c.last.toLowerCase().includes(q) ||
           c.phone.includes(q);
  }
  return true;
});
```

## CSS (key rules)

```css
.ctoolbar2 {
  display: grid; grid-template-columns: 1fr auto auto;
  gap: 8px; align-items: center;
  background: #fff; border: 1px solid var(--border);
  border-radius: var(--radius-lg); padding: 8px;
  margin-bottom: 14px;
}
.ctoolbar2__search {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 12px;
  background: var(--bg-sunken); border-radius: var(--radius-md);
  color: var(--fg-muted);
}
.ctoolbar2__search input {
  flex: 1; border: none; background: transparent; outline: none;
  font-family: var(--font-body); font-size: 14px; color: var(--brand-teal);
}
.ctoolbar2__search input::placeholder { color: var(--fg-subtle); }

.ctoolbar2__filters {
  display: flex; gap: 4px; padding: 2px;
  background: var(--bg-sunken); border-radius: var(--radius-md);
}
.ctoolbar2__filter {
  border: none; background: transparent;
  padding: 7px 12px; border-radius: 8px;
  font-family: var(--font-heading); font-weight: 700; font-size: 12px;
  color: var(--fg-muted); cursor: pointer;
  transition: all var(--dur-fast) var(--ease-out);
  white-space: nowrap;
  display: inline-flex; align-items: center; gap: 6px;
}
.ctoolbar2__filter--active {
  background: #fff; color: var(--brand-teal); box-shadow: var(--shadow-sm);
}
.ctoolbar2__filter-count {
  font-size: 10px; padding: 1px 6px; border-radius: 999px;
  background: var(--mint-200); color: var(--brand-teal);
}
.ctoolbar2__filter--active .ctoolbar2__filter-count {
  background: var(--green-50); color: var(--green-700);
}
.ctoolbar2__sort {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 12px; border-radius: var(--radius-md);
  background: var(--bg-sunken);
  font-family: var(--font-heading); font-weight: 700; font-size: 12px;
  color: var(--brand-teal);
  border: none; cursor: pointer;
}
```

## Preact / Fresh translation

```tsx
// v2/frontend/islands/clients/ClientsToolbar.tsx — ISLAND (handles input + button clicks)
import { Signal } from "@preact/signals";
import * as I from "../../components/ui/icons.tsx";

export type FilterId = 'all' | 'active' | 'lead' | 'owes' | 'regular' | 'cold';
export type SortId   = 'warmth' | 'recent' | 'owed' | 'alpha';

export type FilterChip = { id: FilterId; label: string; count: number; };

export type ClientsToolbarProps = {
  filters: FilterChip[];      // pre-counted server-side; passed in
  filter:  Signal<FilterId>;
  query:   Signal<string>;
  sort:    Signal<SortId>;    // for v1, ship as a single hard-coded "warmth" — open menu later
};

export function ClientsToolbar(props: ClientsToolbarProps) {
  return (
    <div class="ctoolbar2">
      <div class="ctoolbar2__search">
        <I.Search size={14} />
        <input
          type="search"
          placeholder="Search by name, address, phone, or last job…"
          value={props.query.value}
          onInput={(e) => { props.query.value = (e.target as HTMLInputElement).value; }}
          aria-label="Search clients"
        />
      </div>
      <div class="ctoolbar2__filters" role="tablist" aria-label="Filter clients by status">
        {props.filters.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={props.filter.value === f.id}
            class={`ctoolbar2__filter ${props.filter.value === f.id ? 'ctoolbar2__filter--active' : ''}`}
            onClick={() => { props.filter.value = f.id; }}
          >
            {f.label}
            <span class="ctoolbar2__filter-count">{f.count}</span>
          </button>
        ))}
      </div>
      <button type="button" class="ctoolbar2__sort">
        Warmth <I.Chev size={12} sw={2.5} />
      </button>
    </div>
  );
}
```

The toolbar reads + writes shared signals; `<ClientsCards />` reads the same signals to derive its filtered+sorted rows. This keeps the fetch on the server and the filtering on the client without prop-drilling.

**URL params over signals:** preferred for production. `filter`, `q`, and `sort` should each round-trip through `?filter=owes&q=hilltop&sort=warmth` so the URL is shareable and back/forward works. `Signal` becomes a thin wrapper over `URLSearchParams`.

## Props

```ts
type FilterId = 'all' | 'active' | 'lead' | 'owes' | 'regular' | 'cold';
type SortId   = 'warmth' | 'recent' | 'owed' | 'alpha';

type FilterChip = {
  id:    FilterId;
  label: string;
  count: number;   // pre-counted on the server; updates when the dataset changes
};

type ClientsToolbarProps = {
  filters: FilterChip[];
  filter:  Signal<FilterId>;
  query:   Signal<string>;
  sort:    Signal<SortId>;
};
```

## Data source

**v1:** the toolbar is purely client-side filtering over the server-rendered list. Counts come from `Σ clients.filter(status === id).length` at SSR.

**Future:** when the dataset grows past ~200 clients, switch to server-side filtering: `GET /clients?filter=&q=&sort=&cursor=`. Pass `cursor` for pagination (the cards grid then becomes infinite-scroll). Counts stay cheap because the same endpoint can return them in a header (`X-Counts: all=240,active=14,lead=22,...`) or as part of the response envelope.

## Island vs server

**Island.** The whole toolbar holds interactive state. The toolbar island shares signals with the cards island; both rehydrate on mount.

If preferred, this can also be a **single composite island** that wraps the toolbar + the cards grid — that avoids two separate hydration roots and keeps the signals private to one component tree. For v1, the simpler split (toolbar = island, cards grid = island, shared signals) is fine.

## Accessibility

- The search `<input>` should have `type="search"` and an `aria-label` (the placeholder isn't enough — it disappears on focus).
- The filter chip group uses `role="tablist"` + `role="tab"` + `aria-selected`. This communicates the single-select group semantics to SRs.
- The sort button's chevron is decorative — `<I>` component already renders an `<svg aria-hidden>`; ensure that stays.
- Counts inside chips are small (10 px); ensure 4.5:1 contrast on `.ctoolbar2__filter-count` (it's `var(--brand-teal)` on `var(--mint-200)` — passes at 4.6:1).
- The active chip uses background change only (no border or icon) to communicate selection — fine because `aria-selected` carries the semantics, but ensure focus-visible adds a clear outline.
- Esc inside the search field should clear the query (`onKeyDown`: if `key === 'Escape'`, set `query.value = ''`). Not in the prototype; production should add it.

## Edge cases

- **No matches:** when `filter` + `query` produce zero rows, the cards grid shows an empty state with a "Clear filters" button. Logic lives in `<ClientsCards />`, not the toolbar.
- **Single filter with zero count:** the chip still renders ("Owe you · 0") and is still clickable. Tapping it lands on the empty state. Don't hide chips at zero — it's confusing if the row reflows.
- **Long search query:** the input is `flex: 1` inside `.ctoolbar2__search`; it grows with the toolbar's left column. No truncation needed.
- **Many filter chips on narrow viewports:** below ~768 px the chips overflow horizontally. Production should add `overflow-x: auto` on `.ctoolbar2__filters` and a fade-mask on the right edge — not in the prototype.
- **Sort menu (deferred):** the prototype's `<button class="ctoolbar2__sort">` is non-functional. When wiring v2, render a tiny popover with four sort options (Warmth, Recent contact, Most owed, Alphabetical) and a check-mark on the active one. Persist the choice in URL.
