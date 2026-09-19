# 3.3 ◩ NW-29 — When an invoice becomes paid, the customer gets the invoice marked PAID (M) · slug `nw-29-paid-invoice-email`

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 3.3) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

**Why.** `confirm-payment/mod.ts:78-131` emails a *receipt* PDF (only on the claim path, only if `customer.email`); `compute-invoice-balance/mod.ts:46-51` and
`invoice-controller` `PUT status` email nothing. `send-paperwork-email/mod.ts:31` knows `"quote" | "invoice"` only; its invoice template already localizes a status row
(`:1338-1346`, `email-format.ts:76-90` has "Paid"/"Pagado") but the money card says AMOUNT DUE (`:1351-1358`).

- [ ] RED — Deno int test: `send-paperwork-email/int.test.ts` (extend or create): `run(userId, { kind:"invoice", resourceId, variant:"paid" })` → the captured email subject contains "Paid" and the HTML contains "PAID" and not "AMOUNT DUE". Run → fails (no `variant`).
- [ ] RED — jest integration: `jest/integration/ux-payment-receipt.int.test.ts` add a case: seed → `POST /payments` full amount → the comms trail (that file already reads it — copy) has an `email` row whose content mentions the invoice id and "Paid"/"Pagado". Run → fails.
- [ ] EDIT `send-paperwork-email/mod.ts`: `SendPaperworkEmailInput` gains `variant?: "paid"`; when set, subject uses new key `paperworkEmail.invoicePaid.subject` ("Paid — invoice #{id} from {businessName}" / "Pagada — factura #{id} de {businessName}"),
      the money card label becomes `paperworkEmail.invoice.paidLabel` ("PAID {date}" / "PAGADA {date}"), and `RenderInvoicePdf` is called with `{ paid: true }` (add that flag: draw a "PAID" eyebrow where `render-invoice-pdf` draws the status).
- [ ] EDIT new coordinator `backend/src/paperwork/domain/coordinators/mark-invoice-paid/mod.ts`: `run(userId, invoiceId)` → `SendPaperworkEmail` paid variant (best-effort, logged via `LogPaperworkMessage`).
      Call it from `compute-invoice-balance/mod.ts:46-51` when `desiredStatus === "paid" && invoice.status !== "paid"`, and from `confirm-payment/mod.ts:78-81` after the flip (keep its receipt too). Register in `paperwork/mod-root.ts`.
- [ ] GREEN: Deno + jest; `ux-payment-receipt.int.test.ts` old cases still green. E2E `n/a — email content`.

## Phase context (verbatim from the plan, `Phase 3 — The contractor can say "payment received" (root cause #4) — closes NW-27, NW-31b, NW-32, NW-33; then NW-29, NW-31a, NW-31c`)

Backend facts to lean on: `POST /payments` (`payment-controller/mod.ts:22-30`) validates `{invoiceId, amount (cents), method, receivedAt, reference?}`
against nine methods (`dto/payment.ts:7-17`) and re-runs `ComputeInvoiceBalance` (`compute-invoice-balance/mod.ts:34-54`), which flips the invoice
to `paid` when the balance hits zero. The front-end client (`front-end/clients/payments.ts:35-41`) is read-only; `InvoicesPage.tsx` never posts a payment;
"Okay, I got it" (`doConfirmReceived`, `:1621-1634`) only works from a customer claim (`confirm-payment/mod.ts:59-62`). `/payments` (`PaymentsPage.tsx:269-277`)
just lists `GET /payments`, so it is empty until a Payment row exists.

## Source items from the triage (`new-working-issues.md`, client's words + verdict + evidence)

- When an invoice is paid it must also be emailed to the Unicorn with "Paid" on it so everyone is on the same page. [p28]
  - **NW-29 ◩ a *receipt* PDF is emailed on one of three paid paths; the invoice stamped "Paid" is never sent.** Effort M.
  - Evidence: `confirm-payment/mod.ts:78-81` flips paid; `:107-131` emails only if `customer.email`, subject
    `confirmPayment.email.subject` (`lang/en.json:768` "Receipt for invoice #{id}") with a **receipt** PDF (`render-receipt-pdf/mod.ts:22-33`,
    eyebrow "RECEIPT" `:2102`); `:149-190` SMS + comms log. `compute-invoice-balance/mod.ts:40-51` (from `POST/PUT/DELETE /payments`)
    and `invoice-controller:253-264` (`PUT` status) email **nothing**. `send-paperwork-email/mod.ts:31` `PaperworkKind = "quote"|"invoice"`
    — no paid variant; the invoice template's status row (`:1339-1348`, `shared/quote-flow/email-format.ts:76-83` "Paid"/"Pagado")
    exists but the money card still says AMOUNT DUE (`:1352-1360`) and nothing calls it on the paid transition.
  - Fix: a `paid` branch in `SendPaperworkEmail` (or `RenderInvoicePdf({paid:true})`) called from a shared `MarkInvoicePaid`
    coordinator that both `ConfirmPayment` and `ComputeInvoiceBalance` use. Tests: `jest/integration/ux-payment-receipt.int.test.ts:69-140` (receipt only).

## Code at the cited lines (read from this tree while packaging)

### `backend/src/paperwork/domain/coordinators/confirm-payment/mod.ts:78-131`

```
78:     const updated = await this.invoices.update(invoice.id, userId, {
79:       status: "paid",
80:       paidAt,
81:     });
82: 
83:     // 3. Best-effort receipt dispatch.
84:     try {
85:       const [customer, contractor, biz] = await Promise.all([
86:         invoice.customerId
87:           ? this.customers.getOwned(invoice.customerId, userId).catch(() =>
88:             undefined
89:           )
90:           : Promise.resolve(undefined),
91:         this.users.get(userId).catch(() => undefined),
92:         this.identity.get(userId).catch(() => null),
93:       ]);
94:       const businessName = biz?.businessName?.trim() ||
95:         biz?.legalName?.trim() || contractor?.name?.trim();
96:       const lang: Lang = biz?.commsLanguage === "es" ? "es" : "en";
97:       const pdfBytes = await this.receiptPdf.run({
98:         invoice: updated,
99:         customer,
100:         contractor,
101:         ...(businessName ? { businessName } : {}),
102:         method: intent.method,
103:         ...(intent.reference ? { reference: intent.reference } : {}),
104:         confirmedAt: paidAt,
105:       });
106: 
107:       if (customer?.email) {
108:         const subject = t(lang, "confirmPayment.email.subject", {
109:           id: invoice.id.slice(0, 8).toUpperCase(),
110:         });
111:         const htmlBody = renderReceiptHtml({
112:           customer,
113:           contractor,
114:           businessName,
115:           intent,
116:           amount: intent.amount,
117:           lang,
118:         });
119:         await this.email.send({
120:           to: customer.email,
121:           subject,
122:           htmlBody,
123:           ...(contractor?.email ? { cc: [contractor.email] } : {}),
124:           attachments: [{
125:             name: t(lang, "confirmPayment.email.attachmentName", {
126:               id: invoice.id.slice(0, 8).toUpperCase(),
127:             }),
128:             content: pdfBytes,
129:             contentType: "application/pdf",
130:           }],
131:         });
```

### `backend/src/paperwork/domain/coordinators/compute-invoice-balance/mod.ts:46-51`

```
46:     if (statusChanged || paidAtChanged) {
47:       await this.invoices.update(invoiceId, userId, {
48:         status: desiredStatus,
49:         paidAt: desiredPaidAt,
50:       });
51:     }
```

### `backend/src/paperwork/domain/coordinators/send-paperwork-email/mod.ts:28-34`

```
28: import type { Customer } from "@crm/dto/customer.ts";
29: import type { User } from "@users/dto/user.ts";
30: 
31: export type PaperworkKind = "quote" | "invoice";
32: 
33: export interface SendPaperworkEmailInput {
34:   kind: PaperworkKind;
```

### `shared/quote-flow/email-format.ts:76-90`

```
76: const STATUS_LABELS: Record<string, Record<string, string>> = {
77:   en: {
78:     accepted: "Accepted",
79:     declined: "Declined",
80:     draft: "Draft",
81:     overdue: "Overdue",
82:     paid: "Paid",
83:     sent: "Sent",
84:     signed: "Signed",
85:     viewed: "Viewed",
86:   },
87:   es: {
88:     accepted: "Aceptada",
89:     declined: "Rechazada",
90:     draft: "Borrador",
```

### `backend/src/paperwork/domain/coordinators/confirm-payment/mod.ts:78-81`

```
78:     const updated = await this.invoices.update(invoice.id, userId, {
79:       status: "paid",
80:       paidAt,
81:     });
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
