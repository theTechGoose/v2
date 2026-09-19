# 4.2 🐛 NW-13 + NW-18 + NW-16 — A brand-new invoice runs the wizard (customer → completion date → payment → warranty) and lands on the shared preview (L) · slug `nw-13-18-invoice-wizard`

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 4.2) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

**Why.** `onPriceContinue` (`AsstChat.tsx:1861-1866`) returns before the wizard when `invoiceFlow`; the wizard spec is one hard-coded constant
(`terms-wizard-spec/mod.ts:19-125`) referenced directly by five coordinators (`handle-wizard-answer:99,127,134,161,372`, `transition-to-terms:53-96`,
`rewind-wizard:67,93,117`, `load-conversation:57`); `wizard-progress/mod.ts` is a linear cursor with no per-flow filtering. There is no `completion_date` step or key.

- [ ] **Backend, step A — a second spec.** RED Deno unit test in `terms-wizard-spec/test.ts` (created in 1.8): `INVOICE_WIZARD_V1.steps.map(s=>s.id)` equals `["customer","completion_date","payment_terms","warranty"]`;
      `getWizardSpec("invoice-v1")` returns it; `completion_date` options are `today | yesterday | last_week | custom(isCustom)`. Run → fails.
  - [ ] EDIT `terms-wizard-spec/mod.ts`: add `INVOICE_WIZARD_V1 = { id: "invoice-v1", steps: [ <customer step object copied>, { id:"completion_date", label:"termsWizard.completionDate.label", question:"termsWizard.completionDate.question", options:[ {id:"today",label:"termsWizard.completionDate.today"}, {id:"yesterday",…}, {id:"last_week",…}, {id:"custom",label:"termsWizard.completionDate.custom",isCustom:true} ] }, <payment_terms copied>, <warranty copied> ] }`;
        `getWizardSpec` (`:128-131`) resolves both ids.
  - [ ] EDIT lang (both dicts): `termsWizard.completionDate.label` "Completed" / "Terminado"; `.question` "When was the job completed?" / "¿Cuándo se terminó el trabajo?"; `.today` "Today" / "Hoy"; `.yesterday` "Yesterday" / "Ayer"; `.last_week` "Last week" / "La semana pasada"; `.custom` "Pick a date" / "Elegir una fecha".
- [ ] **Backend, step B — coordinators resolve the spec from state.** RED Deno int test `transition-to-terms/int.test.ts`: `run({ conversationId, userId, docKind: "invoice" })` → wizard state `specId === "invoice-v1"` and the first wizard message's payload `specId` matches. Run → fails.
  - [ ] EDIT `transition-to-terms/mod.ts`: input gains `docKind?: "quote" | "invoice"`; pick the spec with it; persist `docKind` on the conversation (add the field to `AgentConversation` DTO + store) so the FE can preset the review.
  - [ ] EDIT the other four: replace every `TERMS_WIZARD_V1` with `getWizardSpec(state.specId)` where a `WizardState` is in hand (`handle-wizard-answer:99,127,134,161,372`, `rewind-wizard:67,93,117`, `load-conversation:57`). `rewind-wizard:67` (the no-state branch) can keep `TERMS_WIZARD_V1.id`.
  - [ ] EDIT `handle-wizard-answer` `finalizeTerms`: when the answer is `completion_date`, write `estimatedCompletionDate`/`completedAt` on the quote (add `completedAt?: string` to the quote DTO if absent) and let `payment_terms.due_now` set the invoice due date = completion date, `net_15` = +15 days, others = +30.
  - [ ] Add an `int.test.ts` case in `handle-wizard-answer` walking all four invoice steps → `continue_cta` with `quoteId` and `docKind: "invoice"` in the payload.
- [ ] **Front-end, step C — route the chip through the wizard.** RED e2e: rewrite `cypress/e2e/ux-invoice-review.cy.ts` UX-31 cases into `describe("REQ-NNN NW-13/18 new invoice runs the wizard")`:
      chip "Job done, need to invoice." → type details → send → price → `.chat__price-continue` → customer step (`cy.openCustomerCreateForm()` …) → completion-date step shows Today/Yesterday/Last week/Pick a date and **no** "How long will the job take?" →
      payment step → warranty step → `.quote-review` visible with the **invoice** pill active (`.quote-review__langpill.is-active` contains the invoice label) → send (email) → `cy.request("/api/invoices")` newest has `quoteId`, `dueDate` = completion date when "Due Now" was picked; `cy.visit("/i/<id>")` shows the term grid (`invoice-parity.cy.ts` assertions). Run → fails.
  - [ ] EDIT `AsstChat.tsx:1861-1866`: delete the `if (invoiceFlow) { openInvoiceCustomerStep(); return; }` early return; `startQuoteFromRaw(raw, cents)` gains a `docKind` argument = `invoiceFlow ? "invoice" : "quote"` and passes it to `assistantClient.transitionToTerms(convId, { docKind })` (extend `front-end/clients/assistant.ts` + the controller body parsing).
  - [ ] EDIT the auto-open effect (`:1583-1595`) / `submitContinueCta`: when the CTA payload has `docKind:"invoice"` (or the conversation does), `setReviewDocType("invoice")` before opening the review.
  - [ ] EDIT `confirmSendInvoiceSwap` (`:3467-3540`): it is now the invoice send path — body from 4.1 plus `dueDate` from the wizard answer (read it off the quote's terms), never `today` by default.
  - [ ] The customer step's "Use the customer from chat" (`use_active`) should work for invoices too — nothing to change once the wizard is shared.
- [ ] **GREEN:** Deno tests (`cd backend && deno task test`), e2e above, `quotes-wizard-navigation.cy.ts`, `ux-assistant-single-back.cy.ts`, `assistant-history.cy.ts` (back through the invoice wizard uses the same stack).
- [ ] **Done when:** the invoice path asks customer / completion date / payment / warranty, previews the same document with the invoice pill on, and the public invoice shows terms and job details.

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

- This entire process is really bad. It is not different from the quote. We need to preview it, edit it, provide all the relevant information, etc. [p12]
  - **NW-16 🐛 CONFIRMED — a real invoice preview exists but is unreachable from this flow.** Effort M.
  - Evidence: the review card `:4676-4728` shows amount (read-only), name, due date, save — nothing else. The real preview is the
    quote review's doc-type toggle `reviewDocType` `:5477-5531` (`asstChat.preview.invoiceModeNote` `lang/en.json:310`,
    `sendInvoice` `:325`) — and even that path (`confirmSendInvoiceSwap` `:3467-3540`) posts without `quoteId`/`lineItems`
    (`:3478-3486`), so the public `/i/:id` renders the amount-only shape.
  - Fix: reuse the quote-review preview with `reviewDocType="invoice"`; add `quoteId` + `lineItems` to both `POST /invoices`.
    Tests: `cypress/e2e/ux-invoice-review.cy.ts` (UX-31) pins only "a review exists, due date ≠ today"; `invoice-parity.cy.ts` pins `/i` + `[data-cy=invoice-edit]` on `/invoices`.

- This is a different prompt path and structure from the quote. It should be the same: if there is no quote to select, go through the same questions as the quote (skip how long it took, but ask for the completion date). Right now there is no preview, just "Invoice ready 🎉 … Send it now". That is not what we want. [p27]
  - **NW-18 🐛 CONFIRMED (same fix as NW-13/NW-16).** Effort L.
  - Evidence: copy `asstChat.invoiceFlow.readyTitle` (`lang/en.json:244` "Invoice ready 🎉", render `:4585`), `readySub` (`:243`),
    `sendNow` (`:247`, `:4635`). The invoice is created `status:"sent"` (`:3437`) *before* "Send it now" posts `/email` + `/text`
    (`:4602,:4608`). Skipped vs the quote: start_date ❌, wraps ❌ (correct per the ask), payment_terms ❌ (raw `dueDate` `:4699-4710`),
    warranty ❌, job picker ❌ (`:2445-2449`), preview ❌; **completion date does not exist anywhere** (only `issuedDate: today` `:3430,:3436`).
  - Fix: `terms-wizard-spec` gets a `completion_date` step for invoice mode (new `termsWizard.completionDate.*` keys, both dicts);
    land on the shared preview; mint with `quoteId`.

## Code at the cited lines (read from this tree while packaging)

### `front-end/islands/AsstChat.tsx:1861-1866`

```
1861:     if (invoiceFlow) {
1862:       // "Job done, need to invoice." — no quote/wizard: go pick the customer
1863:       // and mint the standalone invoice (roadmap p.3).
1864:       openInvoiceCustomerStep();
1865:       return;
1866:     }
```

### `backend/src/agents/domain/business/terms-wizard-spec/mod.ts:19-79`

```
19: export const TERMS_WIZARD_V1: WizardSpec = {
20:   id: "terms-v1",
21:   steps: [
22:     {
23:       id: "customer",
24:       label: "termsWizard.customer.label",
25:       question: "termsWizard.customer.question",
26:       options: [
27:         { id: "use_active", label: "termsWizard.customer.useActive" },
28:         { id: "pick_existing", label: "termsWizard.customer.pickExisting" },
29:         {
30:           id: "create_new",
31:           label: "termsWizard.customer.createNew",
32:           isCustom: true,
33:         },
34:       ],
35:     },
36:     {
37:       id: "start_date",
38:       label: "termsWizard.startDate.label",
39:       question: "termsWizard.startDate.question",
40:       options: [
41:         { id: "asap", label: "termsWizard.startDate.asap" },
42:         { id: "next_week", label: "termsWizard.startDate.nextWeek" },
43:         { id: "next_month", label: "termsWizard.startDate.nextMonth" },
44:         {
45:           // Roadmap p.4/5: paperwork written AFTER the work happened.
46:           id: "job_completed",
47:           label: "termsWizard.startDate.jobCompleted",
48:         },
49:         { id: "custom", label: "termsWizard.startDate.custom", isCustom: true },
50:       ],
51:     },
52:     {
53:       id: "wraps",
54:       label: "termsWizard.wraps.label",
55:       question: "termsWizard.wraps.question",
56:       options: [
57:         { id: "1_day", label: "termsWizard.wraps.oneDay" },
58:         { id: "2_3_days", label: "termsWizard.wraps.twoThreeDays" },
59:         { id: "1_week", label: "termsWizard.wraps.oneWeek" },
60:         { id: "2_weeks", label: "termsWizard.wraps.twoWeeks" },
61:         {
62:           id: "job_completed",
63:           label: "termsWizard.wraps.jobCompleted",
64:         },
65:         { id: "custom", label: "termsWizard.wraps.custom", isCustom: true },
66:       ],
67:     },
68:     {
69:       id: "payment_terms",
70:       label: "termsWizard.paymentTerms.label",
71:       question: "termsWizard.paymentTerms.question",
72:       options: [
73:         {
74:           // Roadmap p.6: invoice-style terms — the full amount is due the
75:           // moment the customer signs (pairs with "Job Completed" above).
76:           id: "due_now",
77:           label: "termsWizard.paymentTerms.dueNow.label",
78:           sub: "termsWizard.paymentTerms.dueNow.sub",
79:         },
```

### `backend/src/agents/domain/business/terms-wizard-spec/mod.ts:128-131`

```
128: export function getWizardSpec(specId: string): WizardSpec {
129:   if (specId === TERMS_WIZARD_V1.id) return TERMS_WIZARD_V1;
130:   throw new Error(`unknown wizard spec: ${specId}`);
131: }
```

### `front-end/islands/AsstChat.tsx:1583-1595`

```
1583:   useEffect(() => {
1584:     if (previewCtaId !== null) return;
1585:     for (const m of messages) {
1586:       if (m.kind !== "continue_cta") continue;
1587:       const p = (m.payload ?? {}) as { toPhase?: string };
1588:       if (p.toPhase !== "send") continue;
1589:       if (reviewedCtas.has(m.id)) continue;
1590:       if (autoOpenedCtasRef.current.has(m.id)) continue;
1591:       autoOpenedCtasRef.current.add(m.id);
1592:       submitContinueCta(m).catch(() => {});
1593:       break;
1594:     }
1595:   }, [messages, previewCtaId, reviewedCtas]);
```

### `front-end/islands/AsstChat.tsx:3467-3527`

```
3467:   async function confirmSendInvoiceSwap(
3468:     channel: "email" | "sms" | "both",
3469:     totalCents: number,
3470:   ) {
3471:     if (sending) return;
3472:     setError(undefined);
3473:     setSending(true);
3474:     try {
3475:       let invId = swapInvoiceIdRef.current;
3476:       if (!invId) {
3477:         const today = new Date().toISOString().slice(0, 10);
3478:         const inv = await api.post<{ id?: string }>("/invoices", {
3479:           ...(customer?.id ? { customerId: customer.id } : {}),
3480:           amount: totalCents,
3481:           dueDate: today,
3482:           issuedDate: today,
3483:           status: "sent",
3484:           ...(quote?.jobName ? { jobName: quote.jobName } : {}),
3485:           ...(quote?.description ? { description: quote.description } : {}),
3486:         });
3487:         if (!inv?.id) throw new Error("couldn't create the invoice");
3488:         invId = inv.id;
3489:         swapInvoiceIdRef.current = invId;
3490:       }
3491:       // P-09: the invoice send endpoints report logical failure as HTTP 200
3492:       // + {ok:false, reason} — interpret the BODY, never just Response.ok
3493:       // (the old `await` chain read every 200 as delivered). A failed leg
3494:       // surfaces the same honest divider the quote-send path renders.
3495:       let fail: { key: string; reason: string } | null = null;
3496:       const interpretLeg = (body: unknown, httpOk: boolean) => {
3497:         const outcome = interpretSendResult({ httpOk, body });
3498:         const key = sendResultLangKey(outcome);
3499:         if (key && !fail) {
3500:           const b = body as { reason?: unknown } | null;
3501:           fail = {
3502:             key,
3503:             reason: typeof b?.reason === "string"
3504:               ? b.reason
3505:               : outcome.reason ?? "",
3506:           };
3507:         }
3508:       };
3509:       if (channel === "email" || channel === "both") {
3510:         try {
3511:           const res = await api.post<{ ok?: boolean; reason?: string }>(
3512:             `/invoices/${invId}/email`,
3513:             {},
3514:           );
3515:           interpretLeg(res, true);
3516:         } catch {
3517:           interpretLeg(null, false);
3518:         }
3519:       }
3520:       if (channel === "sms" || channel === "both") {
3521:         try {
3522:           const res = await api.post<{ ok?: boolean; reason?: string }>(
3523:             `/invoices/${invId}/text`,
3524:             {},
3525:           );
3526:           interpretLeg(res, true);
3527:         } catch {
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
