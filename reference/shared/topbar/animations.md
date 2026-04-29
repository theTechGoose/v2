# Animations — topbar

No `@keyframes` defined directly on the topbar. Only CSS transitions:

```css
.topbar__menu { transition: background 160ms, color 160ms, transform 160ms; }
.topbar__menu:hover { transform: translateY(-1px); }
```

Keyframes used by the embedded ticker pill (`.topbar__ticker-dot`, `.topbar__ticker-item`) live with `shared/ticker/`. The frosted background is purely a `backdrop-filter: blur(10px)` — no animation.

See `shared/design-tokens/motion.md` for the master keyframes catalog.
