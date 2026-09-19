# 3.5 ◩ NW-31c — Upcoming invoices: pick a send date; nudge the Dragon when it is due (M) · slug `nw-31c-schedule-send`

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 3.5) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

**Why.** `scheduledFor` is read-only in the FE (sort `:389`, subline `:1606`); `NewInvoiceModal` has `dueDate` (`:2345-2349`) but no `scheduledFor`; the backend accepts it (`CreateInvoiceDto:127`);
`POST /cron/run-nudges` (`cron-controller:46-51`) would ping the contractor but nothing calls it.

- [ ] RED — jest integration: `POST /invoices { …, scheduledFor: <tomorrow>, status: "scheduled" }` → `POST /cron/run-nudges` → `count >= 1`. Run → likely passes (backend built) — pin it. Then `PUT /invoices/:id { scheduledFor: <+10d> }` → `GET` reflects it.
- [ ] RED — e2e: `NewInvoiceModal` has `[data-cy=invoice-schedule-date]`; creating with it puts the card in the Upcoming track with "Scheduled to send <date>"; the Upcoming card back has `[data-cy=invoice-change-date]` that PUTs a new date. Run → fails.
- [ ] EDIT `NewInvoiceModal` (`InvoicesPage.tsx:2338+`): add "Send on" date input → body `{ scheduledFor, status: "scheduled" }` when set.
- [ ] EDIT Upcoming card back: "Change date" → inline date input → `PUT /invoices/:id { scheduledFor }` → refresh.
- [ ] EDIT `InvoicesPage.tsx` mount effect: fire-and-forget `fetch("/api/cron/run-nudges", { method: "POST" })` once per page load (idempotent server-side) so a due scheduled invoice produces the "approve that the job is done and send the final invoice" nudge in the assistant. (A real scheduler is a deploy decision — note it under §8.)
- [ ] Done when: an invoice can be created "to send on <date>", the date can be changed, and visiting `/invoices` on/after that date produces the nudge.

---

## Phase context (verbatim from the plan, `Phase 3 — The contractor can say "payment received" (root cause #4) — closes NW-27, NW-31b, NW-32, NW-33; then NW-29, NW-31a, NW-31c`)

Backend facts to lean on: `POST /payments` (`payment-controller/mod.ts:22-30`) validates `{invoiceId, amount (cents), method, receivedAt, reference?}`
against nine methods (`dto/payment.ts:7-17`) and re-runs `ComputeInvoiceBalance` (`compute-invoice-balance/mod.ts:34-54`), which flips the invoice
to `paid` when the balance hits zero. The front-end client (`front-end/clients/payments.ts:35-41`) is read-only; `InvoicesPage.tsx` never posts a payment;
"Okay, I got it" (`doConfirmReceived`, `:1621-1634`) only works from a customer claim (`confirm-payment/mod.ts:59-62`). `/payments` (`PaymentsPage.tsx:269-277`)
just lists `GET /payments`, so it is empty until a Payment row exists.

## Source items from the triage (`new-working-issues.md`, client's words + verdict + evidence)

- Double-check every invoice stage and what you can do in it: [p28]
  - **Awaiting confirmation** — has an "Ok I got it" button, but also needs a nudge button, because "Ok I got it" marks it as paid.
  - **Out for payment** — has no way to say payment received. Needs a "payment received" option, then you pick how it was paid from the payment options.
  - **Upcoming** — needs a "send it later" button with a date picker (if there is no start date, how do they know when to send the invoice?). Or a reminder text and email to the Dragon to approve that the job is done and send the final invoice.
  - **NW-31 ◩ confirmed: "Ok I got it" mints a Payment and sets paid (`confirm-payment/mod.ts:65-81`); nudge is mislabeled/miswired; payment-received and schedule-send are not built.** Effort L.
  - Nudge: backend has the whole cadence — `SendPaymentReminder`, `ScheduleInvoiceNudges`, `reminderHistory` day 3/7/14/30,
    `cron-controller/mod.ts:37-64` (`POST /cron/run-reminders`, `/cron/run-nudges`, `/cron/invoice-reminder` whose doc-comment `:53-54`
    says it "backs the 'Send nudge' button on the overdue card") — **zero front-end callers of `/cron/*`**; "Send nudge" actually
    re-texts the full invoice (`paperwork-email-controller/mod.ts:163`). On *Awaiting confirmation* the only nudge-ish control is
    "Text client" on the flipped card back.
  - Payment received w/ method: root cause #4 (NW-27). Backend `dto/payment.ts:7-18` has 9 methods; UI chips exist only customer-side.
  - Send later: `scheduledFor` is read-only in the FE (sort key `:389`, subline `:1606` "Scheduled to send {date}"); `NewInvoiceModal`
    has `dueDate` (`:2345-2349`) but no `scheduledFor`; backend accepts it (`send-signed-confirmation/mod.ts:180-181` sets it for
    milestones) and `/cron/run-nudges` would ping the Dragon — never called from the app.
  - Fix: (a) claimed → split into "Send a nudge" (`POST /cron/invoice-reminder`) + "Okay, I got it"; (b) out/overdue → "Payment
    received" → method → `POST /payments`; (c) `scheduledFor` date input on Upcoming + `NewInvoiceModal`, wire `/cron/run-nudges`.
  - Tests: `cypress/e2e/invoice-detail-panel.cy.ts`, `invoice-adjustments.cy.ts`, `jest/integration/invoice-integrity.int.test.ts`
    (discount/CO); `ux-payment-receipt.int.test.ts` (claim → confirm). Nothing pins nudge, payment-received or schedule-send.

## Code at the cited lines (read from this tree while packaging)

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

### `backend/src/paperwork/domain/coordinators/confirm-payment/mod.ts:59-62`

```
59:     const intent = invoice.paymentIntent;
60:     if (!intent) {
61:       return { ok: false, reason: "no_payment_intent" };
62:     }
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
