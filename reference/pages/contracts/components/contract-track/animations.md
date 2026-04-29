# Animations — contract-track

No keyframes. Two transitions drive the collapse:

```css
.ktrack__chev { transition: transform 240ms var(--ease-bounce); transform: rotate(90deg); }
.ktrack--collapsed .ktrack__chev { transform: rotate(0deg); }

.ktrack__body { transition: grid-template-rows 320ms var(--ease-out), margin-top 320ms var(--ease-out); }
.ktrack--collapsed .ktrack__body { grid-template-rows: 0fr; margin-top: 0; }
```

The `grid-template-rows: 1fr ↔ 0fr` trick is what allows height-animating without measuring inner content (browsers added support in 2024).
