# `ActivityTicker` — Rotating live-event chip for topbar

## Purpose

Inline chip with a green pulsing dot, a current event sentence (`"Tom & Linda opened your quote"`), and a trailing relative time (`"2m ago"`). Cycles through events on a 3.8-second interval. Defined in the prototype but **not currently rendered inside the Topbar** — production should wire it in (see `topbar.md`).

## Source

- JSX: `Paperwork Monsters Dashboard.html` lines **2345–2372**

## Static seed (verbatim — `Dashboard.html:2345–2350`)

```jsx
const TICKER_EVENTS = [
  { txt: <><strong>Tom &amp; Linda</strong> opened your quote</>, time: '2m'  },
  { txt: <><strong>Cobblestone Cafe</strong> paid $1,000</>,       time: '18m' },
  { txt: <><strong>Sarah Chen</strong> sent a photo</>,            time: '41m' },
  { txt: <><strong>Marcus Lin</strong> signed the quote</>,        time: '1h'  },
];
```

## JSX (verbatim)

```jsx
const ActivityTicker = () => {
  const [i, setI] = React.useState(0);
  React.useEffect(() => {
    const tick = setInterval(() => {
      setI((n) => (n + 1) % TICKER_EVENTS.length);
    }, 3800);
    return () => clearInterval(tick);
  }, []);
  const ev = TICKER_EVENTS[i];
  return (
    <button className="topbar__ticker" type="button" aria-label="Live activity">
      <span className="topbar__ticker-dot"/>
      <span className="topbar__ticker-track" aria-live="polite">
        <span className="topbar__ticker-item" key={i}>
          {ev.txt}
        </span>
      </span>
      <span className="topbar__ticker-time">{ev.time} ago</span>
    </button>
  );
};
```

The `key={i}` on the inner `<span>` is the trick that lets React re-mount the element on each cycle — this enables a CSS-driven enter animation. The Preact equivalent uses the same pattern.

## CSS (key rules — to match the prototype's intended look)

The exact `.topbar__ticker*` rules aren't in `styles.css`; they're in `Dashboard.html`'s inline `<style>`. Look between lines 264–1745 for `.topbar__ticker`. The recommended Tailwind rendition:

```tsx
<button class="topbar__ticker inline-flex items-center gap-2 px-3 py-1.5 rounded-full
                 bg-mint-200 hover:bg-mint-300 text-teal-500 text-[12px] font-medium
                 transition-colors min-w-0 max-w-[280px] cursor-pointer border-0">
  <span class="topbar__ticker-dot inline-block w-2 h-2 rounded-full bg-green-500
                  shadow-[0_0_0_4px_rgba(81,152,67,0.18)] animate-pulse" />
  <span class="topbar__ticker-track flex-1 min-w-0 overflow-hidden text-left" aria-live="polite">
    <span key={i} class="topbar__ticker-item block truncate animate-tickerIn">
      {ev.txt}
    </span>
  </span>
  <span class="topbar__ticker-time text-[11px] text-teal-500/55 font-heading font-bold whitespace-nowrap">
    {ev.time} ago
  </span>
</button>
```

Add to Tailwind config:

```ts
keyframes: {
  tickerIn: {
    '0%':   { opacity: '0', transform: 'translateY(8px)' },
    '100%': { opacity: '1', transform: 'translateY(0)' },
  },
},
animation: { tickerIn: 'tickerIn 380ms cubic-bezier(0.34, 1.4, 0.64, 1) both' },
```

## Preact / Fresh translation

```tsx
// v2/frontend/islands/ActivityTicker.tsx — island
import { useEffect, useState } from "preact/hooks";

type Event = { txt: preact.ComponentChildren; time: string };

export function ActivityTicker(props: { events?: Event[] }) {
  // Production: events come from GET /notifications?limit=10, refreshed on a poll.
  const events = props.events ?? FALLBACK_EVENTS;
  const [i, setI] = useState(0);

  useEffect(() => {
    if (events.length <= 1) return;
    const t = setInterval(() => setI(n => (n + 1) % events.length), 3800);
    return () => clearInterval(t);
  }, [events.length]);

  if (events.length === 0) return null;
  const ev = events[i];

  return (
    <button type="button" class="topbar__ticker" aria-label="Live activity">
      <span class="topbar__ticker-dot" aria-hidden="true" />
      <span class="topbar__ticker-track" aria-live="polite">
        <span key={i} class="topbar__ticker-item">{ev.txt}</span>
      </span>
      <span class="topbar__ticker-time">{ev.time} ago</span>
    </button>
  );
}

const FALLBACK_EVENTS: Event[] = [
  { txt: <><strong>Tom & Linda</strong> opened your quote</>, time: '2m' },
  /* … same hardcoded list as prototype until /notifications is wired … */
];
```

When real notifications arrive from `GET /notifications?limit=10`, map each to `{ txt, time }`:

```ts
function notifToEvent(n: Notification): Event {
  const minutesAgo = Math.floor((Date.now() - new Date(n.createdAt).getTime()) / 60000);
  const time = minutesAgo < 60   ? `${minutesAgo}m`
             : minutesAgo < 1440 ? `${Math.floor(minutesAgo / 60)}h`
             :                     `${Math.floor(minutesAgo / 1440)}d`;
  return { txt: <span dangerouslySetInnerHTML={{ __html: n.title }} />, time };
}
```

## Props

```ts
type ActivityTickerProps = { events?: { txt: preact.ComponentChildren; time: string }[] };
```

If `events` omitted, falls back to a hardcoded seed (so the chip still cycles in dev).

## Data source

`GET /notifications?limit=10` (see `backend.md` §3.E). The notifications module emits an event per state change (quote sent, invoice paid, etc.) — this chip surfaces the freshest 10 in a rotation.

For real-time updates, refresh every 10 s with `setInterval(refetch, 10000)`. A future SSE endpoint (`backend.md` §3.I) can replace polling.

## Island vs server

**Island.** Timer + `aria-live` re-announcement.

## Accessibility

- `aria-live="polite"` on `.topbar__ticker-track` so SR announces each new event when it appears (without interrupting other speech).
- `aria-label="Live activity"` on the button.
- The dot needs `aria-hidden="true"`.
- Honor `prefers-reduced-motion`: skip the cycle and show a static "X new events" link instead.

## Edge cases

- **No notifications:** return `null` — the chip is decorative, not load-bearing.
- **Single notification:** don't start the timer (already guarded by `events.length <= 1`).
- **Wide notifications overflow:** `truncate` ellipsis on `.topbar__ticker-item`. Consider `title={n.title}` for hover-tooltip.
- **HTML in notification title:** the prototype uses `<strong>Tom & Linda</strong>` literally. Backend notifications send `title: string` plain — wrap entity name in `<strong>` client-side, or have backend send `{ entityName, title }` separately. Decide before launch.
- **Click action:** in the prototype the button does nothing on click. Production: navigate to `/dashboard/notifications` or open a dropdown.
- **`aria-live` re-announcement on every cycle (every 3.8s)** is **annoying** for SR users. Recommend toggling `aria-live` to `'off'` after 30s of cycling, or only setting it when a *genuinely new* event arrives — not on every rotation through the same list.
