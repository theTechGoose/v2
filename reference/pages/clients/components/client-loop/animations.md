# Animations — client-loop

## `pulse` — `.loopbar__lbl-dot`, `.cloop__title-dot`
- 2.4s infinite pink box-shadow ripple. Same keyframe used by `.ph2__crumb-dot` and other pink status markers across pages.

```css
.loopbar__lbl-dot,
.cloop__title-dot { animation: pulse 2.4s infinite; }
```

## Transitions
- `.loopbar__cta` — `transform var(--dur-fast) var(--ease-out)`; hover translates -1px.
- `.cloop__btn` — `all var(--dur-fast) var(--ease-out)`; hover transitions background.

See `shared/design-tokens/motion.md` for the `pulse` keyframe definition.
