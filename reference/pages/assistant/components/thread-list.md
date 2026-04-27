# `Threads` — Conversation list (left rail)

> ✅ **Build in v1.** Static seed for now; switches to `GET /agents/conversations` when the agents module ships.

## Purpose

280 px-wide left column listing the contractor's chat conversations with the AI assistant, grouped by recency (Today / Yesterday / This week). Each thread row shows: client name, last-update time, a one-line preview of the most recent activity, and a status chip (Sent / Drafted / Nudged / Signed / Paid). Includes a "+ New conversation" button (⌘N).

## Source

- JSX: `Paperwork Monsters Assistant.html` lines **4558–4589**
- Static seed: `Assistant.html:4213–4227` (`const THREADS`)
- Inline CSS: search for `.threads`, `.thread`, `.thread--active`, `.thread__head/client/time/preview/chips`, `.thread__chip--{sent,draft,needs,paid}`

## Static seed (verbatim)

```js
const THREADS = [
  { group: 'Today', items: [
    { id: 't1', client: 'Tom & Linda K.',
      preview: 'Garage epoxy floor — 2-car, includes prep, primer, and topcoat. Awaiting signature.',
      time: '8m', chip: 'sent',  chipLabel: 'Sent',    active: true },
    { id: 't2', client: 'Marcus Lin',
      preview: '"Need a quote for kitchen backsplash, ~30 sqft, white subway tile."',
      time: '1h', chip: 'draft', chipLabel: 'Drafted' },
    { id: 't3', client: 'Hilltop Diner',
      preview: 'Followed up on overdue invoice #INV-204 ($1,160) — payment promised by Friday.',
      time: '3h', chip: 'needs', chipLabel: 'Nudged' },
  ]},
  { group: 'Yesterday', items: [
    { id: 't4', client: 'Sarah Chen',
      preview: 'Bathroom remodel contract drafted and e-signed. Crew scheduled Wed.',
      time: 'Mon', chip: 'paid', chipLabel: 'Signed' },
    { id: 't5', client: 'Greenleaf HOA',
      preview: 'Common area paint quote — 4,200 sqft, two coats, eggshell.',
      time: 'Mon', chip: 'sent', chipLabel: 'Sent' },
  ]},
  { group: 'This week', items: [
    { id: 't6', client: 'Cobblestone Cafe',
      preview: 'Patio re-tile invoice #INV-198 sent. $1,000 deposit received.',
      time: 'Sun', chip: 'paid', chipLabel: 'Paid' },
    { id: 't7', client: 'Bayside Properties',
      preview: '4-unit gutter cleaning quote sent. Cold — 4 days no view.',
      time: 'Sat', chip: 'sent', chipLabel: 'Sent' },
  ]},
];
```

## JSX (verbatim)

```jsx
const Threads = () => (
  <aside className="threads">
    <div className="threads__head">
      <h3 className="threads__title">Conversations</h3>
      <span className="threads__count">12</span>
    </div>
    <button className="threads__new">
      <I d={ICN.plus} size={14} sw={2.5}/>
      New conversation
      <span className="threads__new-kbd">⌘N</span>
    </button>
    <div className="threads__list">
      {THREADS.map(group => (
        <div key={group.group}>
          <div className="threads__group-label">{group.group}</div>
          {group.items.map(t => (
            <button key={t.id} className={`thread ${t.active ? 'thread--active' : ''}`}>
              <div className="thread__head">
                <span className="thread__client">{t.client}</span>
                <span className="thread__time">{t.time}</span>
              </div>
              <div className="thread__preview">{t.preview}</div>
              <div className="thread__chips">
                <span className={`thread__chip thread__chip--${t.chip}`}>{t.chipLabel}</span>
              </div>
            </button>
          ))}
        </div>
      ))}
    </div>
  </aside>
);
```

## CSS (key rules)

```css
.threads {
  width: 280px;
  background: #fff;
  border-right: 1px solid var(--border);
  display: flex; flex-direction: column;
  height: 100%;
}
.threads__head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px 6px;
}
.threads__title { font-family: var(--font-heading); font-weight: 800;
                  font-size: 14px; color: var(--brand-teal);
                  margin: 0; letter-spacing: -0.01em; }
.threads__count { font-size: 11px; font-weight: 800;
                  background: var(--mint-200); color: var(--brand-teal);
                  padding: 2px 7px; border-radius: 999px;
                  font-family: var(--font-heading); }

.threads__new {
  margin: 4px 12px 8px;
  display: flex; align-items: center; gap: 8px;
  background: var(--brand-pink); color: #fff;
  border: 0; border-radius: 12px;
  padding: 9px 14px;
  font-family: var(--font-heading); font-weight: 800;
  font-size: 12px; cursor: pointer;
  box-shadow: 0 6px 14px rgba(255,107,107,0.32);
  transition: transform 200ms var(--ease-bounce);
}
.threads__new:hover { transform: translateY(-1px); }
.threads__new-kbd {
  margin-left: auto;
  font-family: var(--font-mono); font-size: 10px;
  background: rgba(255,255,255,0.22);
  padding: 1px 5px; border-radius: 4px;
}

.threads__list  { flex: 1; overflow-y: auto; padding: 4px 8px 12px; }
.threads__group-label {
  font-family: var(--font-heading); font-weight: 800;
  font-size: 10px; letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--fg-subtle);
  padding: 12px 8px 4px;
}

.thread {
  display: block; width: 100%; text-align: left;
  background: transparent; border: 0; cursor: pointer;
  padding: 10px 10px;
  border-radius: 10px;
  margin-bottom: 2px;
  transition: background 120ms;
}
.thread:hover           { background: var(--mint-200); }
.thread--active         { background: var(--green-50); }
.thread--active::before { content: ''; display: inline-block; width: 0; }

.thread__head    { display: flex; align-items: baseline;
                   justify-content: space-between; gap: 8px;
                   margin-bottom: 3px; }
.thread__client  { font-family: var(--font-heading); font-weight: 800;
                   font-size: 13px; color: var(--brand-teal);
                   white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.thread__time    { font-size: 10px; color: var(--fg-muted);
                   font-family: var(--font-heading); font-weight: 700;
                   flex-shrink: 0; }
.thread__preview { font-size: 12px; color: var(--fg-muted);
                   line-height: 1.45;
                   display: -webkit-box; -webkit-line-clamp: 2;
                   -webkit-box-orient: vertical; overflow: hidden;
                   margin-bottom: 6px; }
.thread__chips   { display: flex; gap: 4px; flex-wrap: wrap; }
.thread__chip    { font-family: var(--font-heading); font-weight: 800;
                   font-size: 9px; padding: 2px 7px;
                   border-radius: 999px; letter-spacing: 0.04em;
                   text-transform: uppercase; }
.thread__chip--sent  { background: var(--green-50);  color: var(--green-600); }
.thread__chip--draft { background: var(--coffee-50); color: var(--coffee-600); }
.thread__chip--needs { background: var(--pink-50);   color: var(--pink-700); }
.thread__chip--paid  { background: var(--teal-50);   color: var(--teal-600); }
```

## Preact / Fresh translation

```tsx
// v2/frontend/components/assistant/Threads.tsx — server component
// (Static seed for v1; the per-row click is route navigation, not React state)

import * as I from "../ui/icons.tsx";

type Chip = 'sent'|'draft'|'needs'|'paid';
type Thread = { id: string; client: string; preview: string; time: string;
                chip: Chip; chipLabel: string; };
type Group = { label: string; items: Thread[]; };

export function Threads(props: { groups: Group[]; activeId: string; total: number }) {
  return (
    <aside class="threads">
      <div class="threads__head">
        <h3 class="threads__title">Conversations</h3>
        <span class="threads__count">{props.total}</span>
      </div>
      <a href="/assistant" class="threads__new">
        <I.Plus size={14} sw={2.5} />
        New conversation
        <span class="threads__new-kbd">⌘N</span>
      </a>
      <div class="threads__list">
        {props.groups.map(g => (
          <div key={g.label}>
            <div class="threads__group-label">{g.label}</div>
            {g.items.map(t => (
              <a key={t.id} href={`/assistant/${t.id}`}
                 class={`thread ${t.id === props.activeId ? 'thread--active' : ''}`}
                 aria-current={t.id === props.activeId ? 'page' : undefined}>
                <div class="thread__head">
                  <span class="thread__client">{t.client}</span>
                  <span class="thread__time">{t.time}</span>
                </div>
                <div class="thread__preview">{t.preview}</div>
                <div class="thread__chips">
                  <span class={`thread__chip thread__chip--${t.chip}`}>{t.chipLabel}</span>
                </div>
              </a>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}
```

Note: the prototype uses `<button>` for thread rows. Production should use `<a href>` so right-click "Open in new tab" works. ⌘N keyboard handler can be a tiny island on the page level.

## Props

```ts
type ThreadsProps = {
  groups:   { label: string; items: Thread[] }[];
  activeId: string;        // from URL: routes/assistant/[threadId].tsx
  total:    number;        // count badge
};

type Thread = {
  id: string;
  client: string;
  preview: string;
  time: string;            // pre-formatted relative ("8m", "1h", "Mon", "Sat")
  chip: 'sent' | 'draft' | 'needs' | 'paid';
  chipLabel: string;       // display label for the chip
};
```

## Data source

**v1:** static seed (mirrored from prototype).

**Post-agents-module:** `GET /agents/conversations[?limit=&cursor=]` (see `backend.md` §4). Each conversation needs:
- `id` — agent module's `Conversation.id` (which can be backed by the existing v2 `Conversation` DTO with a new `customerId` link)
- `client` — derived from the linked customer
- `preview` — last message's content, truncated to ~120 chars
- `time` — `Date.now() - lastMessageAt`, formatted relatively
- `chip` + `chipLabel` — derived from the last `Action` taken in the conversation (sent quote, drafted, nudged, signed, paid)

Group bucketing (Today / Yesterday / This week) is server-side bucketing on `lastMessageAt`.

## Island vs server

**Server.** Routing handles selection; no client state. ⌘N keyboard shortcut is a separate page-level island.

## Accessibility

- `<aside>` carries `role="complementary"` — fine. Add `aria-label="Conversations"`.
- Each `<a>` with `aria-current="page"` for the active thread.
- Group labels (`Today`, `Yesterday`, `This week`) are visual-only; for SR add `<h4 class="sr-only">Today</h4>` before each group, or use `<dl>`/`<dt>`/`<dd>` semantics.
- Chip color conveys status; ensure sufficient contrast and add `aria-label={chipLabel}` for SR clarity.
- ⌘N shortcut: include `<kbd>` in the button label; bind on the page level.

## Edge cases

- **No threads (new user):** show an empty-state inside `.threads__list` with the "+ New conversation" button repeated and an arrow pointing to it. Suggested copy: "No conversations yet. Tap **New** to start your first quote with Bossie."
- **Long previews:** `-webkit-line-clamp: 2` already truncates to 2 lines.
- **Long client names:** `text-overflow: ellipsis` on `.thread__client`.
- **More than ~50 threads:** infinite scroll + cursor pagination — `GET /agents/conversations?cursor=…`.
- **Unread state:** the prototype doesn't show an "unread dot". When chat ships, add a small pink dot on threads where `lastMessage.role === 'assistant' && lastMessage.readAt == null`.
- **Mobile (<768px):** the threads pane should hide and show only when the user taps a "back" or "menu" button on the chat header. See `phone-preview-assistant.md` for the mobile spec.
