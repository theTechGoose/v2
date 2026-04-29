# Animations — hero-rotor

No `@keyframes`. The word swap is two CSS transitions:

```css
.word     { opacity: 0; transform: translateY(8px); filter: blur(2px); transition: all 360ms var(--ease-bounce); }
.word.in  { opacity: 1; transform: translateY(0);  filter: blur(0); }
.word.out { opacity: 0; transform: translateY(-100%); filter: blur(2px); }
```

The actual transition durations and easing function vary slightly in the export — see `styles.css`.

The rotor advances on a JS `setInterval` (~3.4s), so this is a JS-driven, CSS-styled animation rather than a `@keyframes`-driven one.
