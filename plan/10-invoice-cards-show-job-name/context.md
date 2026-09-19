# 1.10 🐛 NW-30 — Invoice cards show the job name (S) · slug `nw-30-invoice-card-job-name`

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 1.10) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

**Why.** The card row `InvoicesPage.tsx:1923-1928` shows initials, `{client} · {ref}`, the amount and a stage line. `jobName` is already
on the API row (`backend/src/paperwork/dto/invoice.ts:94-99`) and already used by the detail headline (`:1110`, `:1136`); the FE `Invoice`
type (`front-end/clients/dashboard.ts:98-139`) only exposes it through the index signature.

- [ ] RED — e2e: new `cypress/e2e/invoice-card-job-name.cy.ts`: `cy.loginAs`, `cy.apiCreateCustomer`, `cy.apiCreateInvoice({ customerId, amount: 45000, jobName: "Deck Staining", dueDate: <+30d> })`,
      `cy.visit("/invoices")`, `cy.get("[data-cy=invoice-card-job]").should("contain.text", "Deck Staining")`. Run → fails.
- [ ] EDIT `front-end/clients/dashboard.ts` inside `interface Invoice` (after line 104): `jobName?: string; description?: string;`.
- [ ] EDIT `InvoicesPage.tsx:1925-1927`: after the `qcard__client-name` div insert
      `{inv.jobName ? <div class="qcard__job" data-cy="invoice-card-job">{inv.jobName}</div> : null}`. Add `.qcard__job { font-size:13px; color: var(--fg); margin: 2px 0; }` to the invoices CSS (find where `.qcard__story` is styled).
- [ ] Unit/integration: `n/a — API already returns the field (pinned by invoice-parity.int.test.ts)`.

## Source items from the triage (`new-working-issues.md`, client's words + verdict + evidence)

- There is no real way to tell invoices apart other than customer name and price. There is a lot of wasted space that could show the job description. [p28]
  - **NW-30 🐛 CONFIRMED — the data exists; the row never projects it.** Effort S.
  - Evidence: card row `InvoicesPage.tsx:1923-1928` = initials, `{client} · {invoiceRef}`, `fmtMoney(amount)`, stage subline
    (`:1587-1619`); `EnrichedInvoice` `:135-145` has no job field. DTO carries `jobName` + `description`
    (`backend/src/paperwork/dto/invoice.ts`), persisted (`invoice-store/mod.ts:20-27`), derived from the quote
    (`invoice-controller:215-217`), and already read by the *detail* headline via `strField(inv,"jobName")` (`:1110`, `:1135-1137`).
    `front-end/clients/dashboard.ts:99-138` omits both fields (index signature).
  - Fix: add them to the `Invoice` type, project in `enrich()` (`:163-212`), render as the card title. Tests: none for the list row.

## Code at the cited lines (read from this tree while packaging)

### `front-end/islands/InvoicesPage.tsx:1923-1928`

```
1923:       <div class="qcard__av">{inv.initials}</div>
1924:       <div class="qcard__body">
1925:         <div class="qcard__client-name">{inv.client} · {inv.invoiceRef}</div>
1926:         <h3 class="qcard__title">{fmtMoney(inv.amount)}</h3>
1927:         <p class="qcard__story">{subline}</p>
1928:       </div>
```

### `backend/src/paperwork/dto/invoice.ts:94-99`

```
94:   @IsOptional() @IsString()
95:   jobName?: string;
96:   /** What the bill covers, one line per item — rendered on the public
97:    *  invoice when no quote supplies job details. */
98:   @IsOptional() @IsString()
99:   description?: string;
```

### `front-end/clients/dashboard.ts:98-139`

```
98: export interface Invoice {
99:   id: string;
100:   userId: string;
101:   /** Optional — standalone invoices created from the receivables dashboard
102:    *  have no quote behind them. */
103:   quoteId?: string;
104:   customerId?: string;
105:   amount?: number;
106:   issuedDate?: string;
107:   dueDate: string;
108:   status?:
109:     | "scheduled"
110:     | "draft"
111:     | "pending"
112:     | "sent"
113:     | "viewed"
114:     | "claimed"
115:     | "paid"
116:     | "void";
117:   paidAt?: string;
118:   createdAt: string;
119:   updatedAt: string;
120:   urgency?: {
121:     label: string;
122:     tone: "ok" | "warn" | "danger";
123:     daysOverdue?: number;
124:   };
125:   /** Scheduled-fire date for status=scheduled invoices. */
126:   scheduledFor?: string;
127:   installmentIndex?: number;
128:   installmentTotal?: number;
129:   remindersMuted?: boolean;
130:   /** Customer-side claim awaiting contractor confirmation. */
131:   paymentIntent?: {
132:     method: string;
133:     amount: number;
134:     reference?: string;
135:     claimedAt: string;
136:     claimedBy?: string;
137:   };
138:   [k: string]: unknown;
139: }
```

### `front-end/islands/InvoicesPage.tsx:1925-1927`

```
1925:         <div class="qcard__client-name">{inv.client} · {inv.invoiceRef}</div>
1926:         <h3 class="qcard__title">{fmtMoney(inv.amount)}</h3>
1927:         <p class="qcard__story">{subline}</p>
```
