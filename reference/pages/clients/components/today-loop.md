# `TodayLoop` — Drafts queue panel

> ⚠️ **Defined in the prototype but NOT mounted by `<ClientsPage>`.** The live page uses the slimmer `<LoopBar>` ribbon at the top instead. Document this for the future iteration that may bring it back; do not build for v1 unless the design re-introduces it. **Depends on agents module** for real draft generation.

## Purpose

A taller, richer "Today's loop" panel meant to live in the right rail or as a full-width module. Where `<LoopBar>` is a glanceable teaser, `<TodayLoop>` is the actual queue UI: each draft renders as a row with the client avatar, why-this-matters caption ("Opened the garage epoxy quote twice in an hour. They're shopping."), the proposed message body in italic, and three buttons — `Send it`, `Edit`, `Skip`.

The panel exists in the prototype's JSX but `<ClientsPage>` (Clients.html:4338–4351) does not include it in its render tree. Treat as **defined-but-unused** v1 — keep the spec for future placement (likely as a full-width section above the cards, or as a detail panel inside `/assistant`).

## Source

- **JSX:** `Paperwork Monsters Clients.html` lines **4254–4301**
- **CSS:** Clients.html lines **2935–3000** (`.cloop*`)
- The pulsing `.cloop__title-dot` reuses the page-level `pulse` keyframe defined in `clients-hero.md`.

## Static seed (verbatim)

```js
const items = [
  {
    initials:'TK', color:'linear-gradient(135deg, var(--coffee-300), var(--coffee-500))',
    name:'Tom & Linda Kowalski',
    why:'Opened the garage epoxy quote twice in an hour. They\'re shopping.',
    draft:'"Hey Tom — saw you and Linda peeked at the quote. Happy to walk through colors or knock $150 off if we book this week. — D"'
  },
  {
    initials:'HD', color:'linear-gradient(135deg, var(--coffee-400), #4F362A)',
    name:'Hilltop Diner',
    why:'Invoice #INV-204 is 11 days past due. Last reminder Apr 14.',
    draft:'"Hey — totally get it\'s a busy month. Want me to split $1,160 into two payments? Easy fix. — D"'
  },
  {
    initials:'RY', color:'linear-gradient(135deg, var(--pink-300), var(--brand-pink))',
    name:'Riverside Yoga',
    why:'Used to book monthly. Quiet 6 weeks. Spring patio season starts next week.',
    draft:'"Morning! Patio season is back — want me to swing by this week and re-seal the studio floor before you open windows? — D"'
  },
];
```

## JSX (verbatim)

```jsx
const TodayLoop = () => {
  const items = [/* see seed above */];
  return (
    <div className="cloop">
      <div className="cloop__head">
        <div className="cloop__title">
          <span className="cloop__title-dot"/> Today's loop
        </div>
        <span className="cloop__count">3 to send</span>
      </div>
      <div className="cloop__sub">Drafts the monsters wrote in your voice. Tap to send, edit, or skip.</div>
      {items.map((it, i) => (
        <div className="cloop__row" key={i}>
          <div className="cloop__avatar" style={{background: it.color}}>{it.initials}</div>
          <div style={{minWidth:0}}>
            <div className="cloop__name">{it.name}</div>
            <div className="cloop__why">{it.why}</div>
            <div className="cloop__draft">{it.draft}</div>
            <div className="cloop__btns">
              <button className="cloop__btn cloop__btn--send"><I d={ICN.send} size={11}/> Send it</button>
              <button className="cloop__btn cloop__btn--edit">Edit</button>
              <button className="cloop__btn cloop__btn--edit">Skip</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
```

## CSS (key rules)

```css
.cloop {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  padding: 18px;
  position: relative; overflow: hidden;
}
.cloop__head {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 6px;
}
.cloop__title {
  font-family: var(--font-heading); font-weight: 800; font-size: 14px; color: var(--brand-teal);
  display: flex; align-items: center; gap: 8px;
}
.cloop__title-dot {
  width: 8px; height: 8px; border-radius: 999px;
  background: var(--brand-pink);
  box-shadow: 0 0 0 3px rgba(255,107,107,0.18);
  animation: pulse 2.4s infinite;
}
.cloop__count {
  font-family: var(--font-heading); font-weight: 800; font-size: 11px;
  background: var(--pink-50); color: var(--pink-700);
  padding: 3px 8px; border-radius: 999px;
}
.cloop__sub { font-size: 12px; color: var(--fg-muted); margin-bottom: 14px; }

.cloop__row {
  display: grid; grid-template-columns: 36px 1fr; gap: 12px; align-items: flex-start;
  padding: 10px 0;
  border-top: 1px dashed rgba(100,69,54,0.15);
}
.cloop__row:first-of-type { border-top: none; padding-top: 4px; }
.cloop__avatar {
  width: 36px; height: 36px; border-radius: 11px;
  display: grid; place-items: center; color: #fff;
  font-family: var(--font-heading); font-weight: 800; font-size: 12px;
  flex-shrink: 0;
}
.cloop__name  { font-family: var(--font-heading); font-weight: 800; font-size: 13px;
                color: var(--brand-teal); margin-bottom: 2px; }
.cloop__why   { font-size: 11px; color: var(--fg-muted); line-height: 1.4; }
.cloop__draft {
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--bg-sunken);
  font-size: 11.5px; color: var(--fg);
  line-height: 1.4;
  font-style: italic;
  border-left: 2px solid var(--brand-pink);
}
.cloop__btns { display: flex; gap: 6px; margin-top: 8px; }
.cloop__btn {
  border: none; padding: 6px 11px; border-radius: 999px;
  font-family: var(--font-heading); font-weight: 700; font-size: 11px;
  display: inline-flex; align-items: center; gap: 4px;
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease-out);
}
.cloop__btn--send { background: var(--brand-green); color: #fff; }
.cloop__btn--send:hover { background: var(--green-600); }
.cloop__btn--edit { background: var(--bg-sunken); color: var(--fg-muted); }
.cloop__btn--edit:hover { background: var(--mint-300); color: var(--brand-teal); }
```

## Preact / Fresh translation

```tsx
// v2/frontend/islands/clients/TodayLoop.tsx — ISLAND (Send / Edit / Skip post mutations)
import * as I from "../../components/ui/icons.tsx";

export type LoopItem = {
  draftId:  string;
  clientId: string;
  initials: string;
  gradient: string;       // CSS gradient — derived from moodFor() of the linked client
  name:     string;
  why:      string;
  draft:    string;       // body, including quote marks if the design wants them
};

export function TodayLoop(props: { items: LoopItem[] }) {
  if (props.items.length === 0) return null;

  return (
    <section class="cloop" aria-labelledby="cloop-title">
      <div class="cloop__head">
        <div class="cloop__title" id="cloop-title">
          <span class="cloop__title-dot" /> Today's loop
        </div>
        <span class="cloop__count">{props.items.length} to send</span>
      </div>
      <div class="cloop__sub">
        Drafts the monsters wrote in your voice. Tap to send, edit, or skip.
      </div>
      {props.items.map((it) => (
        <div class="cloop__row" key={it.draftId}>
          <div class="cloop__avatar" style={{ background: it.gradient }} aria-hidden="true">
            {it.initials}
          </div>
          <div style={{ minWidth: 0 }}>
            <div class="cloop__name">{it.name}</div>
            <div class="cloop__why">{it.why}</div>
            <blockquote class="cloop__draft">{it.draft}</blockquote>
            <div class="cloop__btns">
              <button type="button" class="cloop__btn cloop__btn--send"
                      onClick={() => sendDraft(it.draftId)}>
                <I.Send size={11} /> Send it
              </button>
              <button type="button" class="cloop__btn cloop__btn--edit"
                      onClick={() => editDraft(it.draftId)}>
                Edit
              </button>
              <button type="button" class="cloop__btn cloop__btn--edit"
                      onClick={() => skipDraft(it.draftId)}>
                Skip
              </button>
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}

async function sendDraft(id: string) { /* POST /agents/loop/:id/send */ }
async function editDraft(id: string) { /* nav to /assistant?draft=:id */ }
async function skipDraft(id: string) { /* POST /agents/loop/:id/skip — soft delete */ }
```

## Props

```ts
type LoopItem = {
  draftId:  string;
  clientId: string;
  initials: string;
  gradient: string;
  name:     string;
  why:      string;
  draft:    string;
};

type TodayLoopProps = {
  items: LoopItem[];
};
```

## Data source

`GET /agents/loop?date=today` — same endpoint that drives `<LoopBar>`, but the full payload (with `why` and `draft` body strings).

Each item's actions:

| Action | Endpoint | Effect |
|---|---|---|
| Send it | `POST /agents/loop/:draftId/send` | Sends the message via the assistant; row collapses out |
| Edit | (client-side nav) → `/assistant?draft=:draftId` | Opens the assistant with the draft pre-loaded in the composer |
| Skip | `POST /agents/loop/:draftId/skip` | Soft-deletes the draft (won't reappear); row collapses out |

After all rows are cleared (sent or skipped), the panel returns `null` for the rest of the day. Don't show "All clear!" empty state — the absence of the panel *is* the empty state.

## Island vs server

**Island.** Each button mutates server state. The whole panel hydrates as a single island; rows aren't independent.

## Accessibility

- The panel uses `<section aria-labelledby>` so SRs can navigate to it.
- The `<blockquote>` semantic on the draft body is intentional — it's a quoted suggested message. The italics + pink left-border are the visual treatment.
- Avatars are decorative initials (`aria-hidden="true"`); the client name in `.cloop__name` carries the identity.
- Buttons should announce their effect — "Send the draft to Tom & Linda Kowalski" rather than just "Send it." Use `aria-label` to expand:
  ```tsx
  <button aria-label={`Send the draft to ${it.name}`}>…</button>
  ```
- The pulsing `.cloop__title-dot` honours `prefers-reduced-motion: reduce`.
- Send / Skip are destructive-ish (Send is irreversible, Skip is soft-reversible). Consider a small toast confirmation: "Sent to Tom" with an Undo for Send (5-second window) — not in the prototype, recommended for production.

## Edge cases

- **Empty items:** return `null`. No "all clear" placeholder.
- **Edit clicked on a draft that's already sent (race):** the API responds 409; the row collapses out and a toast says "Already sent — opening the conversation." Then nav to `/assistant?conversation=...`.
- **Optimistic UI:** clicking Send removes the row immediately and queues the POST. If the POST fails, restore the row and surface a banner ("Couldn't send — try again or edit"). Don't block the UI on the network call.
- **Long draft body:** the `.cloop__draft` block has no max-height in the prototype — it grows. For very long drafts (> 200 chars), clamp to 4 lines with a "Read more" toggle, or trust the agents module to keep drafts terse (preferred — drafts are *meant* to be one-message texts).
- **Reduced motion:** drop the row-removal animation; just remove the row. The dot pulse should also be disabled.
