# 7.1 ◩ NW-22 + NW-35 — Create a customer straight from the assistant dropdown; never a silently disabled Next (S–M) · slug `nw-22-35-customer-create-from-dropdown`

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 7.1) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

**Why.** The dropdown's text field is a **filter** (`AsstChat.tsx:7957-7964`); no match renders `common.noMatches` with nothing to click (`:7976-7981`); the real create is the separate "+ New customer" button (`:8012-8019`).
Next is disabled with no message when the form is empty or has no phone/email (`:7760-7776`), while the Customers page allows name-only (`ClientsPage.tsx:233-239`). The server-side "own contact" throw (`handle-wizard-answer/mod.ts:263-272`) is a raw English string.

- [ ] RED e2e (`cypress/e2e/ux-assistant-pick-customer.cy.ts`): type "Incredible Hulk" in the dropdown search with no match → `[data-cy=cust-create-from-search]` visible → click → the create form opens with the name prefilled → fill phone → Next → the customer exists on `/customers` (`cy.request("/api/clients")` contains "Incredible Hulk"). Second case: name only, no contact → `[data-cy=cust-contact-hint]` visible with the `needContact` copy (not just a disabled button).
- [ ] RED Deno int (`handle-wizard-answer/int.test.ts`): own-contact create → error is a lang key value (`customerStep.ownContact`), not the raw string.
- [ ] EDIT `:7976-7981`: render `<button data-cy="cust-create-from-search" onClick={() => { openCreate(); setCreateName(search); }}>{tFor(lang,"asstChat.customerStep.createNamed",{name:search})}</button>` ("Create \"{name}\"" / "Crear \"{name}\"").
- [ ] EDIT `:7768-7774`: show `contactErr` (`data-cy="cust-contact-hint"`) whenever `!hasContact`, even with an empty name; keep the disable.
- [ ] EDIT `handle-wizard-answer/mod.ts:269-271`: throw `new Error(t(lang, "customerStep.ownContact"))` with the key in both dicts.

## Phase context (verbatim from the plan, `Phase 7 — Remaining medium items (no decision needed; any order; after Phases 1–5 if time is short)`)



## Source items from the triage (`new-working-issues.md`, client's words + verdict + evidence)

- I created a new customer ("Incredible Hulk", business "Green Machine") and it did not save. [p15]
  - **NW-22 ⚠ not reproducible from code — the create path is real and persists `businessName`; two UI mechanisms explain the report.** Effort M.
  - Evidence: quote wizard form `:7826-7851` → `submitCustomerStep` `:3073-3093` → `POST /agents/wizard/answer` →
    `handle-wizard-answer/mod.ts:238-291` `customers.create({name, email?, phoneNumber?, isBusiness?, businessName?})`
    (`customer-store/mod.ts:35-45`); invoice flow `:3359-3370` → `POST /customers`. `/customers` lists every row
    (`build-customer-cards/mod.ts:55-70`); `ClientsBoard.tsx:127,150-151` renders `businessName`.
    Mechanism 1: the dropdown's text input is a **search filter** (`:7955-7974`); no-match renders `common.noMatches`
    (`:7978-7983`) with no create affordance — the real create is the separate "+ New customer" button (`:8009-8018`,
    `lang/en.json:195`). Mechanism 2: Next is silently disabled without a phone or email — `:7760` `hasContact`, `:7775-7776`
    `submitDisabled = … || !hasContact || emailIsOwn || phoneIsOwn` (hint `asstChat.customerStep.needContact` `:194`), whereas
    `ClientsPage.tsx:235` allows name-only. Also `handle-wizard-answer:254-272` throws if the contact equals the contractor's own.
  - Fix: add a `Create "<search>"` row in the no-match state (`:7978-7983` → `openCreate()` + `setCreateName(search)`); replace
    the silent disable with a visible error, or align the gate with the Customers page.
  - Tests: `jest/integration/customer-pick.int.test.ts:36-50`, `jest/unit/customer-step.test.ts`, `cypress/e2e/ux-assistant-pick-customer.cy.ts:74-88`
    all pin `pick_existing`; none pins "created in the assistant → appears on /customers" or the no-contact case.

- You can create customers from the Customers page but not from My Assistant, yet the new-customer input shows up in the My Assistant dropdown. [p30]
  - **NW-35 ◩ both paths persist to the same `CustomerStore`; the "input in the dropdown" is a search box, not a create.** Effort S–M (same fix as NW-22).
  - Evidence: Customers page `ClientsPage.tsx:73-78` → `POST /customers` (`customer-controller/mod.ts:20-24`); assistant
    `+ New customer` (`AsstChat.tsx:8012-8019`) → `handle-wizard-answer/mod.ts:274-291` `customers.create(...)`; invoice flow
    `:3360-3370` → `POST /customers`. Dropdown input `:7955-7974` only filters; the contact gate `:7775-7776` silently disables Next.
  - Fix: `Create "<search>"` row in the no-match state; visible error instead of a disabled button. Tests: none pin `create_new` → `/customers`.

## Code at the cited lines (read from this tree while packaging)

### `front-end/islands/AsstChat.tsx:7957-7964`

```
7957:                     <input
7958:                       type="text"
7959:                       class="cust-pick__search"
7960:                       placeholder={(customers?.length ?? 0) > 5
7961:                         ? tFor(lang, "asstChat.searchNCustomers", {
7962:                           n: customers?.length ?? 0,
7963:                         })
7964:                         : tFor(lang, "common.searchCustomers")}
```

### `front-end/islands/AsstChat.tsx:7976-7981`

```
7976:                     {filtered.length === 0
7977:                       ? (
7978:                         <div class="cust-pick__empty">
7979:                           {tFor(lang, "common.noMatches")}
7980:                         </div>
7981:                       )
```

### `front-end/islands/AsstChat.tsx:8012-8019`

```
8012:         <button
8013:           type="button"
8014:           class="wiz-opt wiz-opt--custom"
8015:           onClick={openCreate}
8016:           disabled={sending}
8017:         >
8018:           {tFor(lang, "asstChat.customerStep.newCustomer")}
8019:         </button>
```

### `front-end/islands/ClientsPage.tsx:233-239`

```
233:               <button
234:                 type="submit"
235:                 disabled={adding || !addName.trim()}
236:                 style="padding:10px 20px;border:0;border-radius:10px;background:var(--brand-green,#519843);color:#fff;font:inherit;font-weight:800;cursor:pointer;opacity:1"
237:               >
238:                 {adding ? "…" : tFor(lang, "common.add")}
239:               </button>
```

### `backend/src/agents/domain/coordinators/handle-wizard-answer/mod.ts:263-272`

```
263:         if (
264:           (email && creator?.email &&
265:             normEmail(email) === normEmail(creator.email)) ||
266:           (phone && creator?.phoneNumber &&
267:             normPhone(phone) === normPhone(creator.phoneNumber))
268:         ) {
269:           throw new Error(
270:             "customer contact must not match the contractor's own email or phone number",
271:           );
272:         }
```

### `backend/src/agents/domain/coordinators/handle-wizard-answer/mod.ts:269-271`

```
269:           throw new Error(
270:             "customer contact must not match the contractor's own email or phone number",
271:           );
```
