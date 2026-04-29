# Animations — document-tabs

No `@keyframes`. The tab swap is implemented in inline JS (selecting `.doc-tab.on`, rebuilding the mockup, applying brief opacity transitions).

The counter "ticker" uses requestAnimationFrame to count from 0 up to the final value when the section enters the viewport.
