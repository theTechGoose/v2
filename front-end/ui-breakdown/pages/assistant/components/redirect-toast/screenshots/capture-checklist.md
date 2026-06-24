# Capture checklist — RedirectToast

**Theme:** light only.
**Auth:** dev master OTP `000000`.

## Route / URL
- Trigger by navigating to **`http://localhost:5280/messages`** — it 302s to
  `/assistant?from=messages`, and the toast fires on mount.
- Equivalently hit `http://localhost:5280/assistant?from=messages` directly.

## Viewports
- **1280px** and **390px** (mobile) — confirm the pill stays top-center and
  respects `max-width:90vw`.

## Element(s) to crop
- The fixed top-center teal pill with the consolidation line
  (`redirectToast.messagesConsolidated`). Crop the toast and a sliver of the
  page behind it for context.

## Transient states to drive
1. **from-messages** — load `/messages` (or `/assistant?from=messages`); capture
   within the 6-second window before it self-dismisses. Note the URL bar: the
   `?from=` param is stripped immediately via `history.replaceState`, so a reload
   will NOT re-show it.
2. **hidden** — load a plain `/assistant`; confirm no toast renders.

## Motion to film
- None — the toast has no entrance/exit animation (conditional render only). No
  reduced-motion concern.
