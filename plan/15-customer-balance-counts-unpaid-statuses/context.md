# 1.15 🐛 NW-14 side-find — Customer balance counts every unpaid invoice status (S) · slug `customer-balance-unpaid-statuses`

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 1.15) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

**Why.** `backend/src/analytics/domain/coordinators/build-customer-cards/mod.ts:113` adds to `balanceCents` only when `status === "pending"`,
but invoices live in `scheduled|draft|sent|viewed|claimed|paid|void` (`dto/invoice.ts:16-23`). A `sent` invoice shows "$0 owed" on `/customers`.

- [ ] RED — Deno int test: `build-customer-cards/int.test.ts` add a case: one `sent` invoice of `50000` → card `balanceCents === 50000`; one `viewed` → same; `void` → 0; `paid` → 0. Run → fails.
- [ ] EDIT `:113`: `const OWED = new Set(["pending","sent","viewed","claimed"]); if (OWED.has(i.status ?? "")) balanceCents += cents;` (keep the credit/deposit branch).
- [ ] GREEN: `cd backend && deno test -A --unstable-kv src/analytics/` green. Jest/e2e `n/a — backend aggregation`.

---

## Source items from the triage (`new-working-issues.md`, client's words + verdict + evidence)

- If you select the invoice of an existing client, the next page must show what they paid, what they owe, the terms, etc. Drafting a brand-new invoice that is not from a quote can keep the current screen, but selecting an existing quote must go down that path. [p10]
  - **NW-14 ◩ FE not built; backend partially exposes it.** Effort M + S.
  - Evidence: no picker — three chips at `AsstChat.tsx:3298-3313` whose `.map` **drops `id` and `customerId`** (label
    `acceptedJobChipLabel`, `shared/quote-flow/quick-quote-prefill.ts:122-136`). After selection (`:4377-4393`) → price capture with
    a recap only (`:4769-4780`). Backend: `ComputeInvoiceBalance {amount, paidTotal, balance}` (`compute-invoice-balance/mod.ts:36-58`)
    is only a side effect of `payment-controller` (`:28,53,63`) — no read endpoint; `GET /payments?invoiceId=` (`:32-41`) exists;
    public payload has `siblings[]`/`agreementTotal`/`terms` (`public-controller:675-720`) only with `quoteId`. 🐛 Side-find:
    `build-customer-cards/mod.ts:107-118` `balanceCents` counts only `status === "pending"`, but the lifecycle is
    `scheduled|draft|sent|viewed|claimed|paid|void` (`backend/src/paperwork/dto/invoice.ts:16-23`) → a `sent` invoice shows $0 owed on `/customers`.
  - Fix: carry `{id, customerId}` on the chips; on pick, show a quote-summary card from `GET /quotes/:id` + a new
    `GET /invoices?quoteId=` (reuse `billedTotalCents` from `shared/quote-flow/milestone-reconcile.ts`).

## Code at the cited lines (read from this tree while packaging)

### `backend/src/analytics/domain/coordinators/build-customer-cards/mod.ts:110-116`

```
110:   for (const i of myInvoices) {
111:     // Audit1 #3 — invoice.amount is INTEGER CENTS now (no × 100).
112:     const cents = i.amount ?? 0;
113:     if (i.status === "pending") balanceCents += cents;
114:     else if (i.status === "credit" || i.status === "deposit") {
115:       balanceCents -= cents;
116:     }
```

### `backend/src/paperwork/dto/invoice.ts:16-23`

```
16:   | "scheduled" // Auto-created by milestones; not yet fired to customer.
17:   | "draft" // Contractor is editing; not sent.
18:   | "sent" // Delivered to customer; awaiting view/payment.
19:   | "viewed" // Customer opened the public link.
20:   | "claimed" // Customer recorded "I paid by X"; awaiting contractor confirm.
21:   | "paid" // Contractor confirmed receipt.
22:   | "void"; // Cancelled.
23: 
```

### `backend/src/paperwork/dto/invoice.ts:110-116`

```
110:   amount?: number;
111:   /** Cumulative discount applied, INTEGER CENTS — shown as a line on the
112:    *  public invoice (roadmap p.12). `amount` is the net total due. */
113:   @IsOptional() @IsNumber()
114:   discountCents?: number;
115:   @IsOptional() @IsString()
116:   discountReason?: string;
```
