# Animations — problem-cards

None. Just a CSS transition on hover:

```css
.problem-card { transition: transform 200ms, box-shadow 200ms; }
.problem-card:hover { transform: translateY(-4px); box-shadow: var(--shadow-lg); }
```
