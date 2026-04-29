# Animations — marquee-ticker

## `marquee`
The track translates from 0 to -50% over a long duration (set on `.marquee-track` in `extracted/styles.css`). Because the inner content is rendered twice, hitting -50% is visually identical to 0, giving a seamless loop.

```css
.marquee-track { animation: marquee 35s linear infinite; }
@keyframes marquee {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}
```
