# Capture checklist — DeleteQuoteButton

**Theme:** light only.
**Auth:** dev master OTP `000000`.

## Route / URL
- `http://localhost:5280/quotes`. The button appears in two places:
  - **btn variant** — inside a QuoteCard back foot: click a card to **flip** it,
    the "Delete" button is the 4th button in `.qcard__back-foot`.
  - **icon variant** — the `×` at the right of each **DecidedRow** in Track 03
    "Decided this month" (expand the collapsed track to see them).

## Viewports
- **1280px** and **560px**. At 560px the DecidedRow hides `.qdone__when` but
  keeps the `×` — confirm the icon button survives the reflow. The btn variant
  lives in the fixed-geometry card foot (no reflow).

## Element(s) to crop
- The btn variant: crop the full `.qcard__back-foot` (4 buttons) so "Delete"
  reads in context next to Resend / Copy link / View as client.
- The icon variant: crop a single `.qdone__row` showing the `×` at the row end.

## Transient states to drive
1. **btn idle / icon idle** — default "Delete" / `×`.
2. **hover** — both go pink-tinted (border+color; btn also lifts `-1px`).
3. **delete-confirm** — click either → native
   `confirm("Delete this quote? This cannot be undone.")`. **Shoot the confirm
   dialog.** This is the key transient. Then **cancel** (accepting fires
   `DELETE /quotes/:id` then `location.reload()` — the page nukes itself).
4. **busy** — to capture "Deleting…" / disabled `×` without a backend, mock
   `quotesClient.delete` as never-resolving (isolate `btn-busy`/`icon-busy`
   cases) and accept the confirm; the label flips to "Deleting…" and the button
   disables (`opacity:.5; cursor:wait`).
5. **error alert** — mock `quotesClient.delete` to reject → native
   `alert("Couldn't delete quote: …")`. Shoot the alert; `busy` resets to false
   after.

## Motion to film
- Only hover transitions (`--dur-fast` color/transform). No keyframes. Film a
  hover in/out for each variant. Re-shoot with `prefers-reduced-motion: reduce`
  (global tokens clamp — hover goes instant). Note: the destructive flow's real
  "motion" is the **full page reload** on success — flag it, don't pixel-diff it.
