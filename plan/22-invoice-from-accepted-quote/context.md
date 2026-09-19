# 4.1 ⬜ NW-14 + NW-15 — Picking an accepted job skips to a seeded review (M) · slug `nw-14-15-invoice-from-accepted-quote`

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 4.1) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

**Why.** The chips built at `AsstChat.tsx:3307-3311` keep only `{jobName, customerName, totalCents}` — `c.id` and `c.customerId` are dropped — so the click
handler (`:4382-4392`) can only prefill a *name string* and reopen "What's the price?" (`asstChat.price.whatTitle`). Both `POST /invoices` bodies (`:3431-3439`, `:3478-3486`) omit `quoteId`.

- [ ] RED — e2e: `cypress/e2e/ux-invoice-review.cy.ts` add `describe("REQ-NNN NW-14/15 invoice from an accepted quote")`: `cy.seedQuoteToCash()` (creates customer + quote), `cy.apiAcceptQuote(quoteId, { signature… })`,
      `cy.visit("/assistant")`, click the chip "Job done, need to invoice.", click `.chat__accepted-job` (first), then: `cy.contains("What's the price?").should("not.exist")`;
      `[data-cy=invoice-quote-summary]` shows the job name, the customer name, the total, "Billed so far" and "Paid so far" lines; click `[data-cy=invoice-flow-save]` (or the review's send button);
      `cy.request("/api/invoices")` → newest has `quoteId === <seeded id>` and `lineItems.length > 0`. Run → fails.
- [ ] RED — jest integration: `invoice-parity.int.test.ts` add `it("REQ-NNN POST /invoices with only quoteId derives amount, customer, lineItems")` (may pass on arrival — pin it).
- [ ] RED — jest unit: `jest/unit/invoice-from-quote.test.ts` add a case that `buildInvoiceFromQuote(quote)` output can be spread into the POST body: `{ quoteId, lineItems, customerId }` present. (Extend `shared/quote-flow/invoice-from-quote.ts:32-47` to also emit `customerId: quote.customerId`.)
- [ ] EDIT `AsstChat.tsx:3287-3313`: keep `id: c.id` and `customerId: c.customerId` on the chip objects (widen the `acceptedJobChips` state type).
- [ ] EDIT the chip click (`:4382-4392`): instead of `setPriceCaptureOpen(true)`: `pushHistory()`; `const q = await quotesClient.get(j.id)`; `setPendingPriceCents(q.estimatedTotal)`;
      `setInvoiceReview({ quoteId: q.id, customerId: q.customerId, customerName, custEmail, custPhone, lineItems: q.lineItems, terms: q.terms, jobName: q.jobName })`; also fetch
      `api.get("/invoices")` and filter by `quoteId` client-side → `billedTotalCents(existing)` (`shared/quote-flow/milestone-reconcile.ts:23-32`) and `paidTotal` = sum of `status==="paid"` siblings.
- [ ] EDIT the review card (`:4676-4728`): render `[data-cy=invoice-quote-summary]` (job name, line items, terms grid via the existing `TermGrid`, Billed so far / Paid so far / This invoice), make the amount an editable `MoneyInput` (default = agreement total − billed), keep the due-date input.
- [ ] EDIT `saveInvoiceFromReview` (`:3431-3439`) and `confirmSendInvoiceSwap` (`:3478-3486`): spread `buildInvoiceFromQuote(quote)` → `{ quoteId, lineItems, customerId, jobName, description }` and drop `status:"sent"` (the send endpoints stamp it).
- [ ] GREEN: all three; `invoice-parity.cy.ts` green (the `/i/:id` page now gets terms for chat-made invoices too).
- [ ] Done when: picking an accepted job never asks for the price or the customer again, and the saved invoice is linked to the quote.

## Phase context (verbatim from the plan, `Phase 4 — The invoice starter goes through the quote wizard (root cause #7) — closes NW-13, NW-14, NW-15, NW-16, NW-18 (L)`)

**Model to build toward (this is what the client described, and it reuses everything that exists).** The wizard always produces an agreement
row (a quote). An invoice is *derived* from it (`POST /invoices { quoteId }` → `invoice-controller/mod.ts:213-224` fills job name, description,
customer, line items, amount; the public `/i/:id` then shows terms, dates and the signed-quote link — `public-controller/mod.ts:707-733`).
So "Job done, need to invoice" = (a) if an accepted quote is picked, skip straight to the shared review in invoice mode; (b) otherwise run the
same wizard with `completion_date` in place of `wraps`, land on the same review, and send the invoice from it. The standalone cards at
`AsstChat.tsx:4577-4728` and `createInvoiceFromFlow`/`saveInvoiceFromReview` (`:3333-3458`) go away.

Do 4.1 first (independent, medium); 4.2 is the large one; 4.3 is cleanup.

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

- If I select an existing quote it should already know who the customer is. (Screenshot: it asks "What's the price?" again.) [p11]
  - **NW-15 ⬜ CONFIRMED.** Effort M.
  - Evidence: `:4377-4393` sets `priceCents` (prefill only) and `prefillCustomerName` (a *name string*, passed as `initialName`
    `:4742`) then `setPriceCaptureOpen(true)` → heading `asstChat.price.whatTitle` (`lang/en.json:349` "What's the price?") — the
    screenshot. `createInvoiceFromFlow` still requires a pick/create (`:3379` `needCustomer`). `POST /invoices` has no `quoteId`.
  - Fix: keep `{quoteId, customerId}`; on pick, skip to a review seeded from `GET /quotes/:id` with the price *editable*, not asked.
    Tests: none (`cypress/e2e/ux-assistant-prefill.cy.ts` is quick-quote only).

## Code at the cited lines (read from this tree while packaging)

### `front-end/islands/AsstChat.tsx:3307-3311`

```
3307:         .map((c) => ({
3308:           jobName: (c.jobName ?? c.summary ?? "").trim(),
3309:           customerName: c.customerName ?? null,
3310:           totalCents: c.estimatedTotal ?? 0,
3311:         }))
```

### `front-end/islands/AsstChat.tsx:4382-4392`

```
4382:                             onClick={() => {
4383:                               pushHistory();
4384:                               setPendingJobDetailsRaw(j.jobName);
4385:                               setSubmittedJobDetails(j.jobName);
4386:                               setAwaitingJobDetails(false);
4387:                               if (j.totalCents > 0) {
4388:                                 setPriceCents(j.totalCents);
4389:                               }
4390:                               setPrefillCustomerName(j.customerName ?? null);
4391:                               setPriceCaptureOpen(true);
4392:                             }}
```

### `front-end/islands/AsstChat.tsx:3431-3439`

```
3431:       const inv = await api.post<{ id?: string }>("/invoices", {
3432:         customerId: invoiceReview.customerId,
3433:         amount: cents,
3434:         ...(invoiceDueDate ? { dueDate: invoiceDueDate } : {}),
3435:         issuedDate: today,
3436:         status: "sent",
3437:         jobName,
3438:         ...(raw ? { description: raw } : {}),
3439:       });
```

### `front-end/islands/AsstChat.tsx:3478-3486`

```
3478:         const inv = await api.post<{ id?: string }>("/invoices", {
3479:           ...(customer?.id ? { customerId: customer.id } : {}),
3480:           amount: totalCents,
3481:           dueDate: today,
3482:           issuedDate: today,
3483:           status: "sent",
3484:           ...(quote?.jobName ? { jobName: quote.jobName } : {}),
3485:           ...(quote?.description ? { description: quote.description } : {}),
3486:         });
```

### `shared/quote-flow/invoice-from-quote.ts:32-47`

```
32: export function buildInvoiceFromQuote(quote: QuoteLike): InvoiceFromQuote {
33:   const invoice: InvoiceFromQuote = {
34:     quoteId: quote.id,
35:     jobName: quote.jobName ?? quote.summary,
36:     description: quote.description,
37:     customer: quote.customer,
38:     lineItems: quote.lineItems,
39:     totalCents: quote.estimatedTotal,
40:   };
41:   // Deliberately NO terms and NO signature fields — the invoice is a bill,
42:   // not an agreement (the agreement is linked instead).
43:   if (isAccepted(quote)) {
44:     invoice.signedQuoteUrl = `/q/${quote.id}`;
45:   }
46:   return invoice;
47: }
```

### `front-end/islands/AsstChat.tsx:3287-3313`

```
3287:     void api.get<
3288:       Array<{
3289:         id?: string;
3290:         jobName?: string | null;
3291:         summary?: string | null;
3292:         customerName?: string | null;
3293:         estimatedTotal?: number | null;
3294:         stage?: string;
3295:         status?: string;
3296:         acceptedAt?: string | null;
3297:         isSample?: boolean;
3298:       }>
3299:     >("/quotes").then((cards) => {
3300:       const list = (Array.isArray(cards) ? cards : [])
3301:         .filter((c) => c.isSample !== true)
3302:         .filter((c) =>
3303:           c.stage === "won" ||
3304:           c.status === "accepted" || Boolean(c.acceptedAt)
3305:         )
3306:         .slice(0, 3)
3307:         .map((c) => ({
3308:           jobName: (c.jobName ?? c.summary ?? "").trim(),
3309:           customerName: c.customerName ?? null,
3310:           totalCents: c.estimatedTotal ?? 0,
3311:         }))
3312:         .filter((j) => j.jobName.length > 0);
3313:       setAcceptedJobChips(list);
```

### `shared/quote-flow/milestone-reconcile.ts:23-32`

```
23: export function billedTotalCents(
24:   existing: readonly ExistingInvoiceLike[],
25: ): number {
26:   let total = 0;
27:   for (const inv of existing) {
28:     if (FREED_STATUSES.has(inv.status ?? "")) continue;
29:     total += Math.round(inv.amount ?? 0);
30:   }
31:   return total;
32: }
```

### `backend/src/paperwork/entrypoints/invoice-controller/mod.ts:213-224`

```
213:     if (dto.quoteId) {
214:       const q = await this.quotes.getOwned(dto.quoteId, user.id);
215:       dto.jobName ??= q.jobName ?? q.summary;
216:       dto.description ??= q.description;
217:       dto.customerId ??= q.customerId;
218:       dto.lineItems ??= q.lineItems;
219:       dto.amount ??= q.estimatedTotal ??
220:         ((q.lineItems ?? []).reduce(
221:           (s, li) => s + (li.price ?? 0) * (li.quantity ?? 1),
222:           0,
223:         ) || undefined);
224:     }
```

### `backend/src/paperwork/entrypoints/public-controller/mod.ts:707-733`

```
707:         ...(agreementTotal != null ? { agreementTotal } : {}),
708:         // Roadmap p.6: the invoice mirrors the quote's information but NOT
709:         // the numbered Terms (and never a signature block) — those live on
710:         // the agreement (the quote), which is linked instead once accepted.
711:         ...(quote && quote.userId === i.userId
712:           ? {
713:             startDate: quote.startDate,
714:             estimatedCompletionDate: quote.estimatedCompletionDate,
715:             effectiveDate: quote.effectiveDate ?? quote.createdAt,
716:             // The wizard-captured term grid (start / time-to-complete /
717:             // payment split / warranty) — feeds the invoice's TermGrid and
718:             // the payment-schedule milestones. This is NOT the numbered
719:             // legal clauses, which stay on the signed agreement only.
720:             terms: quote.terms ?? [],
721:             // "View the signed agreement" link target — only once actually
722:             // accepted (the user's "link to the signed quote if one exists").
723:             ...(isAccepted(quote)
724:               ? {
725:                 signedQuoteUrl: `/q/${quote.id}`,
726:                 signedAgreement: {
727:                   id: quote.id,
728:                   signedAt: quote.acceptedAt,
729:                 },
730:               }
731:               : {}),
732:           }
733:           : {}),
```

### `front-end/islands/AsstChat.tsx:4577-4637`

```
4577:                 : invoiceResult
4578:                 ? (
4579:                   // "Job done, need to invoice." success card (roadmap p.3):
4580:                   // the standalone invoice exists — hand over the link + send
4581:                   // actions. It also shows up under /invoices.
4582:                   <div class="chat__price-capture">
4583:                     <div class="chat__price-capture-head">
4584:                       <h4 class="chat__price-title">
4585:                         {tFor(lang, "asstChat.invoiceFlow.readyTitle")}
4586:                       </h4>
4587:                       <p class="chat__price-sub">
4588:                         {tFor(lang, "asstChat.invoiceFlow.readySub")}
4589:                       </p>
4590:                     </div>
4591:                     <div style="display:flex;flex-direction:column;gap:8px">
4592:                       <button
4593:                         type="button"
4594:                         class="chat__price-continue"
4595:                         disabled={sending}
4596:                         onClick={async () => {
4597:                           setError(undefined);
4598:                           setSending(true);
4599:                           try {
4600:                             if (invoiceResult.customerEmail) {
4601:                               await api.post(
4602:                                 `/invoices/${invoiceResult.id}/email`,
4603:                                 {},
4604:                               );
4605:                             }
4606:                             if (invoiceResult.customerPhone) {
4607:                               await api.post(
4608:                                 `/invoices/${invoiceResult.id}/text`,
4609:                                 {},
4610:                               );
4611:                             }
4612:                             if (
4613:                               !invoiceResult.customerEmail &&
4614:                               !invoiceResult.customerPhone
4615:                             ) {
4616:                               setError(
4617:                                 tFor(lang, "asstChat.invoiceFlow.noContact"),
4618:                               );
4619:                               return;
4620:                             }
4621:                             globalThis.location.href = "/invoices";
4622:                           } catch (err) {
4623:                             setError(
4624:                               err instanceof Error
4625:                                 ? err.message
4626:                                 : "couldn't send the invoice",
4627:                             );
4628:                           } finally {
4629:                             setSending(false);
4630:                           }
4631:                         }}
4632:                       >
4633:                         {sending
4634:                           ? tFor(lang, "asstChat.preview.sending")
4635:                           : tFor(lang, "asstChat.invoiceFlow.sendNow")}
4636:                       </button>
4637:                       <div style="display:flex;gap:8px">
```

### `front-end/islands/AsstChat.tsx:3333-3393`

```
3333:   async function createInvoiceFromFlow(
3334:     optionId: "use_active" | "pick_existing" | "create_new",
3335:     body?: {
3336:       customer?: {
3337:         id?: string;
3338:         create?: {
3339:           name: string;
3340:           email?: string;
3341:           phoneNumber?: string;
3342:           isBusiness?: boolean;
3343:           businessName?: string;
3344:         };
3345:       };
3346:     },
3347:   ) {
3348:     if (sending) return;
3349:     const cents = pendingPriceCents ?? 0;
3350:     if (cents <= 0) {
3351:       setError(tFor(lang, "asstChat.invoiceFlow.noAmount"));
3352:       return;
3353:     }
3354:     setError(undefined);
3355:     setSending(true);
3356:     try {
3357:       let customerId: string | undefined;
3358:       let custEmail: string | undefined;
3359:       let custPhone: string | undefined;
3360:       if (optionId === "create_new" && body?.customer?.create) {
3361:         const c = body.customer.create;
3362:         const created = await clientsClient.create({
3363:           name: c.name,
3364:           ...(c.phoneNumber ? { phoneNumber: c.phoneNumber } : {}),
3365:           ...(c.email ? { email: c.email } : {}),
3366:           ...(c.businessName ? { businessName: c.businessName } : {}),
3367:         });
3368:         customerId = created.id;
3369:         custEmail = created.email;
3370:         custPhone = created.phoneNumber;
3371:       } else if (optionId === "pick_existing" && body?.customer?.id) {
3372:         customerId = body.customer.id;
3373:         const picked = await clientsClient.list().then((cs) =>
3374:           cs.find((c) => c.id === customerId)
3375:         ).catch(() => undefined);
3376:         custEmail = picked?.email;
3377:         custPhone = picked?.phoneNumber;
3378:       } else {
3379:         setError(tFor(lang, "asstChat.invoiceFlow.needCustomer"));
3380:         return;
3381:       }
3382:       // UX-31: don't mint anything yet — land on a review step where the
3383:       // due date is visible and editable (defaulting to the same +30-day
3384:       // window the /invoices modal uses), and only save on confirm. The old
3385:       // path silently persisted an invoice due the day it was created.
3386:       const customerName = optionId === "create_new"
3387:         ? body?.customer?.create?.name
3388:         : undefined;
3389:       setInvoiceDueDate(
3390:         new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(
3391:           0,
3392:           10,
3393:         ),
```
