# Animations — kpi card

No keyframes. Transition only:

```css
.kpi { transition: transform 200ms cubic-bezier(0.34,1.56,0.64,1), box-shadow 200ms; }
.kpi:hover { transform: translateY(-2px); box-shadow: 0 12px 24px rgba(100,69,54,0.10); }
```

The bounce easing is identical to `--ease-bounce`.
