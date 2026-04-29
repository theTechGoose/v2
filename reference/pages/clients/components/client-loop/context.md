# Client loop (`.loopbar__*` + `.cloop__*`)

Two sibling elements both surface the "today's loop" of friendly check-ins the assistant drafted in the user's voice. They share styling cues (pulsing pink dot, drafted-message rationale) but live in different parts of the page.

## 1) `.loopbar` — hero strip
Renders directly under the page header. Dark-teal gradient with a soft green radial accent. Three columns: title block (kicker + headline) · stacked avatars + "~90 seconds to send all three" meta · single white CTA pill.

The pulse marker is `.loopbar__lbl-dot`, animated with `pulse` (2.4s pink ripple).

Hover on `.loopbar__cta` lifts -1px.

## 2) `.cloop` — right-rail detail card
Inside the `.cside2` rail (when not preempted by `.csegment2`). White card with a head row (pulsing dot + title + pink count chip), a sub line, and rows of drafts.

Each `.cloop__row` is a 2-column grid: 36px avatar tile · column with name, "why now" rationale, the drafted message in italic with a pink left bar, and three pill buttons (Send/Edit/Skip).

`.cloop__title-dot` also uses the `pulse` keyframe.

## Source
`pages/clients/raw.html`:
- LoopBar — CSS lines 2127–2189; markup 3979–3993.
- ClientLoop — CSS lines 2935–3000; markup 4274–4299.

## Animations
See `animations.md`. Both use `pulse` for their indicator dots.

## Notes
- The CSS for both is concatenated in this folder's `styles.css` for convenience.
- A `.loopbar` element is also used on the Contracts page in essentially the same form — see `pages/contracts/components/loop-bar/`.
