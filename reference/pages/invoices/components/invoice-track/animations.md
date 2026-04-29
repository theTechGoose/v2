# Animations — invoice-track

No keyframes. Two transitions:

```css
.qtrack__chev { transition: transform 240ms var(--ease-bounce); transform: rotate(90deg); }
.qtrack--collapsed .qtrack__chev { transform: rotate(0deg); }

.qtrack__body { transition: grid-template-rows 320ms var(--ease-out), margin-top 320ms var(--ease-out); }
.qtrack--collapsed .qtrack__body { grid-template-rows: 0fr; margin-top: 0; }
```
