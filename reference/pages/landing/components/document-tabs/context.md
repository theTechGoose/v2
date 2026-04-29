# Document tabs (`.docs` / `.doc-tabs` / `.doc-mockup` / `.doc-info` / `.doc-counter`)

## What
A tabbed interface that cycles through three sample documents (Quote, Contract, Invoice). Each tab swap rewrites the mockup card on the left and the explainer column on the right. Below sits a "documents sent so far" counter that ticks up with `<Ticker>`-style animation.

## Anatomy

| Element | Role |
|---|---|
| `.doc-tabs` (role=`tablist`) | Three `.doc-tab` buttons. The active tab gets `.on` (filled pink). |
| `.doc-tab .step` | Numeric eyebrow inside each tab. |
| `.doc-stage` | Two-column grid: mockup on the left, explainer on the right. |
| `.doc-mockup` | The paper-style card that is re-rendered per tab. |
| `.doc-mockup-header` | Title + `#PM-…` number + date. |
| `#doc-lines` / `#doc-totals` | Containers re-filled by JS on tab change. |
| `.doc-info` | Right column with `<h3>`, `<p>`, `<ul>` — also rewritten per tab. |
| `.doc-counter` | Big "Documents sent so far" stat with an animating number on scroll-into-view. |
| `.doc-counter .types` | Inline list of doc types underneath the count. |

## Behavior
Inline JS swaps tab `.on`, rewrites the mockup using a per-doc data record, and animates the counter when the section enters the viewport.

## Source
`pages/landing/raw.html` lines 964–1115 (CSS), 2143–2190 (markup).

## Animations
- Tab swap is JS-driven; no `@keyframes`.
- Mockup transition is a fade/slide done in the inline animation logic.
- Counter ticker uses requestAnimationFrame.
