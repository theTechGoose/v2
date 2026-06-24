# PublicInvoiceClaim

The customer-facing **"I'm paying you by X"** control on the public invoice page
(`/i/:id`). The contractor's accepted payment methods render as chip buttons;
tapping a chip reveals that method's handle/address and a reference + name input;
"I sent it" POSTs a **payment claim**. This is the customer half of the
**MANUAL-ONLY** payment flow — the customer *claims* a payment, the contractor
later *confirms* it. **There is no card processing / merchant rail anywhere.**

Source: `islands/PublicInvoiceClaim.tsx` (copied to `js/PublicInvoiceClaim.tsx`,
313 lines). Mounted by `routes/i/[id].tsx` under the invoice document.

## 1. Classification & behavior
- **Bucket:** `island` (`islands/PublicInvoiceClaim.tsx`).
- **Interaction tier:** `island` — client state + a `fetch` POST mutation. NOT a
  Fresh Partial, NOT an SSR form/PRG.
- **Surface:** **public palette** (inline hex — `#FF6B6B`/`#d94e4e` pink active
  chip, `#519843` green submit, `#144852` teal, `#1c2c30` ink, `#6b7a7e` muted,
  `#e3e8e6` hairline), NOT Sabor. Emits NO `<style>` and uses NO CSS classes —
  100% inline (see `css/public-invoice-claim.css`, which records the literals +
  the `data-cy`/`data-kbd-group` hooks).
- **Manual-only payment model (data-model alignment):**
  - The flow ties to **`Invoice.paymentIntent`** — the customer claim is what
    *creates* it. `POST /api/invoices/:id/claim-payment { method, reference?,
    claimedBy? }` flips the invoice to `status:"claimed"` and stamps
    `paymentIntent` (method/amount/reference/claimedAt/claimedBy). The contractor
    later confirms → creates a `Payment` row → invoice flips to `paid`. **This
    island never sees money move** — it records intent, nothing more.
  - **No card/merchant processing.** The chips are pay-OUTSIDE-the-app rails
    (Zelle/CashApp/check/cash/Venmo/PayPal/ACH/other). Even when `card`/`ach`
    appear in the method enum they are *log-how-you-paid* labels, not in-app
    charges — consistent with the project's manual-only rule.
- **Client state owned:**
  - `selected: string | undefined` — the chosen method key (default `undefined`;
    no detail panel until one is picked).
  - `reference: string` — optional confirmation #/memo (placeholder varies by
    method).
  - `claimedBy: string` — pre-filled from the `customerName` prop, editable.
  - `submitting: boolean` — POST in flight.
  - `done: boolean` — terminal latch → swaps to the green "thanks" panel.
  - `error: string | undefined` — inline error in the detail panel.
- **Server mutation + feedback:**
  - `submit()` early-returns unless `selected` AND not already `submitting`. POSTs
    only the present keys (`reference`/`claimedBy` omitted when blank),
    `credentials:"include"`. On non-ok: parses `body.reason` and shows it, else
    `publicInvoiceClaim.submitError` ("Couldn't record that (HTTP {status})"). On
    ok → `setDone(true)`.
  - **Flash:** inline only. The "I sent it" button swaps to
    `publicInvoiceClaim.sending` and `cursor:wait`, `disabled` while submitting;
    error renders inline in the detail panel; success swaps the whole section to
    the thanks panel.
- **`location.reload()` FLAG — NONE, and that is the GOOD pattern.** Success is a
  pure in-memory state swap (`done=true` → thanks panel); the page does NOT hard
  refresh. This is the correct contrast to the sibling `PublicSignContract`, which
  DOES `location.reload()` after sign. Do NOT introduce a reload here on rebuild.
- **Liveness:** request-response only. No polling/websocket.
- **Data source / honest-empty:**
  - Owns no fetch on mount — receives `invoiceId`, `acceptedMethods`,
    `customerName`, `lang` as props (the SSR route joins
    `InvoicePublic.acceptedMethods` from the contractor's identity).
  - **Honest-empty:** if `acceptedMethods.length === 0`, the island renders the
    pink fallback panel `publicInvoiceClaim.noMethods` ("Reach out to your
    contractor to coordinate payment…") instead of an empty chip row — no
    selectable UI. This is the brand-new / unconfigured-payments case.
- **Reactivity / i18n:** `lang` is a **prop** (`"en"|"es"`, default `"en"`),
  resolved by the route from the contractor's comms language; all strings via
  `tFor(lang,key,vars)` plus three module helpers — `methodLabel`,
  `methodInstructions` (per-method send copy, handle-aware), `referencePlaceholder`
  (per-method input hint). No on-page toggle → NOT reactive to `langSignal`.
- **Data-shape hazards:** none of its own (it consumes a small `Method[]`). The
  page inherits data-model.md hazard #7 — `GET /invoices/:id/public` fans out a
  join (invoice → contract → quote → customer → contractor profile → accepted
  methods → sibling installments) on every uncached, SMS/email-driven load.
  `acceptedMethods` here is the joined `acceptedMethods` slice
  (`{ method, handle? }[]`); `card`/`ach` may carry a raw `handle` shown verbatim.

## 2. Anatomy (inline styles; see css for literals + data-cy hooks)
```
acceptedMethods.length === 0  →  <section data-cy="claim-no-methods">  (pink fallback)
   bg rgba(255,107,107,0.04); border rgba(255,107,107,0.20); radius 14px
   → publicInvoiceClaim.noMethods

done === true  →  <section data-cy="claim-thanks">  (green terminal)
   bg rgba(81,152,67,0.08); border rgba(81,152,67,0.30); radius 14px
   <div eyebrow #519843>  publicInvoiceClaim.thanksHeading
   <p #1c2c30 15px>       publicInvoiceClaim.thanksBody

else  →  <section data-cy="claim-form" margin-top:28px>
  <div eyebrow #6b7a7e>  publicInvoiceClaim.howToPay
  <div chip-row flex-wrap gap:8px>
     acceptedMethods.map(m →
       <button data-cy=claim-method-{m.method}  onClick=setSelected(m.method)
          style="radius:999px; padding:9px 16px; 13.5px/700;
                 active ? bg #FF6B6B/color #fff/border #d94e4e
                        : bg #fff /color #1c2c30/border #e3e8e6">
          {methodLabel(m.method, lang)} />)
  {selectedMethod &&
   <div data-cy="claim-detail" data-kbd-group
        style="bg #fff; border 1px #e3e8e6; radius:14px; padding:18px 20px">
     <div eyebrow #144852>  {methodLabel(selectedMethod.method, lang)}
     <div #1c2c30 14.5px>   {methodInstructions(selectedMethod, lang)}   ← "Send to <handle> on Zelle"
     <label>  publicInvoiceClaim.referenceLabel
       <input data-cy=claim-reference value=reference placeholder=referencePlaceholder(...)/>
     <label>  publicInvoiceClaim.nameLabel
       <input data-cy=claim-name value=claimedBy placeholder=namePlaceholder/>
     {error && <div #a83b3b 13px>{error}</div>}
     <button data-cy=claim-submit type=button onClick=submit disabled={submitting}
        style="width:100%; bg #519843; color #fff; radius:12px; padding:14px 18px;
               15px/800; box-shadow:0 8px 18px -6px rgba(81,152,67,0.45);
               cursor: submitting ? wait : pointer">
        { submitting ? publicInvoiceClaim.sending : publicInvoiceClaim.iSentIt }
     </button>
   </div>}
</section>
```
- **`methodInstructions` (handle-aware):** Venmo/Zelle/CashApp/PayPal →
  "Send to {handle} on {svc}" (or "Send via {svc}" if no handle); check →
  mail-to address or generic; cash → coordinate copy; ach/card/other → raw
  `handle` if present else generic.
- **`data-kbd-group`** on the detail panel = a mobile soft-keyboard scroll hook
  (keeps the focused input in view above the keyboard inset).
- **Slots/children:** none.

## 3. Props
| name | type | default | control | signal? |
|---|---|---|---|---|
| `invoiceId` | `string` (required) | — | text | no |
| `acceptedMethods` | `{ method: string; handle?: string }[]` (required) | — | json | no |
| `customerName` | `string?` | `undefined` (pre-fills `claimedBy`) | text | no |
| `lang` | `"en"\|"es"` | `"en"` | select | no |

`selected`/`reference`/`claimedBy`/`submitting`/`done`/`error` are internal
`useState` — drive via Events / case `_signals`.

## 4. States → cases
| state | meaning | case |
|---|---|---|
| methods | chip row, none selected (no detail panel) | `cases/methods/methods.json` |
| zelle-selected | a chip active (pink) + detail panel ("Send to … on Zelle") + inputs | `cases/zelle-selected/zelle-selected.json` |
| submitting | claim POST in flight → "Sending…", cursor:wait, disabled | `cases/submitting/submitting.json` |
| thanks | `done=true` green panel "payment marked as sent" (NO reload) | `cases/thanks/thanks.json` |
| no-methods | `acceptedMethods=[]` → pink fallback "coordinate payment" | `cases/no-methods/no-methods.json` |
| error | claim POST failed → red error line in detail panel; form stays open | `cases/error/error.json` |
| es | Spanish strings + method labels (Cheque/Efectivo) + "Ya lo envié" | `cases/es/es.json` |

## 5. Events (`capture(page)` predicates)
- `ev.expect(e => e.source === "button.claim-method-zelle" && e.type === "click")`
  → `setSelected("zelle")` → reveals the detail panel (one per method key:
  `claim-method-cashapp`, `-check`, `-cash`, …).
- `ev.expect(e => e.source === "input.claim-reference" && e.type === "input")` →
  `setReference(value)`.
- `ev.expect(e => e.source === "input.claim-name" && e.type === "input")` →
  `setClaimedBy(value)`.
- `ev.expect(e => e.source === "button.claim-submit" && e.type === "click")` →
  `submit()` → `POST /api/invoices/:id/claim-payment` → on ok `setDone(true)`
  (thanks panel, NO reload); on fail `setError(...)`.
- Re-entrancy guard: `submit()` early-returns while `submitting` (the only
  double-submit guard) — preserve it.
- (Selectors use the source's `data-cy` hooks — stable; reuse them on rebuild.)

## 6. Motion (real CSS only)
- **None declared.** No `@keyframes`, no `transition`. Chip active/inactive,
  detail-panel reveal, "Sending…" label swap, and the thanks/no-methods panels are
  all instant. Nothing to film; no reduced-motion concern.

## 7. Responsive
- No own `@media`. The chip row is `display:flex; flex-wrap:wrap; gap:8px` so chips
  wrap on narrow screens; the detail panel + inputs are full-width
  (`box-sizing:border-box`). Lives inside the route's document column. The
  `data-kbd-group` hook handles soft-keyboard avoidance on mobile.

## 8. A11y
- The detail-panel labels are real `<label>`/`<span>` pairs wrapping their inputs.
- **Gaps:**
  - Chips are `<button type="button">` (focusable — good) but expose no
    `aria-pressed` for the active/selected state — a SR user can't tell which
    method is chosen. Add `aria-pressed={active}`.
  - The inline error is a plain `<div>` (no `role="alert"`/`aria-live`) → a claim
    failure isn't announced. Add `role="alert"`.
  - On success no focus is moved to the thanks panel and it has no `role="status"`.
  - The detail panel appears on chip select with no focus management (focus stays
    on the chip); consider moving focus to the reference input.

## 9. Used on
- `/i/:id` only — mounted by `routes/i/[id].tsx` under the invoice document,
  passed `invoiceId`, `acceptedMethods` (joined from `InvoicePublic`),
  `customerName`, `lang`. Sole importer.
