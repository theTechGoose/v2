# Animations — ticker

Two keyframes, both fully cataloged in `shared/design-tokens/motion.md`.

## `tickerPulse` — used by `.topbar__ticker-dot`
- 1.6s ease-in-out infinite, green ripple via box-shadow.

## `tickerSlideIn` — used by `.topbar__ticker-item`
- 360ms `var(--ease-bounce)` both. Plays on mount of each new item.

```css
.topbar__ticker-dot { animation: tickerPulse 1.6s ease-in-out infinite; }
.topbar__ticker-item { animation: tickerSlideIn 360ms var(--ease-bounce) both; }
```

In addition, a CSS transition gives the pill a hover lift:

```css
.topbar__ticker { transition: all 180ms; }
.topbar__ticker:hover { transform: translateY(-1px); }
```
