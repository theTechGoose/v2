# Animations — payment-header

No keyframes. CSS transitions only:

```css
.pph__cta { transition: transform 160ms var(--ease-bounce); }
.pph__cta:hover { transform: translateY(-1px); }

.pph__ghost { transition: background 160ms; }

.pph__stub { /* base rotate/translate set per --N modifier */ }
.pph__stack:hover .pph__stub--1 { transform: rotate(-1.3deg) translate(-6px, -3px); }
.pph__stack:hover .pph__stub--2 { transform: rotate(2.6deg)  translate(8px, -2px); }
.pph__stack:hover .pph__stub--3 { transform: rotate(-4.2deg) translate(-22px, -1px); }
```

The stubs themselves should have an implicit `transition: transform …` to make the hover lift smooth. In the export they pick up the global `* { transition }` defined elsewhere, but if you re-implement, add `transition: transform 220ms var(--ease-bounce)` explicitly.
