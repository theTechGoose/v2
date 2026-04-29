# Animations — hero banner

Three keyframes; full definitions in `shared/design-tokens/motion.md`.

## `hbob` — `.hero__monster`
- 5.5s ease-in-out infinite — rotation + translate Y combo so the mascot bobs and tilts at once.

## `hotPulse` — `.hot-card__pulse` (inside the optional hot-lead overlay)
- 1.6s ease-in-out infinite — pink box-shadow ripple.

## `ppulse` — `.hero__pill-dot` (inside the optional pill above the title)
- 2s infinite — green box-shadow ripple, larger spread than `tickerPulse`.

```css
.hero__monster   { animation: hbob 5.5s ease-in-out infinite; }
.hot-card__pulse { animation: hotPulse 1.6s ease-in-out infinite; }
.hero__pill-dot  { animation: ppulse 2s infinite; }
```

CSS transitions on hover-rich children:

```css
.hot-card     { transition: transform 220ms var(--ease-bounce), box-shadow 220ms ease; }
.hot-card__cta { transition: all 180ms var(--ease-bounce); }
.btn          { transition: transform 180ms cubic-bezier(0.34, 1.56, 0.64, 1), filter 180ms; }
```
