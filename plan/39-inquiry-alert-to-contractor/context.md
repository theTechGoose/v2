# 7.3 ⬜ NW-26 — "Ask a question" reaches the contractor by email + text (M) · slug `nw-26-inquiry-alert`

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 7.3) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

**Why.** `public-controller/mod.ts:574-604` only emits a bus event; the only sink is a bell notification that no UI renders in full (`DashboardPage.tsx:250-257` shows the title only); `contactBack` is dropped. The accept path shows the pattern: `:497 acceptedAlert.run(...)` → `send-accepted-alert/mod.ts:40-138` (email + SMS + comms log).

- [ ] RED Deno int: new `send-inquiry-alert/int.test.ts`: `run(quoteId, { question, contactBack, name })` → one email to `contractor.email` whose body contains the full question and `contactBack`, one SMS to `contractor.phoneNumber`, both logged via `LogPaperworkMessage`.
- [ ] RED jest integration (`public-controller/e2e.test.ts:208-225` is Deno; add a jest one): `POST /api/quotes/:id/inquiry` → the contractor's comms trail (`GET /messages` or the endpoint `ux-payment-receipt.int.test.ts` reads) has an entry containing the question.
- [ ] RED e2e (`public-doc-state.cy.ts` P-63 area): after asking, `cy.visit("/dashboard")` feed item shows the question body (`[data-cy=notif-body]`).
- [ ] EDIT: copy `send-accepted-alert/mod.ts` to `send-inquiry-alert/mod.ts` (subject key `inquiryAlert.email.subject` "{name} asked about {jobName}" / es; SMS key `inquiryAlert.sms.body`); register in `paperwork/mod-root.ts`; call it at `public-controller:602` (awaited, `.catch` logged like `:497`); render `n.body` in `DashboardPage.tsx:254`.

## Phase context (verbatim from the plan, `Phase 7 — Remaining medium items (no decision needed; any order; after Phases 1–5 if time is short)`)



## Source items from the triage (`new-working-issues.md`, client's words + verdict + evidence)

- From the emailed link I filled in the "Ask a question" box at the bottom of the quote ("Question sent — your contractor will follow up directly"), but I never received the question. Where does it go? [p17]
  - **NW-26 ⬜ answered: into one notification KV row that no shipped UI displays in full. Nothing is emailed or texted.** Effort M.
  - Evidence: `PublicQuoteActions.tsx:318-325` → `POST /api/quotes/:id/inquiry {question, contactBack, name}`; success copy
    `lang/en.json:1886` "✓ Question sent" / `:1885` "Your contractor will follow up directly." Backend
    `public-controller/mod.ts:574-603` only emits a domain event (JSDoc `:569-573`: "lands as a notification on the contractor's bell
    + activity feed"). Only sink: `notify-on-event/mod.ts:237-247` (`customer_replied`, title `notify.quote.inquiry`
    `lang/en.json:1502` "{name} asked a question", body truncated to 140). Why nothing arrives: (1) the bell is not built —
    `DashTopbar.tsx:159-162`; (2) the activity feed renders the title only, never `n.body` — `DashboardPage.tsx:250-258`; (3)
    `contactBack` is dropped (`public-controller:598` → never read); (4) no `SendInquiryAlert` (compare `SendAcceptedAlert` fired at
    `:497`); (5) `/messages` is a 302 to `/assistant` (`routes/messages/index.tsx:6-12`).
  - Fix: new `send-inquiry-alert` coordinator (model on `send-accepted-alert`) that emails + texts the contractor the full
    question and `contactBack`, logged via `LogPaperworkMessage`; render `n.body` in the feed.
  - Tests: `backend/src/paperwork/entrypoints/public-controller/e2e.test.ts:208-225` asserts `ok` only; `cypress/e2e/public-doc-state.cy.ts:320` (P-63) panel state only.

## Code at the cited lines (read from this tree while packaging)

### `backend/src/paperwork/entrypoints/public-controller/mod.ts:574-604`

```
574:   @Post("quotes/:id/inquiry")
575:   async inquireQuote(
576:     @Context() ctx: ExecutionContext,
577:     @Param("id") id: string,
578:     @Body() body: unknown,
579:   ) {
580:     const dto = parseInquire(body);
581:     const existing = await this.quotes.get(id);
582:     const customerName = await lookupCustomerName(
583:       this.customers,
584:       existing.customerId,
585:       existing.userId,
586:     );
587:     await this.bus.emit({
588:       userId: existing.userId,
589:       // Emit as a quote-scoped event so the topbar bell can link back to the
590:       // quote. The notification type ("customer_replied") is decided by the
591:       // mapper based on the action verb.
592:       entityType: "quote",
593:       entityId: existing.id,
594:       action: "inquiry",
595:       data: {
596:         ...(customerName ? { customerName } : {}),
597:         question: dto.question,
598:         ...(dto.contactBack ? { contactBack: dto.contactBack } : {}),
599:         ...(dto.name ? { askName: dto.name } : {}),
600:         quoteId: existing.id,
601:       },
602:     });
603:     return ctx.json({ ok: true });
604:   }
```

### `front-end/islands/DashboardPage.tsx:250-257`

```
250:   return {
251:     icon: skin.icon,
252:     bg: skin.bg,
253:     fg: skin.fg,
254:     html: escapeHtml(n.title),
255:     time: fmtRel(n.createdAt, now, lang),
256:     ...(href ? { href } : {}),
257:   };
```

### `backend/src/paperwork/domain/coordinators/send-accepted-alert/mod.ts:40-100`

```
40: @Injectable()
41: export class SendAcceptedAlert {
42:   constructor(
43:     private quotes: QuoteStore,
44:     private customers: CustomerStore,
45:     private users: UserStore,
46:     private email: EmailService,
47:     private sms: SmsService,
48:     private commsLog: LogPaperworkMessage,
49:   ) {}
50: 
51:   async run(quoteId: string): Promise<{ ok: boolean; reason?: string }> {
52:     const quote = await this.quotes.get(quoteId);
53:     const [contractor, customer] = await Promise.all([
54:       this.users.get(quote.userId).catch(() => undefined),
55:       quote.customerId
56:         ? this.customers.getOwned(quote.customerId, quote.userId).catch(() =>
57:           undefined
58:         )
59:         : Promise.resolve(undefined),
60:     ]);
61:     if (!contractor) return { ok: false, reason: "no_contractor" };
62: 
63:     const lang: Lang = contractor.language === "es" ? "es" : "en";
64:     const customerName = customer?.name?.trim() ||
65:       quote.acceptedName?.trim() ||
66:       t(lang, "notify.fallbackClient");
67:     // P-50/P-27: project the job name in the CONTRACTOR's language for the
68:     // email body headline (subject + SMS use the shared builders below).
69:     const jobName = (quote.jobNameByLang?.[lang] ?? quote.jobName)?.trim() ||
70:       quote.summary?.trim() || "";
71:     const url = `${APP_URL}/quotes`;
72:     // P-50: with-job variant keeps the celebratory tone (es ¡…! 🎉 / en 🎉)
73:     // and the localized job name — shared source of truth in sms-i18n.ts.
74:     const subject = buildAcceptedAlertSubject({ customerName, quote, lang });
75: 
76:     let sentAny = false;
77:     if (contractor.email?.trim()) {
78:       try {
79:         const res = await this.email.send({
80:           to: contractor.email.trim(),
81:           subject,
82:           htmlBody: renderHtml({ customerName, jobName, url, lang }),
83:         });
84:         console.log(
85:           `[send-accepted-alert] quote ${quoteId} email → ${contractor.email}: ok=${res.ok}${
86:             res.reason ? ` (${res.reason})` : ""
87:           }`,
88:         );
89:         if (res.ok) {
90:           // P-32: deliberately NOT tagged with the quote's paperworkId — this
91:           // is a SELF-notification to the contractor, and tagging it against
92:           // the document made the receipts strip (and GET /messages consumers)
93:           // count it as a customer delivery. The content string still carries
94:           // the quote id for traceability.
95:           await this.commsLog.run({
96:             userId: quote.userId,
97:             customerId: quote.customerId,
98:             channel: "email",
99:             content:
100:               `quote ${quoteId} approved — completion email to ${contractor.email}`,
```

### `backend/src/paperwork/entrypoints/public-controller/e2e.test.ts:208-225`

```
208:     const out = await fetch(`http://localhost:${PORT}/quotes/${q.id}/inquiry`, {
209:       method: "POST",
210:       headers: { "content-type": "application/json" },
211:       body: JSON.stringify({
212:         question: "Can we start next week instead?",
213:         contactBack: "555-1234",
214:       }),
215:     }).then((r) => r.json());
216:     assertEquals(out.ok, true);
217: 
218:     // The inquiry itself must not decide the quote (no accepted/lost flip).
219:     // The public GET used to refetch DOES record an open and flips
220:     // sent → viewed (roadmap p.13 view tracking), so "viewed" is the
221:     // expected post-refetch status — not a decision.
222:     const refetched = await fetch(
223:       `http://localhost:${PORT}/quotes/${q.id}/public`,
224:     ).then((r) => r.json());
225:     assertEquals(refetched.status, "viewed");
```

### `front-end/islands/DashboardPage.tsx:251-257`

```
251:     icon: skin.icon,
252:     bg: skin.bg,
253:     fg: skin.fg,
254:     html: escapeHtml(n.title),
255:     time: fmtRel(n.createdAt, now, lang),
256:     ...(href ? { href } : {}),
257:   };
```

### `front-end/islands/DashboardPage.tsx:494-500`

```
494:           {tFor(lang, "dashboardPage.loadError")}: {s.error}
495:         </div>
496:       </>
497:     );
498:   }
499: 
500:   const { stats, jobs, quoteCards, pendingInvoices, customers, notifications } =
```
