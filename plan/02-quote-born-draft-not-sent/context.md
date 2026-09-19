# 1.2 🐛 NW-10 — A quote is born `draft`, not `sent` (S) · slug `nw-10-quote-born-draft`

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 1.2) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

**Goal.** The review card's status chip says "Draft" until the contractor actually sends.
**Why.** `front-end/islands/AsstChat.tsx:2155-2158` posts `POST /quotes { ...quoteFields, status: "sent" }` at creation. The store
only defaults to `draft` when `status` is falsy (`quote-store/mod.ts:28`). Side effect: because the row is already `sent`,
`lock-quote/mod.ts:72` (`wasAlreadySent`) skips stamping `sentAt` and skips its `quote:sent` event.
**Do NOT touch `lock-quote`**: on the chat path "Lock it in" genuinely emails the quote (`lock-quote/mod.ts:89-99`), so `sent`
is truthful there. The real send for the price flow is `confirmSendQuote` (`AsstChat.tsx:2788-2816`) →
`POST /agents/conversations/:id/send-quote` → `send-quote/mod.ts:87-95`, which already stamps `status:"sent"` + `sentAt` on first dispatch.

- [ ] RED — integration: `jest/integration/quote-lifecycle.int.test.ts` add
      `it("REQ-NNN NW-10 POST /quotes with status:'sent' is still born a draft")`: `const id = await seedQuote(s, { status: "sent" })`;
      `GET /quotes/:id` → `expect(body.status).toBe("draft")`. Run → fails (returns `sent`).
- [ ] RED — e2e: `cypress/e2e/quotes-status-badges.cy.ts` add `it("REQ-NNN NW-10 the price flow creates a draft")`:
      `cy.loginAs(<unique phone>)`, `cy.visit("/assistant")`, click `button.chat__empty-prompt` containing "I know my price, write it up.",
      type `Paint a 50ft wooden fence` into `textarea.composer__input`, click `button.composer__send`, wait for `.chat__price-capture`,
      type `500` into its `input`, click `.chat__price-continue`, wait for `cy.location("pathname")` to match `/^\/assistant\/.+/`,
      then `cy.request("/api/quotes")` → newest row (max `createdAt`) has `status === "draft"`. Run → fails (`sent`).
- [ ] Unit: `n/a — no pure logic changes; jest/unit/quote-status.test.ts already pins the flow`.
- [ ] EDIT 1 `front-end/islands/AsstChat.tsx:2157`: delete the line `status: "sent",` (leave `...quoteFields`).
- [ ] EDIT 2 (belt and braces) `backend/src/paperwork/entrypoints/quote-controller/mod.ts:21`: split into
      `const dto = parseCreateQuote(body); if (dto.status === "sent" || dto.status === "viewed") dto.status = "draft";` then pass `dto`.
      If TypeScript says `status` is not on the DTO, add `@IsOptional() @IsString() status?: string;` to `CreateQuoteDto` in `backend/src/paperwork/dto/quote.ts`.
- [ ] EDIT 3 `backend/src/paperwork/domain/coordinators/send-paperwork-sms/mod.ts`: it never stamps `sentAt` (grep confirms zero hits),
      so an SMS-only send from `/quotes` leaves the quote `draft`. Copy the idempotent block from `send-paperwork-email/mod.ts:204-214`
      (`if (result.ok && input.kind === "quote" && quote && !quote.sentAt) await this.quotes.update(id, userId, { status:"sent", sentAt: now })`)
      into the SMS coordinator right after its successful send. Inject `QuoteStore` in the constructor if it is not already there.
- [ ] GREEN: the two red tests pass; `cd backend && deno test -A --unstable-kv src/agents/domain/coordinators/lock-quote/int.test.ts` still green (unchanged behaviour).
- [ ] Done when: after "Continue" on the price step, `/quotes` lists the new quote as Draft and the review-card chip reads Draft.

## Source items from the triage (`new-working-issues.md`, client's words + verdict + evidence)

- The Quote + Agreement card shows a "SENT" badge in the top right before I have actually sent it. [p8]
  - **NW-10 🐛 CONFIRMED — the quote row is created with `status:"sent"`.** Effort S (FE) / M (with backend).
  - Evidence: review-card chip `AsstChat.tsx:5400-5407` reads `statusChipLabel(quote?.status ?? lockedPayload.status)`
    (`:325-340` → `status.sent`, `lang/en.json:2362` "Sent"). `startQuoteFromRaw` (`:2155-2158`, called from `onPriceContinue`
    `:1874`) posts `POST /quotes { ...quoteFields, status: "sent" }` — the store default is `draft`
    (`backend/src/paperwork/domain/data/quote-store/mod.ts:28`). The real send is `confirmSendFromReview` `:2816`. On the chat
    action-card path, `lock-quote/mod.ts:80` also stamps `sent`+`sentAt` at *lock* time and `:120` puts it on the card payload.
    Contradicts `shared/quote-flow/quote-status.ts:10-15` (draft→sent→viewed→accepted).
  - Fix: drop `status:"sent"` at `:2157` (let the store default), and move the flip out of `lock-quote` into the actual send
    coordinator (adjust the `sentAt`-derived stage, `lock-quote/mod.ts:74-79`).
  - Tests: `jest/unit/quote-status.test.ts`, `jest/integration/quote-lifecycle.int.test.ts:23` ("freshly created quote is a
    draft"), `cypress/e2e/quotes-status-badges.cy.ts:68` — all bypass the assistant path; nothing asserts `.quote-review__chip`.

## Code at the cited lines (read from this tree while packaging)

### `front-end/islands/AsstChat.tsx:2155-2158`

```
2155:         const quote = await api.post<{ id?: string }>("/quotes", {
2156:           ...quoteFields,
2157:           status: "sent",
2158:         });
```

### `backend/src/paperwork/domain/data/quote-store/mod.ts:25-31`

```
25:     // move it forward from there. (Set after the spread — the DTO's declared
26:     // class field materializes `status: undefined`, which would clobber a
27:     // spread-in default.)
28:     if (!quote.status) quote.status = "draft";
29:     // Roadmap p.8: every quote carries a ≤3-word job name platform-wide.
30:     // The LLM polish step supplies one on assistant-built quotes; API-created
31:     // quotes fall back to the deterministic summarizer. UX-29: the owner's
```

### `backend/src/agents/domain/coordinators/lock-quote/mod.ts:69-75`

```
69: 
70:     const quote = await this.quotes.getOwned(input.quoteId, input.userId);
71: 
72:     const wasAlreadySent = quote.status === "sent";
73:     if (!wasAlreadySent) {
74:       // Stamp sentAt here too — the /quotes stage derivation reads sentAt
75:       // (not status), and the email-side stamping in SendPaperworkEmail is
```

### `backend/src/agents/domain/coordinators/lock-quote/mod.ts:89-99`

```
89:       try {
90:         await this.emailer.run(input.userId, {
91:           kind: "quote",
92:           resourceId: quote.id,
93:         });
94:       } catch (err) {
95:         console.error(
96:           `[lock-quote] email dispatch failed for quote ${quote.id}:`,
97:           err,
98:         );
99:       }
```

### `front-end/islands/AsstChat.tsx:2788-2816`

```
2788:   async function confirmSendQuote(
2789:     message: Message,
2790:     channel: "email" | "sms" | "both" = "email",
2791:     language?: "en" | "es",
2792:   ) {
2793:     if (sending || !convoId) return;
2794:     const payload = (message.payload ?? {}) as { quoteId?: string };
2795:     let id = payload.quoteId ?? quote?.id ?? quoteId;
2796:     setError(undefined);
2797:     setSending(true);
2798:     try {
2799:       if (!id) {
2800:         const detail = await assistantClient.conversation(convoId);
2801:         id = detail.quote?.id ??
2802:           (detail.conversation as { quoteId?: string } | undefined)?.quoteId;
2803:       }
2804:       if (!id) throw new Error("no quote bound to this conversation");
2805:       const res = await assistantClient.sendQuoteFlow(
2806:         convoId,
2807:         id,
2808:         channel,
2809:         language,
2810:       );
2811:       setReviewedCtas((prev) => {
2812:         const next = new Set(prev);
2813:         next.add(message.id);
2814:         return next;
2815:       });
2816:       setQuote((q) => (q ? { ...q, status: "sent" } : q));
```

### `backend/src/agents/domain/coordinators/send-quote/mod.ts:87-95`

```
87:     // Stamp the send state on the FIRST dispatch. sentAt (not status) is the
88:     // guard: lock-quote flips status to "sent" without a timestamp, and the
89:     // SMS-only path used to skip the stamp entirely — which hid the freshly
90:     // won job from /jobs and every dashboard number (UX-02).
91:     if (!quote.sentAt) {
92:       const statusFlip = !quote.status || quote.status === "draft";
93:       await this.quotes.update(quote.id, input.userId, {
94:         ...(statusFlip ? { status: "sent" } : {}),
95:         sentAt: new Date().toISOString(),
```

### `front-end/islands/AsstChat.tsx:2154-2160`

```
2154:       } else {
2155:         const quote = await api.post<{ id?: string }>("/quotes", {
2156:           ...quoteFields,
2157:           status: "sent",
2158:         });
2159:         if (!quote?.id) throw new Error("failed to create quote");
2160: 
```

### `backend/src/paperwork/entrypoints/quote-controller/mod.ts:18-24`

```
18:   async create(@Context() ctx: ExecutionContext, @Body() body: unknown) {
19:     const user = await requireUser(ctx, this.sessions, this.users);
20:     // UX-29: derive a missing jobName in the owner's language.
21:     return await this.store.create(user.id, parseCreateQuote(body), {
22:       jobNameLang: user.language === "es" ? "es" : "en",
23:     });
24:   }
```

### `backend/src/paperwork/domain/coordinators/send-paperwork-email/mod.ts:204-214`

```
204:     // Stamp the quote's lifecycle: status→"sent" + sentAt→now (idempotent — only if not already set).
205:     // Mirrors the public-controller's accept-time stamping and powers the /quotes stage derivation.
206:     if (
207:       result.ok && input.kind === "quote" && quoteForStamp &&
208:       !quoteForStamp.sentAt
209:     ) {
210:       await this.quotes.update(input.resourceId, userId, {
211:         status: "sent",
212:         sentAt: new Date().toISOString(),
213:       });
214:     }
```
