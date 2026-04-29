# Client card v2 (`.ccard2__*`)

## What
The editorial-style client card. Each card is its own roster entry: a wide gradient "mood" band (theme-driven by the client's status), an oversized avatar that straddles the mood/body boundary, an offset oversized "days since contact" numeral, the contractor's voice in the body, and a footer with a nudge CTA + balance.

## Theming via CSS variables
Each card sets `--mood-from`, `--mood-to`, `--mood-shadow`, and `--mood-status` inline. These drive:
- The mood band gradient (`linear-gradient(135deg, var(--mood-from) 0%, var(--mood-to) 100%)`).
- The avatar gradient (same vars).
- The hover shadow tint (`--mood-shadow`).
- The status pill text color (`--mood-status`).

Mood lookup happens via `moodFor(c)` in the source — outputs `from`, `to`, `shadow`, `statusFg`, and `label`.

## Anatomy

| Element | Role |
|---|---|
| `.ccard2__mood` | Full-bleed gradient band (138px tall) housing texture + status pill + crown + days-since. |
| `.ccard2__mood-tex` | Subtle paper-grain pseudo (`::before` radial gradients). |
| `.ccard2__since` | Big "07 / DAYS AGO" set offset bottom-right. Tier modifier scales white-text alpha: `--warm` (16%), `--steady` (22%), `--cool` (32%), `--cold` (45%). |
| `.ccard2__status` + `.ccard2__status-dot` | Glassy pill in the top-left; dot pulses opacity (2.4s `pulse-dot`). |
| `.ccard2__crown` | Optional VIP indicator (gold gradient tile, top-right). |
| `.ccard2__av` | 86px avatar straddling the mood→body boundary (z-index 4). |
| `.ccard2__body` | Padded copy block below mood: name, segment seg, story line (4-line clamp). |
| `.ccard2__foot` | Footer with `.ccard2__nudge` (pink, arrow shifts on hover) + `.ccard2__bal-wrap` (right-aligned balance). |
| `.ccard2__panel` | Detail overlay; slides up over the card when `.ccard2--open` is added. Contains panel head (avatar, name, x button), 3 contact rows, and 2 actions. |

## States
- Default: `box-shadow` lift on hover (translateY -4px + shadow tinted by `--mood-shadow`).
- Open: `.ccard2--open` makes the panel visible, disables the hover transform, and changes cursor to default.
- Panel open transition: 380ms `var(--ease-bounce)` for transform, 240ms `var(--ease-out)` for opacity.

## Animations
- Card mount: `ccard2-editorial-in` (declared in `<style>` but never wired to `animation:` in the export; entrance is via `animation-delay: idx*35ms` on a non-existent declaration. Treat as ready-to-wire.)
- Status dot: `pulse-dot` (2.4s opacity loop).
- Hover micro-interactions: gap on `.ccard2__nudge` + arrow translateX.

## Balance modifiers
- `.ccard2__bal-val--owe` — pink (debt).
- `.ccard2__bal-val--cred` — green (credit).
- `.ccard2__bal-val--zero` — teal ("Settled").

## Source
`pages/clients/raw.html` lines 1746–2079 (CSS), 4097–4189 (markup).

## Related
The page-header pulse dot (`.ph2__crumb-dot`) uses the `pulse` keyframe — see `motion.md`.
