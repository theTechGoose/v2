# Contract card (`.kcard__*`)

## What
A bigger sibling of `client-card-2`: the editorial card for a signed contract. Front face shows the mood-band header, an avatar that bleeds across the boundary, a body with progress bar, and a footer with CTA + total. Click flips the card to a back face listing milestones and quick actions.

## Theming via CSS variables
- `--mood-from`, `--mood-to` — gradient on the mood band and avatar.
- `--mood-shadow` — tinted hover shadow.
- `--mood-status` — status pill text color.

These are passed inline per card based on `c.mood` / `c.shadow` / `c.statusColor` from `CONTRACTS`.

## Anatomy

| Element | Role |
|---|---|
| `.kcard__mood` | Gradient band: status pill (top-left), schedule range (top-right), oversized numeral (offset bottom-right). |
| `.kcard__status-dot` | Pink ripple animator (`pulse-dot`). |
| `.kcard__numeral` | Big editorial sequence number — like `.ccard2__since-num` but stays the same color. |
| `.kcard__av` | 86px avatar, straddles mood/body boundary. |
| `.kcard__body` | client+id eyebrow → big title → story → progress block. |
| `.kcard__prog-fill` | Pink-gradient fill set to `width: <pct>%`. |
| `.kcard__foot` | "View milestones →" CTA + right-aligned total. |
| `.kcard__back` | Absolute-positioned back face. Visible only when `.kcard--flipped` is on the parent. |
| `.kcard__back-body` | Vertical stack of `.kcard__mile` rows. Modifiers: `--done` (check + strikethrough), `--current` (pink active dot). |
| `.kcard__back-foot` | 3 quick-action buttons: Invoice, Text client, View contract. |

## States & flow
- Default front. Click outer card → `setFlipped(true)`.
- `.kcard--flipped .kcard__back` is visible.
- The close X on `.kcard__back-close` flips back. Inner buttons all `e.stopPropagation()` so they don't re-trigger the flip.

## Animations
- Status dot uses `pulse-dot` (2.4s).
- Card mount uses `ccard-in` (0.6s ease-bounce both) — see `motion.md`.
- Hover lifts via box-shadow tinted by `--mood-shadow`.

## Source
`pages/contracts/raw.html` lines 1606–1925 (CSS), 5182–5266 (markup).
