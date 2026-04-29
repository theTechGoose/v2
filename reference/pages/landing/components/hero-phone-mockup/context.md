# Hero phone mockup (`.hs-phone__*` + ambient elements)

## What
The cinematic hero scene: a tilted smartphone showing a chat thread, with two ambient blobs drifting behind it, a floating quote document poking out from behind the phone, and two trust-signal badges floating in the corners. Everything bobs/drifts gently to give the page life.

## Anatomy

| Element | Role |
|---|---|
| `.hero-visual` | Right-column flex shell (aria-hidden=true). |
| `.hero-stage` | Relative-positioning frame for the scene. |
| `.hs-blob` `.hs-blob--mint` / `--pink` | Two soft radial gradient blobs that drift via `blobDrift` (one offset -4s reverse). |
| `.hs-phone` | The notched phone (270 × 520, 42px radius, dark green chassis). Continuously plays `phoneFloat`. |
| `.hs-phone__notch` | iOS-style notch decoration. |
| `.hs-phone__screen` | Chat area hosting the hero conversation. |
| `.hs-chat__hdr` / `.hs-chat__avatar` / `.hs-chat__name` | Header inside the chat. |
| `.hs-chat__body` / `.hs-bubble` (`--me` / `--them` / `--rich`) | Chat bubbles. The "rich" variant carries `.hs-rich__row` line items with totals. |
| `.hs-doc` | Floating quote card peeking out from behind the phone. Plays `docFloat`. |
| `.hs-doc__head` / `__tag` / `__num` / `__title` / `__client` / `__rows` (`__row`, `__row--total`) / `__sign` (`__sign-line`, `__sign-label`) | The doc's contents. |
| `.hs-badge` (`--top`, `--bottom`) | Two floating notification badges. Each plays `badgeFloat` with offset delays. |
| `.hs-badge__icon.green` / `.hs-badge__icon.pink` / `.hs-badge__avatar` / `.hs-badge__body` | Badge contents. |
| `.spark` (`.s1`, `.s2`, `.s3`) | Three sparkle markers playing `twinkle` with staggered delays. |

## Behavior
All animations are `@keyframes`-driven and run continuously. There's no JS for this scene.

## Source
`pages/landing/raw.html` lines 489–860 (CSS), 2017–2103 (markup).

## Animations
See `animations.md` and `shared/design-tokens/motion.md`.
