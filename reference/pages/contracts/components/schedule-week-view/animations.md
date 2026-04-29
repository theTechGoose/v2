# Animations — schedule-week-view

No keyframes. Hover transition only:

```css
.csched__bar { transition: transform 240ms var(--ease-out), filter 240ms; }
.csched__bar:hover { transform: scaleY(1.1); filter: brightness(1.1); }
```
