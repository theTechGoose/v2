# Capture checklist — PublicChangeOrderActions

**Theme:** light only. **Palette:** public surface (inline hex, NOT Sabor).
**Auth:** NONE — `/co/:id` is a public, auth-free customer link. It does need a
**valid change-order token id** to resolve (otherwise the route renders its own
"can't open this" error card and the island isn't mounted). No fabricated
screenshots — drive on a real `/co/:id` page.

## Route / URL
- `http://localhost:5280/co/<changeOrderId>` for an order whose backend `status`
  is `pending` (to capture the action buttons). Crop the area BELOW the money
  breakdown band (the "Previous/Current total · Added/Credit · New total" rows),
  where this island mounts.
- For the terminal panels, open a link whose order is already `approved` /
  `declined` (the island seeds `status` from `initialStatus` on mount), OR drive
  the transition live by clicking the button against the real backend.
- For Spanish, use an order whose `commsLanguage === "es"` (the route resolves
  `lang` from `co.commsLanguage`).

## Viewports (no own @media)
- **~390px** (primary — phone; buttons are full-width).
- **560px** (the route's document column cap).

## Element(s) to crop
- The full-width action stack (green Approve over outlined Decline) for pending;
  the single tinted result panel for approved/declined. Include a sliver of the
  money band above for context.

## States to drive
1. **pending** — idle: solid green "Approve this change" + outlined white
   "Decline".
2. **approving** — click Approve; capture the disabled "Approving…" label (both
   buttons disabled). Drive by stalling the `/api/change-orders/:id/approve`
   response, or screenshot quickly.
3. **approved** — after a successful approve (or on an already-approved link):
   green-tinted `rgba(81,152,67,0.08)` panel, eyebrow "Approved" (#519843), body
   "Thanks! Your updated invoice total reflects this change." Confirm NO buttons
   remain and NO page reload happened (in-memory state swap).
4. **declined** — after Decline (or an already-declined link): pink-tinted
   `rgba(168,59,59,0.06)` panel, eyebrow "Declined" (#a83b3b), body "No
   problem — we've let your contractor know."
5. **error** — force a non-ok approve with `reason:"invoice_update_failed"` (mock
   the proxy) → inline red `role="alert"` reading the friendly applyError
   ("We couldn't update the invoice — nothing was changed…"). Confirm the raw
   reason token never appears, and both buttons are clickable again for retry.
6. **es** — Spanish: "Aprobar este cambio" / "Rechazar", busy "Aprobando…",
   approved "Aprobado" + "¡Gracias! El total actualizado…".

## Motion
- None to film — no CSS transitions/keyframes; the pending→terminal swap and the
  disabled flip are instant.
