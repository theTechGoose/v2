# `Topbar` — Dashboard header

## Purpose

Single-row header above the dashboard content. Left to right: hamburger toggle (mobile + sidebar collapse), greeting block (date + "Hey, Diego 👋"), `⌘K` search input, notification bell with red dot. **The prototype defines an `ActivityTicker` component (see `activity-ticker.md`) but does not currently render it inside the Topbar — production should wire it in between greeting and search.**

## Source

- JSX: `Paperwork Monsters Dashboard.html` lines **2374–2396** (Topbar) and **2351–2372** (ActivityTicker — to wire in)
- Inline CSS: Dashboard.html — search for `.topbar` rules in lines 264–1745

## JSX (verbatim — Topbar as currently rendered)

```jsx
const Topbar = ({ collapsed, onToggle }) => (
  <header className="topbar">
    <button className="topbar__menu" onClick={onToggle}
            aria-label="Toggle sidebar"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6h18M3 12h18M3 18h18"/>
      </svg>
    </button>

    <div className="topbar__greet">
      <div className="topbar__greet-line">Tuesday · April 28</div>
      <div className="topbar__greet-name">Hey, Diego 👋</div>
    </div>

    <div className="topbar__search">
      <I d={ICN.search} size={16}/>
      <input placeholder="Search jobs, clients, invoices..."/>
      <span className="topbar__kbd">⌘K</span>
    </div>

    <button className="topbar__btn">
      <I d={ICN.bell} size={18}/>
      <span className="topbar__btn-dot"/>
    </button>
  </header>
);
```

## Recommended addition (wire in ActivityTicker)

```jsx
// Before the search input, add:
<ActivityTicker />
```

`ActivityTicker` cycles through 4 events on a 3.8s interval — see `activity-ticker.md` for the source.

## CSS (key rules — verbatim from inline `<style>`)

```css
.topbar {
  display: grid;
  grid-template-columns: auto auto 1fr auto auto;     /* menu | greet | (ticker) | search | bell */
  align-items: center; gap: 16px;
  padding: 12px 24px;
  background: #fff;
  border-bottom: 1px solid var(--border);
  height: 64px;
  position: sticky; top: 0; z-index: 10;
}

.topbar__menu {
  width: 32px; height: 32px; border-radius: 8px;
  background: var(--mint-200); border: 0; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  color: var(--brand-teal);
  transition: all 120ms;
}
.topbar__menu:hover { background: var(--mint-300); transform: scale(0.96); }

.topbar__greet            { line-height: 1.15; }
.topbar__greet-line       { font-size: 11px; color: var(--fg-muted);
                            font-weight: 500; }
.topbar__greet-name       { font-family: var(--font-heading); font-weight: 800;
                            font-size: 16px; color: var(--brand-teal); margin-top: 1px; }

.topbar__search {
  max-width: 460px; justify-self: end;
  display: flex; align-items: center; gap: 8px;
  background: var(--mint-200);
  border: 1px solid transparent;
  padding: 8px 14px; border-radius: 12px;
  color: var(--fg-muted);
  transition: all 120ms;
}
.topbar__search:focus-within { background: #fff; border-color: var(--border-strong);
                                box-shadow: 0 0 0 4px rgba(81,152,67,0.15); }
.topbar__search input  { background: transparent; border: 0; outline: 0;
                          font-family: var(--font-body); font-size: 14px;
                          color: var(--brand-teal); width: 100%; }
.topbar__search input::placeholder { color: var(--fg-subtle); }
.topbar__kbd {
  font-family: var(--font-mono); font-size: 11px;
  background: rgba(0,0,0,0.05);
  padding: 3px 7px; border-radius: 6px;
  color: var(--fg-muted);
}

.topbar__btn {
  position: relative;
  width: 38px; height: 38px; border-radius: 10px;
  background: var(--mint-200); border: 0; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  color: var(--brand-teal);
}
.topbar__btn-dot {
  position: absolute; top: 8px; right: 8px;
  width: 8px; height: 8px; border-radius: 999px;
  background: var(--brand-pink); border: 2px solid var(--mint-200);
}
```

## Preact / Fresh translation

```tsx
// v2/frontend/islands/Topbar.tsx — island (search debounce + bell click + sidebar toggle wiring)
import { useState, useEffect } from "preact/hooks";
import * as I from "../components/ui/icons.tsx";
import { ActivityTicker } from "./ActivityTicker.tsx";

export function Topbar(props: {
  greeting: { line: string; name: string };
  unreadCount: number;
  onToggleSidebar: () => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<unknown[]>([]);

  // Debounced search
  useEffect(() => {
    if (!q) { setResults([]); return; }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      const res = await fetch(`/api/proxy/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
      if (res.ok) setResults(await res.json());
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);

  // ⌘K focus
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('[data-topbar-search]')?.focus();
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  return (
    <header class="topbar">
      <button class="topbar__menu" onClick={props.onToggleSidebar} aria-label="Toggle sidebar">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
      </button>

      <div class="topbar__greet">
        <div class="topbar__greet-line">{props.greeting.line}</div>
        <div class="topbar__greet-name">Hey, {props.greeting.name} 👋</div>
      </div>

      <ActivityTicker />

      <div class="topbar__search">
        <I.Search size={16} />
        <input data-topbar-search
               value={q} onInput={e => setQ((e.target as HTMLInputElement).value)}
               placeholder="Search jobs, clients, invoices..." />
        <span class="topbar__kbd">⌘K</span>
        {results.length > 0 && <SearchResults results={results} />}
      </div>

      <button class="topbar__btn" aria-label={`Notifications (${props.unreadCount} unread)`}>
        <I.Bell size={18} />
        {props.unreadCount > 0 && <span class="topbar__btn-dot" />}
      </button>
    </header>
  );
}
```

## Props

```ts
type TopbarProps = {
  greeting:    { line: string; name: string };       // computed server-side
  unreadCount: number;                                // GET /notifications/unread-count
  onToggleSidebar: () => void;
};
```

## Data source

| Field | Source |
|---|---|
| `greeting.line` | Computed server-side: `<Day>, <Month> <DD>` in user's timezone (from profile or `Accept-Language`) |
| `greeting.name` | `GET /profile` → `name.split(' ')[0]` |
| `unreadCount` | `GET /notifications/unread-count` (poll every 30s) |
| Search results | `GET /search?q=…&type=` (**not yet implemented** — `backend.md` §6.C) |

## Island vs server

**Island.** Search input + ⌘K shortcut + bell click + sidebar toggle relay. Greeting itself could be server-rendered but co-locating is fine.

## Accessibility

- `<header>` carries implicit `role="banner"` (only at top of body — Fresh `_app.tsx` should not nest it deeper).
- Search `<input>` needs `<label class="sr-only" for="topbar-search">Search</label>`.
- `aria-label` on the menu button + bell button (already in the prototype).
- `aria-keyshortcuts="Meta+K Control+K"` on the search input.
- Notification dot needs `aria-hidden="true"`; the count is already in the bell's `aria-label`.

## Edge cases

- **No notifications:** `unreadCount === 0` → hide the dot.
- **Mobile (<768px):** the search input should collapse to an icon that opens a full-width search overlay. `topbar__greet` should hide.
- **⌘K conflicts:** in the search input itself, ⌘K should still focus (no-op). On macOS Safari, ⌘K shows the URL — `e.preventDefault()` handles this.
- **Activity ticker overflow:** the topbar grid `1fr` slot for the ticker should shrink before the greeting does. Set `min-width: 0` on the ticker container.
- **Search abort:** cancel in-flight requests on key press to avoid out-of-order results (`AbortController` above).
- **Bell click:** opens a notification dropdown — design TBD; for v1 just navigate to `/dashboard/notifications`.
