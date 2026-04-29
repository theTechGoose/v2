# Contact section (`.contact` / `.contact-card` / `.cf-*`)

## What
Final conversion section. A two-column "contact card" with marketing copy + checklist on the left and a phone-style SMS preview + submit form on the right. The right column simulates a chat window where the user's typed phone number renders as their reply bubble in real time before they tap "Send".

## Anatomy

### Left column (`.contact-info`)
- Eyebrow pill, headline, lede.
- `.checks` — list with check-mark icons next to each benefit.

### Right column (`.contact-form` / `.cf-phone`)
- `.cf-phone__hdr` — avatar + name + animated `cf-phone__live` dot + phone-call icon.
- `.cf-phone__body` — chat bubbles:
  - Two `.cf-bubble--them` bubbles introducing Marisol.
  - One `.cf-bubble--me .cf-bubble--preview` bubble that previews the user's input as they type (`#cf-preview-text` is updated by JS).
  - `.cf-meta` — delivered chips with double-check.
- `.cf-phone__compose` — input row with `+` icon, tel input, and pink send button.
- `.cf-cta submit` — large "Text me my first quote" button below the phone.
- `.cf-trust` — 3 avatars + "34 contractors signed up this week" copy.
- `.fine` — disclosure text.

## Behavior
- Avatar dot in the header pulses (`cfPulse`).
- Reply bubbles can animate in via `cfSlideIn` (used when JS adds an additional bubble after submit).
- The reply-typing dots animation (`cfDot`) is used elsewhere in the chat (not in the export's static markup but the keyframe is wired for use).
- As the user types into `#f-phone`, JS keeps `#cf-preview-text` in sync and re-renders the user bubble.

## Source
`pages/landing/raw.html` lines 1522–1910 (CSS), 2380–2459 (markup).

## Animations
See `animations.md` and `shared/design-tokens/motion.md` (`cfPulse`, `cfDot`, `cfSlideIn`).
