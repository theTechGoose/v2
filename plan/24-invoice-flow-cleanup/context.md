# 4.3 Cleanup after 4.2 (S) · same worktree as 4.2 or slug `nw-13-cleanup`

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 4.3) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

- [ ] Delete the standalone success/review cards `AsstChat.tsx:4577-4728`, `createInvoiceFromFlow` `:3333-3410`, `saveInvoiceFromReview` `:3414-3458`, `openInvoiceCustomerStep` `:3318-3324`, the `invoiceCustomerOpen`/`invoiceReview`/`invoiceResult` state and their entries in `pushHistory`/`popHistory`/`composerHidden` (`:1034-1053`, `:1063-1077`, `:7262-7266`), and `resolveAssistantBack`'s `invoiceResultOpen` (`shared/quote-flow/assistant-back.ts:23,48` + its unit test case at `jest/unit/assistant-back.test.ts:52-58`).
- [ ] Delete lang keys `asstChat.invoiceFlow.readyTitle|readySub|sendNow|viewInvoice|goToInvoices|reviewTitle|saveCta|noAmount|needCustomer|noContact|dueDateLabel` (`lang/*.json:238-248`) once nothing references them (`grep -rn "asstChat.invoiceFlow" front-end shared`).
- [ ] Update `TDD-QUOTE-FLOW.md` row 5 and `TESTS-UX-PROBLEMS.md` UX-31 to point at the new spec.
- [ ] Verify: `cd front-end && deno task build`; full Cypress `run:assistant` + `run:invoice` green.

---

## Phase context (verbatim from the plan, `Phase 4 — The invoice starter goes through the quote wizard (root cause #7) — closes NW-13, NW-14, NW-15, NW-16, NW-18 (L)`)

**Model to build toward (this is what the client described, and it reuses everything that exists).** The wizard always produces an agreement
row (a quote). An invoice is *derived* from it (`POST /invoices { quoteId }` → `invoice-controller/mod.ts:213-224` fills job name, description,
customer, line items, amount; the public `/i/:id` then shows terms, dates and the signed-quote link — `public-controller/mod.ts:707-733`).
So "Job done, need to invoice" = (a) if an accepted quote is picked, skip straight to the shared review in invoice mode; (b) otherwise run the
same wizard with `completion_date` in place of `wraps`, land on the same review, and send the invoice from it. The standalone cards at
`AsstChat.tsx:4577-4728` and `createInvoiceFromFlow`/`saveInvoiceFromReview` (`:3333-3458`) go away.

Do 4.1 first (independent, medium); 4.2 is the large one; 4.3 is cleanup.

## Source items from the triage (`new-working-issues.md`, client's words + verdict + evidence)

- On the landing page we do not say "Write it myself". Go through the same prompt as "I know my price, write it up". The invoice needs all the same terms as a quote, and that process is already built. [p9]
  - **NW-13 🐛 CONFIRMED — asks 0 of the 4 term questions; backend parity unused.** Effort L (with NW-24).
  - Evidence: quote wizard = customer / start_date / wraps / payment_terms / warranty
    (`backend/src/agents/domain/business/terms-wizard-spec/mod.ts:21-119`; questions `lang/en.json:910,932,945,923,936`) then job
    picker, preview, send. Invoice = details → price → customer → due date → save; comment `:3270-3274` "no signature, no terms".
  - Fix: route the invoice chip through the same wizard (swap `wraps` for a completion-date step) and mint with `quoteId`.
  - Tests: `jest/integration/invoice-parity.int.test.ts` pins the *API* only; nothing drives the assistant chip's questions.

- This is a different prompt path and structure from the quote. It should be the same: if there is no quote to select, go through the same questions as the quote (skip how long it took, but ask for the completion date). Right now there is no preview, just "Invoice ready 🎉 … Send it now". That is not what we want. [p27]
  - **NW-18 🐛 CONFIRMED (same fix as NW-13/NW-16).** Effort L.
  - Evidence: copy `asstChat.invoiceFlow.readyTitle` (`lang/en.json:244` "Invoice ready 🎉", render `:4585`), `readySub` (`:243`),
    `sendNow` (`:247`, `:4635`). The invoice is created `status:"sent"` (`:3437`) *before* "Send it now" posts `/email` + `/text`
    (`:4602,:4608`). Skipped vs the quote: start_date ❌, wraps ❌ (correct per the ask), payment_terms ❌ (raw `dueDate` `:4699-4710`),
    warranty ❌, job picker ❌ (`:2445-2449`), preview ❌; **completion date does not exist anywhere** (only `issuedDate: today` `:3430,:3436`).
  - Fix: `terms-wizard-spec` gets a `completion_date` step for invoice mode (new `termsWizard.completionDate.*` keys, both dicts);
    land on the shared preview; mint with `quoteId`.

## Code at the cited lines (read from this tree while packaging)

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

### `jest/unit/assistant-back.test.ts:52-58`

```
52:   it("saved invoice is terminal → exit, even with snapshots below it", () => {
53:     expect(resolveAssistantBack({
54:       ...base(),
55:       invoiceResultOpen: true,
56:       viewStackDepth: 3,
57:     })).toBe("exit-dashboard");
58:   });
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
