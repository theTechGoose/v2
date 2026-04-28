# `LoopBar` — Today's-loop ribbon

> ✅ **Build in v1 (static).** The avatars and copy are seeded mock data. Real per-day "loop" generation lives in the agents module — once that ships, swap the seed for `GET /agents/loop?date=today`.

## Purpose

A slim dark-teal ribbon that sits between the hero and the toolbar. It teases three friendly check-ins the assistant has drafted for the contractor today, gives them an estimated total send time ("~90 seconds to send all three"), and offers a single white pill CTA — "Open the loop" — that funnels into the assistant page.

The ribbon's job is **glanceable persuasion**: contractors should be able to see at a glance whether they have anything to clear today, without having to open the assistant. The avatars are stacked initials (TK / HD / RY in the seed) and the meta line resolves them by first-word ("Tom · Hilltop · Riverside").

## Source

- **JSX:** `Paperwork Monsters Clients.html` lines **3980–3994**
- **CSS:** Clients.html lines **2127–2189** (`.loopbar*`) and the responsive collapse at **2297**
- The pulsing `.loopbar__lbl-dot` reuses the page-level `pulse` keyframe defined in `clients-hero.md`.

## JSX (verbatim)

```jsx
const LoopBar = () => (
  <div className="loopbar">
    <div className="loopbar__title">
      <span className="loopbar__lbl"><span className="loopbar__lbl-dot"/> Today's loop</span>
      <span className="loopbar__h">3 friendly check-ins, drafted for you.</span>
    </div>
    <div className="loopbar__avs">
      <div className="loopbar__av" style={{background:'linear-gradient(135deg, var(--coffee-300), var(--coffee-500))'}}>TK</div>
      <div className="loopbar__av" style={{background:'linear-gradient(135deg, var(--coffee-400), #4F362A)'}}>HD</div>
      <div className="loopbar__av" style={{background:'linear-gradient(135deg, var(--pink-300), var(--brand-pink))'}}>RY</div>
      <div className="loopbar__av-meta">Tom · Hilltop · Riverside<br/><strong>~90 seconds</strong> to send all three</div>
    </div>
    <button className="loopbar__cta"><I d={ICN.send} size={13}/> Open the loop</button>
  </div>
);
```

## CSS (key rules)

```css
.loopbar {
  background: linear-gradient(135deg, #0F3A40 0%, #1A535C 50%, #0A2A2F 100%);
  color: #fff;
  border-radius: var(--radius-xl);
  padding: 16px 20px;
  margin-bottom: 18px;
  position: relative; overflow: hidden;
  display: grid; grid-template-columns: auto 1fr auto; gap: 18px; align-items: center;
}
.loopbar::before {
  content: '';
  position: absolute; top: -30px; right: -30px;
  width: 180px; height: 180px;
  background: radial-gradient(circle, rgba(95,163,79,0.32), transparent 70%);
  border-radius: 999px; pointer-events: none;
}
.loopbar__title { position: relative; z-index: 1;
                  display: flex; flex-direction: column; gap: 2px; }
.loopbar__lbl   { font-family: var(--font-heading);
                  font-size: 11px; font-weight: 700;
                  letter-spacing: 0.08em; text-transform: uppercase;
                  color: rgba(255,255,255,0.7);
                  display: inline-flex; align-items: center; gap: 8px; }
.loopbar__lbl-dot {
  width: 7px; height: 7px; border-radius: 999px; background: var(--brand-pink);
  box-shadow: 0 0 0 3px rgba(255,107,107,0.25);
  animation: pulse 2.4s infinite;
}
.loopbar__h { font-family: var(--font-heading); font-weight: 800; font-size: 18px;
              color: #fff; letter-spacing: -0.01em; }

.loopbar__avs { position: relative; z-index: 1;
                display: flex; align-items: center; }
.loopbar__av {
  width: 40px; height: 40px; border-radius: 12px;
  display: grid; place-items: center; color: #fff;
  font-family: var(--font-heading); font-weight: 800; font-size: 12px;
  border: 2px solid #0A2A2F;
  margin-left: -10px;        /* overlap stack */
}
.loopbar__av:first-child { margin-left: 0; }
.loopbar__av-meta {
  margin-left: 16px;
  font-size: 12.5px; color: rgba(255,255,255,0.85); line-height: 1.4;
}
.loopbar__av-meta strong { color: #fff; font-weight: 700; }

.loopbar__cta {
  position: relative; z-index: 1;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 11px 16px; border-radius: var(--radius-pill);
  background: #fff; color: #0F3A40; border: none;
  font-family: var(--font-heading); font-weight: 800; font-size: 13px;
  cursor: pointer;
  transition: transform var(--dur-fast) var(--ease-out);
}
.loopbar__cta:hover { transform: translateY(-1px); }

@media (max-width: 1100px) {
  .loopbar { grid-template-columns: 1fr; gap: 12px; }
}
```

## Preact / Fresh translation

```tsx
// v2/frontend/components/clients/LoopBar.tsx — server component
import * as I from "../ui/icons.tsx";

export type LoopAvatar = {
  initials: string;       // 2-letter, all caps
  gradient: string;       // ready-to-use CSS gradient string ("linear-gradient(135deg, var(--coffee-300), var(--coffee-500))")
};

export type LoopBarProps = {
  count:    number;        // how many drafts are queued for today (typically 1–5)
  avatars:  LoopAvatar[];  // first 3 client avatars (stacked, 2px dark border, 10px overlap)
  names:    string;        // "Tom · Hilltop · Riverside" — pre-joined; first-word per client
  estimate: string;        // "~90 seconds" — total send time across all drafts
  href:     string;        // where the CTA goes — typically `/assistant?loop=today`
};

export function LoopBar(props: LoopBarProps) {
  // graceful "all clear" state: render nothing rather than a "0 to send" ribbon
  if (props.count === 0) return null;

  return (
    <div class="loopbar">
      <div class="loopbar__title">
        <span class="loopbar__lbl">
          <span class="loopbar__lbl-dot" /> Today's loop
        </span>
        <span class="loopbar__h">
          {props.count} friendly check-{props.count === 1 ? 'in' : 'ins'}, drafted for you.
        </span>
      </div>
      <div class="loopbar__avs">
        {props.avatars.slice(0, 3).map((a, i) => (
          <div key={i} class="loopbar__av" style={{ background: a.gradient }}>
            {a.initials}
          </div>
        ))}
        <div class="loopbar__av-meta">
          {props.names}<br />
          <strong>{props.estimate}</strong> to send all {props.count === 1 ? 'one' : props.count === 2 ? 'two' : 'three'}.
        </div>
      </div>
      <a href={props.href} class="loopbar__cta">
        <I.Send size={13} /> Open the loop
      </a>
    </div>
  );
}
```

## Props

```ts
type LoopAvatar = { initials: string; gradient: string; };

type LoopBarProps = {
  count:    number;
  avatars:  LoopAvatar[];   // limit 3; the rest are hidden behind the meta count
  names:    string;
  estimate: string;
  href:     string;
};
```

## Data source

**v1:** static seed mirroring the prototype (`avatars` for TK, HD, RY; copy unchanged).

**Post-agents-module:** `GET /agents/loop?date=today` returns up to N drafts where each draft has `clientId`, `reason`, `body`, `expectedSendSeconds`. The page derives:

- `count` = drafts.length
- `avatars` = first 3 draft `clientId` → `{ initials, gradient }` from the matching client in `GET /clients`
  - `gradient` is generated server-side from each client's `moodFor()` result (see `client-card.md`) so the ribbon avatars colour-match the cards
- `names` = `drafts.slice(0,3).map(d => firstWord(client.name)).join(' · ')`
  - `firstWord` is the first space-delimited token EXCEPT for HOA / property-mgmt names where it's the brand word (e.g. "Hilltop Diner" → "Hilltop", "Greenleaf HOA" → "Greenleaf"). For homeowners ("Tom & Linda Kowalski") it's the given name ("Tom").
- `estimate` = `humanizeSeconds(Σ d.expectedSendSeconds)` → "~90 seconds" / "about 2 minutes"
- `href` = `/assistant?loop=today` — opens the assistant pre-scrolled to the loop drafts queue

The ribbon should `return null` when `count === 0`. Don't render an empty "0 to send" version; the visual weight isn't earned by zero items.

## Island vs server

**Server.** No interactivity; the CTA is a plain `<a>` link.

## Accessibility

- The CTA is styled as a `<button>` in the prototype but **must be `<a href>`** in production — opens a route, not a JS action.
- The pulsing `.loopbar__lbl-dot` keyframe is decorative; honour `prefers-reduced-motion: reduce` and disable the animation.
- Avatars are decorative initials. Add `aria-hidden="true"` on each `.loopbar__av` and let `.loopbar__av-meta` carry the names line for SRs.
- The dark teal gradient + white text is well above 4.5:1 contrast, but the muted `rgba(255,255,255,0.7)` in `.loopbar__lbl` should be tested at 11 px — it's borderline. If it fails, bump to `0.78`.
- Focus on the white CTA: ensure `:focus-visible { outline: 2px solid var(--brand-pink); outline-offset: 3px; }` so it's visible against white-on-dark.

## Edge cases

- **`count === 0`:** render nothing. The page is calmer without an empty ribbon.
- **`count === 1`:** "1 friendly check-in, drafted for you." / "to send the one." Pluralisation is handled in the JSX.
- **`count > 3`:** the seed only ever shows 3 avatars; render the first 3 and let the meta line absorb the rest naturally ("Tom, Hilltop, Riverside + 2 more"). Consider an additional `+N` chip after the third avatar for >3 cases — not in the prototype.
- **No avatars yet (new agents-module install):** show two character-emoji placeholders ("🐲", "🐙") instead of initials — keeps the "monsters" voice intact while data populates.
- **Mobile (<1100 px):** the bar stacks: title → avatars → CTA. The `loopbar__av-meta` line wraps naturally; the CTA goes full-width below.
- **Reduced-motion:** drop the radial-gradient `::before` glow and the dot pulse; keep the gradient background and lift transform on the CTA.
