# 3.2 ◩ NW-33 — "Record a payment" and "Export" on /payments do real things (S) · slug `nw-33-payments-hero-actions`

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 3.2) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

**Why.** `PaymentsPage.tsx:558-575` links both buttons to `/assistant?seed=…`, which only pre-fills the composer (`AsstChat.tsx:1298-1306`). `GET /invoices/export.csv?year=` exists (`invoice-controller/mod.ts:313-320`, year only).

- [ ] RED — e2e: new `cypress/e2e/payments-record.cy.ts`: seed a sent invoice, `cy.visit("/payments")`, click `[data-cy=payments-record]`, pick the invoice in `[data-cy=payments-record-invoice]`,
      chip `[data-cy=pay-method-cash]`, submit → the table shows a Cash row. Also `cy.get("[data-cy=payments-export]").should("have.attr","href").and("match", /\/api\/invoices\/export\.csv\?year=\d{4}&month=\d{1,2}/)`. Run → fails.
- [ ] RED — jest integration: `POST /invoices` two invoices with `issuedDate` in different months → `GET /invoices/export.csv?year=YYYY&month=MM` contains only the matching one. Run → fails (no month filter).
- [ ] EDIT `invoice-controller/mod.ts:313-320`: add `@Query("month") monthQ?: string` and filter rows whose `issuedDate` (fallback `createdAt`) month matches when given.
- [ ] EDIT `PaymentsPage.tsx:558-575`: "Record a payment" → `<button data-cy="payments-record">` opening a modal = invoice `<select data-cy="payments-record-invoice">` of unpaid invoices (from `dashboardClient.invoices()`) + `<PaymentReceivedForm>`; on save refetch the list.
      "Export this month" → `<a data-cy="payments-export" href={`/api/invoices/export.csv?year=${y}&month=${m}`} download>`. Delete `paymentsPage.hero.recordSeed`/`exportSeed` keys from both dicts.
- [ ] Done when: both buttons work without leaving `/payments`.

## Phase context (verbatim from the plan, `Phase 3 — The contractor can say "payment received" (root cause #4) — closes NW-27, NW-31b, NW-32, NW-33; then NW-29, NW-31a, NW-31c`)

Backend facts to lean on: `POST /payments` (`payment-controller/mod.ts:22-30`) validates `{invoiceId, amount (cents), method, receivedAt, reference?}`
against nine methods (`dto/payment.ts:7-17`) and re-runs `ComputeInvoiceBalance` (`compute-invoice-balance/mod.ts:34-54`), which flips the invoice
to `paid` when the balance hits zero. The front-end client (`front-end/clients/payments.ts:35-41`) is read-only; `InvoicesPage.tsx` never posts a payment;
"Okay, I got it" (`doConfirmReceived`, `:1621-1634`) only works from a customer claim (`confirm-payment/mod.ts:59-62`). `/payments` (`PaymentsPage.tsx:269-277`)
just lists `GET /payments`, so it is empty until a Payment row exists.

## Source items from the triage (`new-working-issues.md`, client's words + verdict + evidence)

- "Record a payment" takes you to the quote/invoice chat. What is that button for? [p29]
  - **NW-33 ◩ answered: it is a dead-end placeholder — it pre-fills the chat composer and stops.** Effort M.
  - Evidence: `PaymentsPage.tsx:557-576` `href="/assistant?seed=<paymentsPage.hero.recordSeed>"` (`lang/en.json:1640-1641` "Record a
    payment" / "Record a payment I just received."); `AsstChat.tsx:1295-1304` reads `?seed=` into `setDraft()` and never sends; the
    assistant has no payment intent (`handle-chat-message/mod.ts` mentions payment only for onboarding handles `:192,534-566`;
    `shared/quote-flow/intent-parsers.ts` exports only skip/confirm). Sibling "Export this month" (`:567-575`) is the same pattern
    although `GET /invoices/export.csv` exists (`invoice-controller:313`).
  - Fix: in-page Record-payment modal (invoice picker + amount + method chips + date) → `POST /payments`; point Export at the CSV endpoint.

## Code at the cited lines (read from this tree while packaging)

### `front-end/islands/PaymentsPage.tsx:558-575`

```
558:           <a
559:             class="pph__cta"
560:             href={`/assistant?seed=${
561:               encodeURIComponent(tFor(lang, "paymentsPage.hero.recordSeed"))
562:             }`}
563:           >
564:             <I d={ICN.plus} size={14} sw={2.5} />{" "}
565:             {tFor(lang, "paymentsPage.hero.recordCta")}
566:           </a>
567:           <a
568:             class="pph__ghost"
569:             href={`/assistant?seed=${
570:               encodeURIComponent(tFor(lang, "paymentsPage.hero.exportSeed"))
571:             }`}
572:           >
573:             <I d={ICN.arrow} size={13} sw={2.5} />{" "}
574:             {tFor(lang, "paymentsPage.hero.exportCta")}
575:           </a>
```

### `front-end/islands/AsstChat.tsx:1298-1306`

```
1298:   useEffect(() => {
1299:     if (typeof globalThis.window === "undefined") return;
1300:     const url = new URL(globalThis.location.href);
1301:     const seed = url.searchParams.get("seed");
1302:     if (!seed) return;
1303:     setDraft(seed);
1304:     url.searchParams.delete("seed");
1305:     globalThis.history.replaceState({}, "", url.toString());
1306:     // Focus on next paint so the composer expands and the user can edit/send.
```

### `backend/src/paperwork/entrypoints/invoice-controller/mod.ts:313-320`

```
313:   @Get("export.csv")
314:   async exportCsv(
315:     @Context() ctx: ExecutionContext,
316:     @Query("year") yearQ?: string,
317:   ) {
318:     const user = await requireUser(ctx, this.sessions, this.users);
319:     const year = yearQ ? Number(yearQ) : new Date().getUTCFullYear();
320:     const all = await this.store.listByUser(user.id);
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
