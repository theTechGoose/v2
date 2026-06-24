# NewInvoiceModal

The create/schedule-an-invoice modal overlay opened from the hero's **New
invoice** CTA. Pick (or add) a client, set an amount + due date, and it creates
a standalone **draft** invoice — no quote/contract behind it. Mirrors the
add-client modal pattern on /clients. Fully **inline-styled** (no class hooks
beyond the form/layout).

## 1. Classification & behavior
- **Bucket:** local component of the InvoicesPage island
  (`islands/InvoicesPage.tsx` `const NEW_SENTINEL` line 1413, `function
  NewInvoiceModal()` lines 1418–1632). Not its own island — it mounts inside the
  page island when `newOpen` is true.
- **Interaction tier:** **client-only island overlay.** A modal mounted by the
  parent (`{newOpen && <NewInvoiceModal …/>}`). No Fresh form/PRG, no Partial —
  submit is a hand-rolled async handler.
- **Client state owned:** `clientSel` (select value; `""` = none,
  `"__new__"` = add-new), `newName`, `newPhone`, `newEmail` (inline new-client
  fields, shown only when `clientSel === "__new__"`), `amount` (string, dollars),
  `dueDate` (string, seeded to **today + 30 days**), `busy`, `error`.
- **Server action + flash (FLAG `location.reload()`):**
  | step | call | endpoint |
  |---|---|---|
  | (optional) create client | `clientsClient.create({ name, phoneNumber?, email? })` | `POST /customers` |
  | create invoice | `dashboardClient.createInvoice({ customerId?, amount(CENTS), dueDate, issuedDate, status:"draft" })` | `POST /invoices` |
  | refresh | `globalThis.location.reload()` | — full page reload |
  - On success it **does NOT call `onClose()` or re-fetch** — it
    `globalThis.location.reload()`s so the new draft enriches into the Drafting
    track. **No flash/toast** — the reload IS the feedback.
  - On validation failure it sets `error` (rendered as a `role="alert"`
    paragraph) and returns without submitting; the modal stays open.
  - On network/thrown failure it sets `error` to `err.message` (or
    `invoicesPage.new.errCreate`) AND `setBusy(false)` so the user can retry.
  - **Anti-pattern (FLAG):** the success path `location.reload()` discards all
    client state (scroll, open tracks survive via localStorage, but the flip
    states and any in-flight forecast re-fire) and re-runs the page's three
    on-mount fetches. **Fix:** lift a `refetchInvoices()` callback from the
    island (the same fix recommended for InvoiceCard) — on create success call
    `onClose()` + refetch `/invoices`, never reload. The island already holds
    `setS`; this is mechanical.
- **Data source + honest-empty:**
  - The client `<select>` is populated from the `customers` prop (passed down
    from the island's `GET /customers`). **Honest-empty:** with zero customers
    the dropdown still renders the two synthetic options ("No client (add
    later)" + "+ New client"), so an invoice can always be created — picking
    "+ New client" reveals the inline name/phone/email block.
- **Liveness:** none — single create, then full reload.
- **Data-shape hazards (invoice money/units):**
  - `amount` is typed in **dollars** by the user (`type="number" step="0.01"`)
    then converted to **integer CENTS** at submit (`Math.round(Number(amount) *
    100)`) before `createInvoice` — matching the cents-everywhere convention.
    Validation rejects `≤ 0` / non-numeric.
  - The created invoice is forced `status:"draft"` with `issuedDate = today`, so
    it lands in the island's **Drafting** bucket (`isDraft` true). It is NOT a
    `scheduled` invoice despite the task's "create/schedule" framing — there is
    no `scheduledFor` field set here; scheduled invoices come from
    multi-installment contracts, not this modal.
  - The new-client create fires **before** the invoice create; if the client
    create succeeds but the invoice create throws, you get an orphan customer
    (no rollback) — a real edge to flag.

## 2. Anatomy
```
<div onClick=close-on-scrim style="fixed inset:0; bg:rgba(20,40,45,.45); flex center; z-index:1000; padding:20px">
  <form data-cy="new-invoice-modal" onClick=stopPropagation onSubmit=submit
        style="bg:#fff; radius:16px; pad:24/26; max-width:460px; shadow:0 24px 64px rgba(20,72,82,.22); flex-col gap:14">
    <h2>{new.title → "New invoice"}</h2>
    <p>{new.intro}</p>

    <label>{new.client}
      <select data-cy="new-invoice-client">
        <option value="">{new.clientNone → "No client (add later)"}</option>
        {customers.map → <option value={c.id}>{c.name}</option>}
        <option value="__new__">{new.newClient → "+ New client"}</option>
      </select>
    </label>

    {clientSel==="__new__" && <div sunken-panel rgba(0,0,0,.03)>
       <label>{settings.name}  <input autoFocus required/></label>
       <label>{settings.phone} <input type=tel/></label>
       <label>{settings.email} <input type=email/></label>
    </div>}

    <label>{new.amount → "Amount (USD)"} <input type=number step=.01 data-cy="new-invoice-amount" placeholder="0.00"/></label>
    <label>{new.dueDate}                 <input type=date data-cy="new-invoice-due"/></label>

    {error && <p role="alert" style="color:#a83b3b">{error}</p>}

    <div actions flex end>
      <button type=button (Cancel)>{common.cancel}</button>
      <button type=submit data-cy="new-invoice-submit" green>{busy ? new.creating : new.create}</button>
    </div>
  </form>
</div>
```
- **100% inline-styled** — no `.qph__*`/`.qcard__*` classes; the only stable
  hooks are the `data-cy` attributes. Shared field styles via two local style
  strings: `labelStyle` (flex-col label, `--fg-muted` fallback `#6b7560`) and
  `inputStyle` (1px `--border` fallback `#d8dcd5`, radius 10, 15px font).
- Hardcoded hex fallbacks bypass tokens: scrim `rgba(20,40,45,.45)`, card shadow
  `rgba(20,72,82,.22)`, error `#a83b3b`, green `--brand-green` fb `#519843`, fg
  `--fg` fb `#144852`. See `css/new-invoice-modal.css`.

## 3. Props
| name | type | default | widget | signal? |
|---|---|---|---|---|
| `customers` | `Customer[]` (required) | — | json | no |
| `lang` | `Lang` (required) | — | select | no |
| `onClose` | `() => void` (required) | — | (callback→Events) | no |

(No `lang` reactivity here — it's a plain prop from the parent, which itself
reads `langSignal`.)

## 4. States → cases
| state | meaning | case |
|---|---|---|
| default | open modal, existing-client select, empty amount, due=+30d | `cases/default/default.json` |
| new-client | `clientSel="__new__"` → inline name/phone/email block visible | `cases/new-client/new-client.json` |
| error | validation/network failure → `role="alert"` line shown | `cases/error/error.json` |
| busy | mid-submit → all fields disabled, button reads "Creating…" | `cases/busy/busy.json` |
| es | Spanish labels/copy | `cases/es/es.json` |

## 5. Events
- `capture(page)`: `e.source==="form[data-cy=new-invoice-modal]" &&
  e.type==="submit"` → `submit` (validate → optional `POST /customers` →
  `POST /invoices` → `location.reload()`).
- `capture(page)`: `e.source==="div"(scrim) && e.type==="click"` → `onClose()`
  **unless `busy`**.
- `capture(page)`: `e.source==="form" && e.type==="click"` → `stopPropagation`
  (clicks inside the card don't close it).
- `capture(page)`: `e.source==="button"(Cancel) && e.type==="click"` →
  `onClose()` (disabled while busy).
- `capture(page)`: `select[data-cy=new-invoice-client] onInput` → sets
  `clientSel`; value `"__new__"` reveals the new-client block.
- Field `onInput` handlers update `newName`/`newPhone`/`newEmail`/`amount`/
  `dueDate`.

## 6. Motion
- **None.** The modal appears/disappears by conditional mount — no
  enter/exit transition in source; it pops in instantly. No keyframes on any
  element. **Jank finding:** the abrupt pop-in (no fade/scale) is a polish gap,
  not jank — there's nothing to drop frames. **Fix on rebuild:** add a
  `--dur-fast` opacity/scale enter (and respect the global reduced-motion
  clamp). Reduced-motion: nothing to clamp today.

## 7. Responsive (own — inline, no `@media`)
- No `@media` queries (it's inline-styled). Fluid by construction: scrim has
  `padding:20px`; the card is `max-width:460px; width:100%`, so it shrinks to
  fill small viewports with a 20px gutter. The `<select>`/`<input>`s are
  full-width block. Verify at **1280px** and **375px** that the card never
  overflows the gutter.

## 8. A11y
- **Gaps (flag for rebuild):**
  - It is a plain `<div>`/`<form>`, **not** `role="dialog"` + `aria-modal`; no
    `aria-labelledby` pointing at the `<h2>`.
  - **No focus trap** and **Escape does not close** — only scrim click / Cancel
    do. (`autoFocus` lands on the new-client name input only when that block is
    shown.)
  - The `<label>`s wrap their controls (implicit association — OK), but the
    field "label" text has no `for`/`id` pairing if split.
  - Error uses `role="alert"` — **good** (announced on appearance).
  - Buttons are real `<button>`s; the green submit is the single solid primary,
    Cancel is a ghost — correct action-row hierarchy.

## 9. Used on
`/invoices` only — mounted by InvoicesPage when the hero's **New invoice** CTA
sets `newOpen=true`. Sole caller. Its create flow is the only place the
front-end calls `POST /invoices` / `dashboardClient.createInvoice`.
