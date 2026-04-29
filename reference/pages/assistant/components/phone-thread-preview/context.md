# Phone thread preview (Assistant)

## What
The mobile companion view of the same conversation that the desktop renders in `<AssistantWorkspace>`. Uses the shared `.phone` chassis but swaps the contents:

- Top bar: back · client header (avatar + name + sub-state) · more.
- A new "deal phase strip" sits below the top bar: `Quote ✓ → Terms (active 4/10) → Send`.
- Body shows the same chat thread the desktop shows, plus phase dividers (`Phase 1 — done`, `Phase 2 — Terms`).
- A compact variant of the wizard (border-radius 13) is embedded inside an assistant message.

## Anatomy
- `.phone` shell — see `shared/phone-preview/`.
- `.phone__top` — re-purposed: back button (left), 32px logo tile + client name + state (center), more button (right).
- Deal phase strip — inline-styled, no class. A row of three step pills (`Quote` complete green, `Terms` active teal-filled, `Send` ghost) with chevron separators and a `4/10` counter at the right.
- `.phone__scroll` — chat list with `.msg` / `.msg--user` bubbles, action cards, phase dividers, and an embedded `.wiz` block.

## Why a separate folder
This documents the contents that fill the phone chassis on the Assistant page. The chassis itself (status bar, notch, scroll, tabs, home indicator) is described in `shared/phone-preview/`.

## Source
`pages/assistant/raw.html` lines 4030–4234 (PhoneAssistant component).

## Animations
None. Everything is static markup.
