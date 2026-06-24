# PublicChangeOrderActions

The customer-facing **Approve / Decline** control on the public change-order page
(`/co/:id`). The SSR route renders the document (eyebrow, heading, "what's
changing" card, the money breakdown band); this island is mounted at the foot of
that card and lets the homeowner decide. Approving applies the delta to the
linked invoice **server-side** (the backend refuses to mark the order approved if
that invoice write fails).

Source: `islands/PublicChangeOrderActions.tsx` (copied to
`js/PublicChangeOrderActions.tsx`, 117 lines). Mounted by `routes/co/[id].tsx`.

## 1. Classification & behavior
- **Bucket:** `island` (`islands/PublicChangeOrderActions.tsx`).
- **Interaction tier:** `island` — client state + a `fetch` POST mutation. NOT a
  Fresh Partial, NOT an SSR form/PRG. The two buttons are `<button type="button">`
  wired to an `onClick` that calls `fetch` directly.
- **Surface:** **public palette** (inline hex literals — `#519843` green,
  `#1c2c30` ink, `#6b7a7e` muted, `#e3e8e6` hairline, `#a83b3b` declined-text),
  NOT Sabor tokens. The host page loads `/landing.css` only for resets.
- **Client state owned:**
  - `status: "pending" | "approved" | "declined"` — seeded from the
    `initialStatus` prop (the SSR'd `ChangeOrderPublic.status`). This is the
    terminal latch: once not `"pending"`, the action buttons are gone and a
    result panel renders instead.
  - `busy: "approve" | "decline" | null` — which action is in flight (default
    `null`). Disables BOTH buttons while non-null.
  - `error: string | undefined` — inline error text under the buttons.
- **Server mutation (action endpoint) + feedback:**
  - **Approve:** `POST /api/change-orders/:id/approve` (same-origin Fresh `/api`
    proxy → backend `POST /change-orders/:id/approve`), `credentials:"include"`,
    no body. On `res.ok` → `setStatus("approved")` → swaps to the green approved
    panel.
  - **Decline:** `POST /api/change-orders/:id/decline` (no body). On ok →
    `setStatus("declined")` → declined panel.
  - **Flash:** inline only. While in flight the clicked button's label swaps to
    its busy copy (Approve → `publicChangeOrderActions.approving` "Approving…";
    Decline → literal `"…"`) and both buttons are `disabled`. No toast, no
    redirect, no flash cookie.
- **Logical-failure mapping (leak prevention):** on a non-`ok` response the
  island parses `body.reason`. If `reason === "invoice_update_failed"` it shows
  the localized `publicChangeOrderActions.applyError` ("We couldn't update the
  invoice — nothing was changed…") rather than echoing the raw reason; any other
  `reason` is shown as-is, else falls back to
  `publicChangeOrderActions.submitError` ("Couldn't submit ({status})"). On a
  thrown/network error, the caught `err.message` is shown.
- **`location.reload()` FLAG:** **None — and that is correct.** State transitions
  are pure in-memory `useState` (the `status` latch), and the result panels are
  rendered client-side from that state. This is the GOOD pattern (contrast
  `PublicSignContract`, which DOES `location.reload()` after sign). Do NOT
  introduce a reload here on rebuild; the approved/declined panels already convey
  the outcome without re-hitting the server.
- **Liveness:** request-response only. No polling, no websocket, no SSE.
- **Data source / honest-empty:** the island owns no fetch on mount — all display
  data (the money band) is SSR'd by the route; this island only receives
  `changeOrderId`, `initialStatus`, `lang` as props. If the route can't resolve
  the change order it renders its own error card and never mounts this island. If
  `initialStatus` is already `approved`/`declined` (link re-opened after a
  decision), the island mounts straight into the terminal panel — no buttons.
- **Reactivity / i18n:** `lang` is a **prop** (`"en"|"es"`, default `"en"`),
  resolved by the route from `co.commsLanguage` (the contractor's outgoing-comms
  language). All strings via `tFor(lang, key, vars)`. There is **no on-page
  language toggle**, so this island is NOT reactive to `langSignal` — it renders
  in the document's fixed language.
- **Data-shape hazards:** none of its own (it consumes scalars). The page it
  lives on inherits data-model.md hazard #7 — `GET /change-orders/:id/public`
  is a customer-facing join hit from SMS/email links; the approve path writes the
  delta onto the bound invoice and only then flips status
  ("invoice_update_failed" guards that ordering). The id passed here
  (`co.id`) is the only FK the island sees; `userId`/`contractId`/`invoiceId`
  are server-side and never reach the client.

## 2. Anatomy (100% inline styles — no CSS classes)
```
status !== "pending"  →  result panel (terminal)
<div style="margin-top:24px;
            background: approved ? rgba(81,152,67,0.08) : rgba(168,59,59,0.06);
            border:1px solid #e3e8e6; border-radius:14px; padding:20px 24px">
  <div eyebrow  style="font:11px/800; letter-spacing:.14em; uppercase;
                       color: approved ? #519843 : #a83b3b">
     { approved ? publicChangeOrderActions.approvedLabel "Approved"
                : status.declined "Declined" }
  </div>
  <p style="margin:8px 0 0; color:#1c2c30; font:15px/1.55">
     { approved ? publicChangeOrderActions.approvedMessage
                : publicChangeOrderActions.declinedMessage }
  </p>
</div>

status === "pending"  →  action stack
<div style="margin-top:24px; display:flex; flex-direction:column; gap:12px">
  <button approve  type=button  disabled={busy!==null}
     style="border:0; border-radius:12px; padding:15px 18px; background:#519843;
            color:#fff; font:16px/800; cursor:pointer">
     { busy==="approve" ? "Approving…" : "Approve this change" }
  </button>
  <button decline  type=button  disabled={busy!==null}
     style="border:1px solid #e3e8e6; border-radius:12px; padding:13px 18px;
            background:#fff; color:#6b7a7e; font:15px/700; cursor:pointer">
     { busy==="decline" ? "…" : "Decline" }
  </button>
  {error && <p role="alert" style="color:#a83b3b; font:13px; margin:2px 0 0">{error}</p>}
</div>
```
- **Button hierarchy (matches global rule):** one solid green primary (Approve),
  one outlined-on-white secondary (Decline). Good — no two competing gradient
  CTAs.
- **Slots/children:** none.

## 3. Props
| name | type | default | control | signal? |
|---|---|---|---|---|
| `changeOrderId` | `string` (required) | — | text | no |
| `initialStatus` | `"pending"\|"approved"\|"declined"` (required) | — | select | no (seeds `status` state) |
| `lang` | `"en"\|"es"` | `"en"` | select | no |

`busy` and `error` are internal `useState`, not props — drive via Events / case
`_signals`.

## 4. States → cases
| state | meaning | case |
|---|---|---|
| pending | idle — Approve + Decline buttons | `cases/pending/pending.json` |
| approving | Approve clicked, POST in flight (both disabled, "Approving…") | `cases/approving/approving.json` |
| approved | terminal — green panel "Approved" + approvedMessage | `cases/approved/approved.json` |
| declined | terminal — pink-tinted panel "Declined" + declinedMessage | `cases/declined/declined.json` |
| error | inline red `role="alert"` (e.g. invoice_update_failed → applyError) | `cases/error/error.json` |
| es | Spanish strings throughout | `cases/es/es.json` |

`status` is seeded by `initialStatus`; isolate drives the terminal panels by
setting `initialStatus` to `"approved"`/`"declined"`, and the transient
busy/error via `_signals`.

## 5. Events (`capture(page)` predicates)
- `ev.expect(e => e.source === "button" /* Approve */ && e.type === "click")`
  → `decide("approve")` → `setBusy("approve")` → `POST /api/change-orders/:id/approve`
  → on ok `setStatus("approved")`; on fail `setError(...)`, `setBusy(null)`.
- `ev.expect(e => e.source === "button" /* Decline */ && e.type === "click")`
  → `decide("decline")` → `POST /api/change-orders/:id/decline` → `setStatus("declined")`.
- Re-entrancy guard: `decide()` early-returns while `busy` is non-null, so a
  second click is ignored — preserve this (the only double-submit guard).
- (Neither button carries a stable class/id — capture by tag + label text /
  position. Rebuild SHOULD add a stable selector, e.g. `data-cy`, for testability;
  the sibling `PublicInvoiceClaim` already uses `data-cy` hooks.)

## 6. Motion (real CSS only)
- **None declared.** No `@keyframes`, no `transition`. The pending→terminal swap
  and the disabled state flip are instant (the label text just changes, the
  buttons gain `disabled`). Nothing to film; no reduced-motion concern of its own.
- The decorative pink top-bar / shadows belong to the SSR route document, not
  this island.

## 7. Responsive
- No own `@media`. The action stack is `display:flex; flex-direction:column`
  (full-width buttons), inside the route's `max-width:560px` document column with
  `padding:32px 16px`. Buttons are full-width at every breakpoint, so it reflows
  cleanly on phones with no query needed.

## 8. A11y
- The inline error is `role="alert"` — good (announced on failure).
- Both controls are real `<button type="button">` with `disabled` while busy.
- **Gaps:**
  - The pending→terminal transition moves no focus and the result panel has no
    `role="status"`/`aria-live`, so a screen-reader user who triggered Approve
    isn't told the outcome. Rebuild: announce the result panel (and/or move focus
    to it).
  - The busy state communicates only via the label text swap + `disabled`; no
    `aria-busy` on the button. Add `aria-busy={busy!==null}`.
  - Buttons have no `aria-label`/stable hook; the "…" decline-busy label is
    meaningless to SR users (give Decline a busy label string like Approve's).

## 9. Used on
- `/co/:id` only — mounted by `routes/co/[id].tsx` at the bottom of the
  change-order document `<article>`, passed `changeOrderId={co.id}`,
  `initialStatus={co.status}`, `lang` (from `co.commsLanguage`). Sole importer.
