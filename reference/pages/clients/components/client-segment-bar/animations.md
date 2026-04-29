# Animations — client-segment-bar

No keyframes. The fill bar uses a CSS transition so width changes ease-bounce over 1s:

```css
.cseg2-row__fill {
  transition: width 1s var(--ease-bounce);
}
```
