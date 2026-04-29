# Animations — sidebar

No `@keyframes` defined or referenced. The only animated behavior is a CSS `transition` on width:

```css
.sb { transition: width 280ms cubic-bezier(0.34, 1.56, 0.64, 1); }
.sb__textus { transition: transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1), filter 200ms; }
.nav-item { transition: all 180ms; }
```

The bounce easing on `.sb` width is the same curve as `--ease-bounce` (defined in `colors_and_type.css`), so collapsing/expanding the rail overshoots slightly before settling.

See `shared/design-tokens/motion.md` for the master keyframes catalog.
