# InvoiceCard

The per-invoice flip card (`.qcard`). Front = mood gradient + status + avatar +
amount + subline + CTA. Back = read + an "Adjust this invoice" panel (discount +
change-order) + an action row. This is where every invoice mutation lives.

## 1. Classification & behavior
- **Bucket:** local component of the InvoicesPage island
  (`islands/InvoicesPage.tsx` lines 821–1409). Not its own island — it renders
  inside the page island, so it shares that hydration boundary.
- **Interaction tier:** **island-child, client-state + imperative mutations.**
  No form/PRG; no Fresh Partial. Each action is a hand-rolled `fetch` then a
  full-page reload.
- **Client state owned:** `flipped`, `busy`, `adjustOpen`, `discountDollars`,
  `coDesc`, `coDollars`, `coLink`, `adjErr`, `changeOrders` (lazy-loaded when
  the adjust panel first opens), `copiedCoId`.
- **Server actions + flash (all `fetch`, all end in `location.reload()` —
  FLAG):**
  | action | endpoint | when (stage) |
  |---|---|---|
  | confirm received | `POST /api/invoices/:id/confirm-payment` | claimed (CTA) |
  | reject claim | `POST /api/invoices/:id/reject-claim` | claimed (back) |
  | send text | `POST /api/invoices/:id/text` | overdue CTA / "Text client" |
  | send now (both channels) | `POST …/email` + `POST …/text` (allSettled) | scheduled CTA |
  | finish draft | `PUT /api/invoices/:id {status:"sent",issuedDate?}` then email+text | drafting CTA |
  | toggle mute | `PUT /api/invoices/:id {remindersMuted:!x}` | overdue/out (back) |
  | apply discount | `POST /api/invoices/:id/discount {discountCents}` | adjust panel |
  | create change-order | `POST /api/invoices/:id/change-orders {description,deltaAmountCents}` | adjust panel |
  | open invoice | `window.open("/i/:id")` (new tab) | out/paid CTA + "Open" |
  | copy CO link | `navigator.clipboard.writeText(origin+"/co/:id")` | per pending CO |
  | load change-orders | `GET /api/invoices/:id/change-orders` | adjust panel open |
  - **No flash/toast.** Success = the page reloads; failure on discount/CO sets
    `adjErr` text; other failures are silent (the reload simply doesn't happen).
- **Data source per region:**
  - card content ← the `EnrichedInvoice` prop (derived in the island).
  - `changeOrders` ← lazy `GET …/change-orders` on first adjust-open; `null`
    until loaded; `[]`/list after. **honest-empty:** list block only renders
    when `length>0`.
- **Liveness:** none; full reload after each mutation.
- **Data-shape hazards:**
  - `stage` (the 6-way `overdue|out|claimed|scheduled|drafting|paid`) is the
    island's derived bucket, NOT the stored `status` — see invoices-page.md §1.
  - `invoiceRef` is cosmetic: `INV-` + first 6 chars of the id, uppercased.
  - change-order `deltaAmountCents` rendered with `fmtMoneyExact` + a manual
    `+`/`−` sign and `Math.abs`.
- **Anti-patterns (FLAG):**
  - **`globalThis.location.reload()` after every mutation.** Loses scroll, the
    open track states (well, those persist via localStorage), the flip state,
    and re-runs all three page fetches. **Fix:** a server-action form +
    PRG, OR lift a `refetchInvoices()` callback from the island and re-pull
    `/invoices` to patch just this card's bucket. The card is already a client
    component, so the cleanest path is the lifted-callback refetch.
  - `confirm-payment`/`reject-claim`/`discount`/`change-orders` hit
    `/api/invoices/*` routes that are NOT in the documented client surface
    (`../../../data-model.md` only lists `GET /invoices`, `POST /invoices`,
    and the public claim) — these are front-end API routes layered on top.

## 2. Anatomy
```
<article class="qcard [qcard--flipped]" style="--mood-from/-to/-shadow/-status">
  <div class="qcard__mood">
    <div class="qcard__numeral">{idx+1 padded}</div>
    <div class="qcard__status"><span dot/> {moodLabel}</div>
  </div>
  <div class="qcard__av">{initials}</div>
  <div class="qcard__body">
    <div class="qcard__client-name">{client} · {invoiceRef}</div>
    <h3 class="qcard__title">{fmtMoney(amount)}</h3>     ← amount IS the title
    <p class="qcard__story">{subline}</p>
  </div>
  <div class="qcard__foot">
    <button class="qcard__cta" data-cy="invoice-cta-{stage}">{cta} →</button>
    <div class="qcard__val-wrap"> Due|Cleared + date </div>
  </div>
  <div class="qcard__back" aria-hidden={!flipped}>
    <div class="qcard__back-head"> close-X · eyebrow · big amount · moodLabel </div>
    <div class="qcard__back-body">
      <p class="qcard__read"> stage-specific reading </p>
      {stage!=="paid" && <button>Adjust this invoice ▾</button>
        + inline-styled panel: discount input+Apply,
          change-order desc+amount+Create-link, coLink, CO list w/ copy-link,
          adjErr }
    </div>
    <div class="qcard__back-foot">   ← up to 4 buttons
      {cta} · Open · (claimed: Didn't-get-it) · (overdue/out: Mute toggle | else Text client)
    </div>
  </div>
</article>
```

## 3. Props
| name | type | default | widget | signal? |
|---|---|---|---|---|
| `inv` | `EnrichedInvoice` (required) | — | object | no |
| `idx` | number (required) | — | number | no |
| `now` | Date (required) | — | (date) | no |
| `lang` | `Lang` (required) | — | select | no |

`EnrichedInvoice` adds to `Invoice`: `client`, `initials`, `invoiceRef`,
`daysOverdue`, `daysIn`, `stage`.

## 4. States → cases (driven by `inv.stage` + flip + adjust)
| state | meaning | case |
|---|---|---|
| overdue (front) | red mood, "Send nudge", daysOverdue subline | `cases/overdue/overdue.json` |
| out (front) | teal mood, "View invoice" | `cases/out/out.json` |
| claimed (front) | amber mood, "Okay, I got it", method/ref subline | `cases/claimed/claimed.json` |
| scheduled (front) | purple mood, "Send now" | `cases/scheduled/scheduled.json` |
| drafting (front) | brown mood, "Finish + send" | `cases/drafting/drafting.json` |
| paid (front) | green mood, "View receipt", paid date | `cases/paid/paid.json` |
| flipped | back face, adjust panel collapsed | `cases/flipped/flipped.json` |
| adjust-open | back face, discount + CO panel + CO list | `cases/adjust-open/adjust-open.json` |
| busy | mid-mutation, CTA shows "…", buttons disabled | `cases/busy/busy.json` |

## 5. Events
- `ev.expect(e => e.source==="article.qcard" && e.type==="click")` when not
  flipped and target not in `.qcard__cta,.qcard__back` → `flipped=true`.
- `…"button.qcard__cta[data-cy=invoice-cta-{stage}]"…click` → `ctaAction`
  (dispatches by stage; see table §1).
- `…"button.qcard__back-close"…click` → `flipped=false`.
- `…button "Adjust this invoice"…click` → toggles `adjustOpen`; first open
  triggers `loadChangeOrders()`.
- Discount Apply / CO Create-link / per-CO Copy-link → their handlers.
- back-foot Mute toggle / Text client / Didn't-get-it → their handlers.

## 6. Motion (extracted)
- **Flip:** `.qcard__back` `transform: translateY(8px) scale(.98)→
  translateY(0) scale(1)` over `380ms var(--ease-bounce)` + `opacity 0→1` over
  `240ms var(--ease-out)`. Pointer-events gated on `.qcard--flipped`.
- **Hover lift:** `.qcard:hover` `translateY(-4px)` + bigger mood-tinted shadow,
  `320ms` bounce.
- **Status dot:** `q-pulse-dot` opacity 1→.4→1 over `2.4s` infinite.
- **CTA arrow:** inline `transition:transform 240ms` (the `→` span);
  `.qcard__cta:hover` widens `gap 6→9px`.
- **Jank:** none notable — transforms/opacity only (GPU-friendly). The pulsing
  dot is the only always-on animation. Reduced-motion via global clamp (no
  component-local guard).

## 7. Responsive
- No own `@media`; inherits `.qcards` grid (`auto-fill minmax(320px,1fr)`,
  collapses to 1 col `≤768px`). The adjust panel + back-foot are inline-styled
  and flex/grid-wrap.

## 8. A11y
- The whole `<article>` is a click target (flip) but is not a button / not
  focusable / no `aria-expanded` for the flip — keyboard users can't flip.
  **Fix:** add a focusable flip affordance.
- `.qcard__back aria-hidden={!flipped}` correctly hides the back from AT while
  collapsed; close-X has `aria-label`.
- The discount/CO inputs lack `<label for>` (visually-labeled divs only).

## 9. Used on
`/invoices` only (rendered by InvoicesPage in all 6 tracks). Reuses the Quotes
`.qcard*` CSS verbatim — see `css/invoice-card.css`.
