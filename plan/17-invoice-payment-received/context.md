# 3.1 ⬜ NW-27 + NW-32 — "Payment received" on Out-for-payment / Overdue / Awaiting (M) · slug `nw-27-payment-received`

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 3.1) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

- [ ] RED — jest integration: new `jest/integration/payment-received.int.test.ts`: `contractor("+15125550961")`, `seedInvoice(s, { amount: 50000, status: "sent", issuedDate: today })`,
      `POST /payments { invoiceId, amount: 50000, method: "zelle", receivedAt: now }` → `< 400`; `GET /invoices/:id` → `status "paid"`, `paidAt` set;
      `GET /payments?invoiceId=<id>` → one row with `method "zelle"`. **This will pass on arrival** (backend is built) — keep it as the contract pin and say so in the commit.
      Add a second case: partial `amount: 20000` → invoice status is NOT `paid` and `GET /payments` shows the row.
- [ ] RED — e2e: `cypress/e2e/invoice-detail-panel.cy.ts` add `describe("REQ-NNN NW-27 payment received")`: seed a `sent` invoice via `cy.apiCreateInvoice`, `cy.visit("/invoices")`,
      open its card (the spec shows how), click `[data-cy=invoice-payment-received]`, click `[data-cy=pay-method-zelle]`, leave the amount (prefilled), click `[data-cy=pay-received-submit]`;
      after reload the card is in the Paid track (`[data-cy=invoice-back-cta-paid]` exists) and `cy.visit("/payments")` lists a row containing "Zelle". Run → fails.
      **Watch `:94`** ("exactly ONE solid/primary button in the action row") — style the new button with `secondaryBtn`.
- [ ] EDIT `front-end/clients/payments.ts`: add `create: (body: { invoiceId: string; amount: number; method: PaymentMethod; receivedAt: string; reference?: string }, opts: ApiOptions = {}) => api.post<Payment>("/payments", body, opts)`.
- [ ] EDIT new component `front-end/components/PaymentReceivedForm.tsx` (props: `invoice`, `lang`, `onSaved`, `onCancel`): method chips for all nine `PAYMENT_METHODS`
      (copy the chip markup from `PublicInvoiceClaim.tsx:148-167`, labels from `InvoicesPage.tsx:74 methodLabel`), amount `MoneyInput` prefilled with `invoice.amount`,
      date input default today, optional reference, submit → `paymentsClient.create(...)`. `data-cy`: `pay-method-<method>`, `pay-received-amount`, `pay-received-date`, `pay-received-submit`.
- [ ] EDIT `InvoicesPage.tsx`:
  - [ ] detail panel action row `:1155-1180`: add `<button data-cy="invoice-payment-received" style={secondaryBtn} onClick={() => switchMode("pay")}>` for stages `out | overdue | claimed`;
        `mode === "pay"` renders `<PaymentReceivedForm … onSaved={() => { onChanged(); onClose(); }} />`.
  - [ ] card-back `:2299-2314` (out/overdue): add the same button before Mute (it opens the detail panel in `pay` mode — reuse whatever opens the panel today).
  - [ ] front CTA map `:1576-1586`: for `out` change the CTA text key to `invoicesPage.cta.outReceived` ("Payment received →") and route `ctaAction` (`:1726-1732`) for `out` to open pay mode; "View invoice" stays on the card back.
- [ ] EDIT lang (both dicts): `invoicesPage.detail.paymentReceivedBtn` "Payment received" / "Pago recibido"; `invoicesPage.cta.outReceived`; `invoicesPage.pay.title` "How did they pay?" / "¿Cómo pagaron?";
      `.amountLabel`, `.dateLabel`, `.referenceLabel`, `.submit` ("Record payment" / "Registrar pago").
- [ ] `confirm-payment/mod.ts:59-62` is left alone: the claimed path keeps "Okay, I got it" (mints from the intent); the new button is the alternative when the customer never clicked "I sent it".
- [ ] GREEN: both tests; `cd cypress && npx cypress run --spec 'e2e/invoice-*.cy.ts'` green (P-31/P-41 untouched).
- [ ] Done when: an "Out for payment" invoice can be marked paid with a method, lands in the Paid track, and appears on `/payments` — NW-32 closes with no extra work.

## Phase context (verbatim from the plan, `Phase 3 — The contractor can say "payment received" (root cause #4) — closes NW-27, NW-31b, NW-32, NW-33; then NW-29, NW-31a, NW-31c`)

Backend facts to lean on: `POST /payments` (`payment-controller/mod.ts:22-30`) validates `{invoiceId, amount (cents), method, receivedAt, reference?}`
against nine methods (`dto/payment.ts:7-17`) and re-runs `ComputeInvoiceBalance` (`compute-invoice-balance/mod.ts:34-54`), which flips the invoice
to `paid` when the balance hits zero. The front-end client (`front-end/clients/payments.ts:35-41`) is read-only; `InvoicesPage.tsx` never posts a payment;
"Okay, I got it" (`doConfirmReceived`, `:1621-1634`) only works from a customer claim (`confirm-payment/mod.ts:59-62`). `/payments` (`PaymentsPage.tsx:269-277`)
just lists `GET /payments`, so it is empty until a Payment row exists.

## Source items from the triage (`new-working-issues.md`, client's words + verdict + evidence)

- How do you mark an invoice paid? We are not taking payments, so the client has to tell us payment has been received. (Screenshot: the "Out for payment" invoice detail only offers Discount, Change order, View invoice, Open, Mute.) [p18]
  - **NW-27 ◩ answered: today only *after the customer clicks "I sent it"* on `/i/:id`. No contractor-initiated path.** Effort M.
  - Evidence: stage derived `InvoicesPage.tsx:192-204` (paid > claimed > scheduled > drafting > overdue > out); `out` action row
    `:2278-2318` = View invoice / Open / Mute, detail panel `:1156-1180` = Edit / Discount / Change order — exactly the screenshot.
    `confirm-payment/mod.ts:59-62` hard-requires `invoice.paymentIntent` (409 `no_payment_intent` for `out`). `POST /payments`
    exists (`payment-controller/mod.ts:22-30`) but `front-end/clients/payments.ts:35-41` is read-only; `/invoices/record-payment/voice|photo`
    (`invoice-controller:378-410`) have zero FE callers. Customer path: `PublicInvoiceClaim.tsx:33-34,91-99` "I sent it" → `claimed`.
  - Fix: "Payment received" on `out`/`overdue` → method picker (reuse `PublicInvoiceClaim.tsx:142-232` chips, `PaymentMethod` union
    `clients/payments.ts:12-21`) → `POST /payments` (add `create` to the client); relax `ConfirmPayment` to accept an explicit
    `{amount, method, reference?}` without an intent so the receipt path fires. Root cause #4 — same fix as NW-32/34/35.

- If the Dragon marks an invoice as paid it should show up here. This is how payments are recorded. [p29]
  - **NW-32 ⬜ the plumbing works; the tab is empty only because no Dragon-side mark-paid action exists.** Effort M (shares NW-27).
  - Evidence: `PaymentsPage.tsx:271-277` lists `GET /payments` rows only (`payment-controller/mod.ts:32-42`); a Payment row is
    minted on confirm (`confirm-payment:65-71`) and `POST /payments` auto-flips the invoice via `ComputeInvoiceBalance` (`:41-51`).
    A raw `PUT status:"paid"` creates no row (the UI never does it — `InvoicesPage.tsx:1710` only sets `sent`). The empty-state
    copy already promises it (`lang/en.json:1690` "…once a customer pays an invoice it lands here automatically").
  - Fix: NW-27's "Payment received" → `POST /payments`; nothing else needed. Tests: none (`ux-money-pages-polish.cy.ts:108-126` hero only).

## Code at the cited lines (read from this tree while packaging)

### `front-end/islands/PublicInvoiceClaim.tsx:148-167`

```
148:       <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px">
149:         {acceptedMethods.map((m) => {
150:           const active = m.method === selected;
151:           return (
152:             <button
153:               type="button"
154:               key={m.method}
155:               data-cy={`claim-method-${m.method}`}
156:               onClick={() => setSelected(m.method)}
157:               style={`appearance:none;cursor:pointer;background:${
158:                 active ? PINK : "#fff"
159:               };color:${active ? "#fff" : INK};border:1px solid ${
160:                 active ? PINK_DARK : LINE
161:               };border-radius:999px;padding:9px 16px;font-size:13.5px;font-weight:700;letter-spacing:.01em`}
162:             >
163:               {methodLabel(m.method, lang)}
164:             </button>
165:           );
166:         })}
167:       </div>
```

### `backend/src/paperwork/domain/coordinators/confirm-payment/mod.ts:59-62`

```
59:     const intent = invoice.paymentIntent;
60:     if (!intent) {
61:       return { ok: false, reason: "no_payment_intent" };
62:     }
```

### `backend/src/paperwork/entrypoints/payment-controller/mod.ts:22-30`

```
22:   @Post()
23:   async create(@Context() ctx: ExecutionContext, @Body() body: unknown) {
24:     const user = await requireUser(ctx, this.sessions, this.users);
25:     const dto = parseCreatePayment(body);
26:     await this.invoices.getOwned(dto.invoiceId, user.id);
27:     const created = await this.store.create(user.id, dto);
28:     await this.balances.run(dto.invoiceId, user.id);
29:     return created;
30:   }
```

### `backend/src/paperwork/dto/payment.ts:7-17`

```
7: export const PAYMENT_METHODS = [
8:   "cash",
9:   "check",
10:   "ach",
11:   "card",
12:   "venmo",
13:   "zelle",
14:   "cashapp",
15:   "paypal",
16:   "other",
17: ] as const;
```

### `backend/src/paperwork/domain/coordinators/compute-invoice-balance/mod.ts:34-54`

```
34:   async run(invoiceId: string, userId: string): Promise<InvoiceBalanceResult> {
35:     const invoice = await this.invoices.getOwned(invoiceId, userId);
36:     const payments = await this.payments.listByInvoice(invoiceId, userId);
37:     const paidTotal = payments.reduce((sum, p) => sum + (p.amount ?? 0), 0);
38:     const amount = invoice.amount ?? 0;
39:     const balance = balanceDue(invoice, paidTotal);
40:     const closed = balance <= 0 && amount > 0;
41:     const desiredStatus = closed ? "paid" : "pending";
42:     const desiredPaidAt = closed ? latestReceivedAt(payments) : undefined;
43: 
44:     const statusChanged = invoice.status !== desiredStatus;
45:     const paidAtChanged = (invoice.paidAt ?? undefined) !== desiredPaidAt;
46:     if (statusChanged || paidAtChanged) {
47:       await this.invoices.update(invoiceId, userId, {
48:         status: desiredStatus,
49:         paidAt: desiredPaidAt,
50:       });
51:     }
52: 
53:     return { invoiceId, amount, paidTotal, balance, status: desiredStatus };
54:   }
```

### `front-end/clients/payments.ts:35-41`

```
35: export const paymentsClient = {
36:   list: (opts: ApiOptions = {}) => api.get<Payment[]>("/payments", opts),
37:   byMethod: (method: PaymentMethod, opts: ApiOptions = {}) =>
38:     api.get<Payment[]>("/payments", { ...opts, query: { method } }),
39:   byInvoice: (invoiceId: string, opts: ApiOptions = {}) =>
40:     api.get<Payment[]>("/payments", { ...opts, query: { invoiceId } }),
41: };
```

### `front-end/islands/PaymentsPage.tsx:269-277`

```
269:   useEffect(() => {
270:     let alive = true;
271:     Promise.all([
272:       paymentsClient.list().catch(() => [] as Payment[]),
273:       dashboardClient.invoices(undefined).catch(() => [] as Invoice[]),
274:       dashboardClient.customers().catch(() => [] as Customer[]),
275:     ]).then(([payments, invoices, customers]) => {
276:       if (!alive) return;
277:       setS({ loading: false, error: null, payments, invoices, customers });
```
