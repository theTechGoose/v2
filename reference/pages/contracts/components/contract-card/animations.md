# Animations — contract-card

## Keyframes
- `ccard-in` — 0.6s `var(--ease-bounce) both`. Card entry.
- `pulse-dot` — 2.4s opacity loop. Used by `.kcard__status-dot`.

Both are catalogued in `shared/design-tokens/motion.md`.

## Transitions
The flip itself is a CSS transition on opacity / transform between `.kcard__back` (hidden) and `.kcard--flipped .kcard__back` (visible) — no `@keyframes`. See `styles.css` for the full transition list (hover lift, close-button hover, milestone done-state).
