# Data Model (implied backend) — Paperwork Monster

Reverse-documented from the Fresh 2 front-end's **typed API clients** (`clients/*.ts`),
**SSR/inline route interfaces** (`routes/{q,i,co,c,s}/*`), **shape/derive helpers**
(`lib/*`), and **static seeds** (`lib/*-seed.ts`). The clients' request/response
TypeScript interfaces ARE the implied entity shapes; the seeds are fallback fixtures
the pages render until the backend's analytics/agent endpoints come online.

Conventions discovered (apply globally unless noted):

- **Every stored entity carries `userId`** — all data is user-owned. The few shapes
  without one are either *composite reads* (`ProfileSnapshot`, `Job`, `DashboardStats`)
  or *public projections* (`QuotePublic`, `InvoicePublic`, `ContractPublic`,
  `ChangeOrderPublic`) where ownership is implicit in the route.
- **Money is INTEGER CENTS** everywhere a field is named `*Cents` or flows through
  `lib/format.ts` / `lib/payment-split.ts`. Some older DTO fields are just `amount` /
  `value` / `totalAmount` / `estimatedTotal` and the comments say these are cents too
  (e.g. `dashboard.ts`: "Money fields from the dashboard payload are CENTS"). Flagged
  per-field below where ambiguous.
- **Timestamps**: mixed. Most are ISO-8601 strings (`createdAt: string`). A handful are
  epoch-millis numbers (`ProfileUser.createdAt: number`, `auth.User.createdAt: number`,
  `Message.createdAt: number`). This inconsistency is real, not invented.
- **Multi-language fields** are `Record<langCode, string>` maps (`en` / `es`), suffixed
  `…ByLang`. Terms are stored in English and localized at render (`lib/term-i18n.ts`).
- **Payments are MANUAL-ONLY**: no card/merchant processing. Customer *claims* a payment
  (`paymentIntent` on the invoice) → contractor *confirms*. See Payment / Invoice below.

---

## 1. Entities

### 1.1 User / ProfileUser / AdminUserView

The authenticated account. Three projections exist across clients; they describe one
backend `User` row.

```ts
// lib/auth.ts (SSR session resolve) & clients/profile.ts ProfileUser
interface User {
  id: string;
  phoneNumber: string;          // E.164, the login identity (OTP)
  name?: string;
  email?: string;
  language?: "en" | "es";       // contractor's UI language
  superAdmin?: boolean;         // gates /admin; server-enforced
  createdAt: number;            // epoch ms
  updatedAt: number;
}

// clients/admin.ts — super-admin search projection
interface AdminUserView {
  id: string;
  name?: string;
  phoneNumber: string;
  businessName?: string;        // denormalized from BusinessIdentity
  superAdmin: boolean;
}
```

- **Auth artifacts (implied, not typed as entities):** a **Session** (cookie
  `pm_session` → backend looks it up via `GET /me`, header `x-session-id`), and an
  **OTP** challenge (phone + code, with `expired` / `rate_limited` states — see
  `verify.ts VerifyOtpError`). New-user detection lives on verify (`isNewUser`).

### 1.2 Business profile sub-entities (each keyed by `userId`, 1:1 with User)

```ts
// clients/profile.ts
interface BusinessIdentity {
  userId: string;
  businessName?: string;        // backend canonical; displayName mirrors it
  displayName?: string;
  legalName?: string;
  businessLicense?: string;
  logoFileId?: string;          // → FileRecord
  logoUrl?: string;
  tagline?: string;
  websiteUrl?: string;
  commsLanguage?: string;       // DEFAULT outbound language (first enabled)
  commsLanguages?: string[];    // set of send languages (drives multi-lang send)
  acceptedPaymentMethods?: Partial<Record<PaymentMethodKey, {
    enabled?: boolean;
    handle?: string;            // venmo @, etc.
    cashtag?: string;           // cashapp
    mailTo?: string;            // check
    routingNumber?: string;     // ach
    accountNumberMasked?: string;
    instructions?: string;
  }>>;
  createdAt: string;
  updatedAt: string;
}
// PaymentMethodKey = "check"|"venmo"|"zelle"|"cashapp"|"paypal"|"cash"|"ach"|"card"|"other"

interface BusinessAddress {
  userId: string;
  street?: string; unit?: string; city?: string; state?: string;
  postal?: string; country?: string;
  createdAt: string; updatedAt: string;
}

interface BusinessInsurance {
  userId: string;
  provider?: string; policyNumber?: string;
  coverageCents?: number;       // CENTS
  expiresAt?: string;
  insuranceFileId?: string;     // → FileRecord
  insuranceUploadedAt?: string;
  createdAt: string; updatedAt: string;
}

interface ContractDefaults {
  userId: string;
  paymentTermsDays?: number;
  depositPct?: number;
  warrantyDays?: number;
  createdAt: string; updatedAt: string;
}

// Tax block — TIN is never stored raw; backend hashes/masks.
interface TaxInfo { tinMasked?: string; w9FileId?: string; w9UploadedAt?: string; }
```

```ts
// Composite read returned by GET /profile — not a stored row, a join.
interface ProfileSnapshot {
  user: ProfileUser;
  identity: BusinessIdentity | null;
  address: BusinessAddress | null;
  insurance: BusinessInsurance | null;
  tax: TaxInfo | null;
  contractDefaults: ContractDefaults | null;
  references: unknown[];        // shape not yet exercised by the front-end
  initials: string;             // derived
}
```

### 1.3 Customer / Contact

One backend `Customer` row, surfaced as a thin DTO (`Customer`/`CustomerLite`) and as a
rollup-enriched analytics card (`CustomerCard`).

```ts
// clients/dashboard.ts Customer  &  clients/assistant.ts CustomerLite
interface Customer {
  id: string;
  userId: string;
  name: string;
  email?: string;
  phoneNumber?: string;
  // assistant.CustomerLite also allows arbitrary [k:string]:unknown
}

// clients/clients.ts — analytics rollup card (stored fields + DERIVED fields)
interface CustomerCard {
  id: string; userId: string;
  name: string; email?: string; phoneNumber?: string;
  address?: string; notes?: string; businessName?: string;
  segment?: "property_mgmt" | "homeowner" | "small_biz" | "hoa"; // stored
  vip?: boolean;
  createdAt: string; updatedAt: string;
  // ---- DERIVED / rolled-up (computed by /clients, NOT stored) ----
  lastWhen: string | null;          // last contact ISO
  lastWhenRel: string;              // humanized
  lastTone: "hot" | "warm" | "cold";
  balanceCents: number;             // CENTS; >0 owes, <0 credit
  balanceSub: string;
  activeJobs: number;
  jobsSub: string;
  status: "active" | "lead" | "owes" | "regular" | "cold";
  temp: number;                     // 0–100 "warmth"
  daysSinceContact: number;
  revenue12moCents: number;         // CENTS, trailing-12mo rollup
}
```

- **Segment enum** has a UI-only `"unsorted"` member (`ClientSegmentKey`) used as the
  null-bucket label; stored `segment` excludes it.
- Create body: `{ name, phoneNumber?, email?, businessName? }`.

### 1.4 Quote + QuoteLineItem

Stored `Quote`, surfaced three ways: lean assistant DTO, analytics-enriched `QuoteCard`,
and the public projection `QuotePublic`.

```ts
interface QuoteLineItem {
  description: string;
  quantity?: number;
  unit?: string;
  price?: number;               // CENTS (per-unit)
}

// clients/assistant.ts — lean stored shape
interface Quote {
  id: string; userId: string;
  customerId?: string;          // → Customer ("—"/unset = unlinked quote
                                //   (must NOT collapse into a phantom client))
  summary: string;
  description?: string;         // polished narrative / newline bullets
  lineItems: QuoteLineItem[];
  estimatedTotal: number;       // CENTS
  status: "draft" | "sent" | "accepted" | "declined" | "expired";  // STORED status
  createdAt: string; updatedAt: string;
}

// clients/quotes.ts — analytics card (stored + multi-lang + DERIVED engagement)
interface QuoteCard {
  id: string; userId: string; customerId?: string;
  customerName: string | null;
  summary?: string;
  jobName?: string;             // ≤3-word platform-wide identifier
  description?: string;
  descriptionByLang?: Record<string, string>;   // MULTI-LANG
  jobNameByLang?: Record<string, string>;        // MULTI-LANG
  summaryByLang?: Record<string, string>;        // MULTI-LANG
  lineItems?: QuoteLineItem[];
  estimatedTotal?: number;      // CENTS
  status?: string;              // stored status (see above)
  sentAt?: string; acceptedAt?: string; lostAt?: string;
  createdAt: string; updatedAt: string;
  // ---- DERIVED ----
  stage: "draft"|"sent"|"opened"|"cooling"|"stale"|"won"|"lost"; // engagement stage
  daysIn: number;
  opens: number;                // count of OpenEvents (scan)
  lastOpenAt: string | null;
  sentDays: number | null;
  decidedDays: number | null;
}
```

Important distinction: **`status`** (stored lifecycle: draft/sent/accepted/declined/
expired) vs **`stage`** (derived engagement: adds opened/cooling/stale/won/lost from
open-events + age). The seed (`lib/quotes-seed.ts`) only models the derived `Stage`.

```ts
// routes/q/[id].tsx — public projection (GET /quotes/:id/public)
interface QuotePublic {
  id: string;
  summary: string; description?: string; jobName?: string;
  descriptionByLang?: Record<string,string>;
  jobNameByLang?: Record<string,string>;
  summaryByLang?: Record<string,string>;
  customerId?: string;
  estimatedTotal?: number;      // CENTS
  lineItems: QuoteLineItem[];
  status?: string;              // "accepted" / "lost" gate the public UI
  acceptedAt?: string; createdAt?: string;
  contractor?: {                // JOINED from profile for the public doc
    name?: string; businessName?: string; phoneNumber?: string; email?: string;
    addressLine?: string; commsLanguage?: string; hasLogo?: boolean;
  };
  customer?: { name?: string };
}
```

**Quote engagement (OpenEvent)** — implied child rows powering `opens`/`lastOpenAt`/
the per-quote opens timeline. Seed shape (`lib/quotes-seed.ts`):

```ts
interface OpenEvent { when: string; time: string; device: string; }
// real backend would key these by quoteId + timestamp + device/userAgent.
```

### 1.5 Contract

```ts
// clients/contracts.ts — stored + server-derived `mood`
interface Contract {
  id: string; userId: string;
  quoteId: string;              // → Quote (1:1 source)
  customerId?: string;          // → Customer
  status?: string;              // stored; counts use draft|signed
  effectiveDate?: string; startDate?: string; estimatedCompletionDate?: string;
  totalAmount?: number;         // CENTS
  signedAt?: string;
  createdAt: string; updatedAt: string;
  mood?: "draft"|"starting-soon"|"active"|"wrapping-up"|"completed"|"stale"; // DERIVED
}

// components/contract-doc.tsx — public projection (GET /contracts/:id/public)
interface ContractPublic {
  id: string; quoteId?: string; customerId?: string;
  status?: string;              // "signed" / "declined" gate the public UI
  totalAmount?: number;         // CENTS
  effectiveDate?: string; startDate?: string; estimatedCompletionDate?: string;
  signedAt?: string;
  customerSignedName?: string;  // captured at e-sign
  contractor?: { name?; businessName?; phoneNumber?; email?; addressLine?;
                 state?; commsLanguage?; hasLogo? };
  customer?: { name?; phoneNumber?; email? };
  jobDetails?: {                // JOINED from the source quote
    summary?; jobName?; description?;
    descriptionByLang?: Record<string,string>;  // MULTI-LANG
    jobNameByLang?: Record<string,string>;
    summaryByLang?: Record<string,string>;
    lineItems?: QuoteLineItem[];
  };
  terms?: Term[];               // wizard-captured term grid
  createdAt?: string;
}
interface Term { stepId: string; label: string; value: string; } // value stored in EN
```

E-sign body: `POST /contracts/:id/sign  { name, signature /* dataURL */ }`.

### 1.6 ChangeOrder

```ts
// routes/co/[id].tsx — public projection (GET /change-orders/:id/public)
interface ChangeOrderPublic {
  id: string;
  description: string;
  deltaAmountCents: number;     // CENTS; +add / −credit, applied to the live invoice
  status: "pending" | "approved" | "declined";
  currentAmount?: number;       // CENTS (previous total)
  newAmount?: number;           // CENTS (proposed/new total)
  businessName?: string;
  commsLanguage?: "en" | "es";
  decidedAt?: string;
}
// Implied stored FKs (not in public projection): userId, contractId/invoiceId — the
// approve path writes the delta onto the bound invoice ("invoice_update_failed").
```

Approve/decline: `POST /change-orders/:id/{approve|decline}` (no body).

### 1.7 Invoice (+ paymentIntent claim)

```ts
// clients/dashboard.ts — stored
interface Invoice {
  id: string; userId: string;
  contractId?: string;          // OPTIONAL — standalone invoices have no contract
  customerId?: string;
  amount?: number;              // CENTS
  issuedDate?: string;
  dueDate: string;              // required
  status?: "scheduled"|"draft"|"pending"|"sent"|"viewed"|"claimed"|"paid"|"void";
  paidAt?: string;
  createdAt: string; updatedAt: string;
  urgency?: { label: string; tone: "ok"|"warn"|"danger"; daysOverdue?: number }; // DERIVED
  scheduledFor?: string;        // fire date for status=scheduled
  installmentIndex?: number;    // milestone N of…
  installmentTotal?: number;    // …M
  remindersMuted?: boolean;
  paymentIntent?: {             // CUSTOMER CLAIM awaiting contractor confirm
    method: string;
    amount: number;             // CENTS
    reference?: string;
    claimedAt: string;
    claimedBy?: string;
  };
}

// routes/i/[id].tsx — public projection (GET /invoices/:id/public)
interface InvoicePublic {
  id: string; contractId?: string; customerId?: string;
  status?: string; amount?: number; dueDate?: string; issuedDate?: string; paidAt?: string;
  installmentIndex?: number; installmentTotal?: number;
  paymentIntent?: { method; amount; reference?; claimedAt; claimedBy? };
  contractor?: Contractor & { acceptedPaymentMethods?: Record<string,{enabled?}> };
  customer?: { name?; email?; phoneNumber? };
  jobDetails?: { summary?; jobName?; description?;
                 jobNameByLang?; summaryByLang?; descriptionByLang? }; // JOINED + MULTI-LANG
  siblings?: Array<{ id; amount?; status?; paidAt?;                    // co-installments
                     installmentIndex?; installmentTotal? }>;
  acceptedMethods?: Array<{ method: string; handle?: string }>;        // JOINED from identity
}
```

Customer claim body: `POST /invoices/:id/claim-payment { method, reference?, claimedBy? }`
→ sets `status:"claimed"` + `paymentIntent`. Contractor later confirms (creates a
Payment, flips to `paid`). **No card processing** anywhere.

### 1.8 Payment

```ts
// clients/payments.ts — the contractor-confirmed payment record
interface Payment {
  id: string; userId: string;
  invoiceId: string;            // → Invoice
  amount: number;               // CENTS
  method: "cash"|"check"|"ach"|"card"|"venmo"|"zelle"|"cashapp"|"paypal"|"other";
  receivedAt: string;
  reference?: string;
  createdAt: string; updatedAt: string;
}
```

`method` includes `card`/`ach` in the enum, but per the manual-only rule these are
*recorded* methods (the contractor logs how they were paid), not processed in-app.

**PaymentSplit (derived, not stored)** — `lib/payment-split.ts` is the single source of
truth turning a contract total + a terms label into milestones:

```ts
interface PaymentSplitPart {
  role: "deposit"|"midpoint"|"milestone"|"completion"|"full";
  pct: number;                  // 0–100
  amountCents: number;          // CENTS; parts sum to exactly totalCents
}
```

### 1.9 Assistant: Conversation (thread), Message, JobOption

```ts
// clients/assistant.ts
interface Conversation {           // === the "AssistantThread"
  id: string; userId: string;
  customerId?: string; quoteId?: string; contractId?: string; invoiceId?: string;
  currentPhase: "quote" | "terms";  // AgentPhase
  title?: string; customerName?: string; preview?: string;
  hasUnreadEvent?: boolean;         // set by accept-contract; cleared on next read
  quoteStatus?: string;             // DENORMALIZED to avoid N+1 in the sidebar
  contractStatus?: string;          // DENORMALIZED
  invoiceStatus?: string;           // DENORMALIZED
  createdAt: string; updatedAt: string;
}

interface Message {
  id: string; conversationId: string;
  role: "user" | "assistant" | "system";
  kind?: "text"|"voice"|"image"|"action"|"action_card"|"wizard"
        |"phase_divider"|"continue_cta";
  content: string;
  createdAt: number;               // epoch ms
}

interface ConversationDetail {     // composite read for GET /agents/conversations/:id
  conversation: Conversation;
  messages: Message[];
  customer?: CustomerLite;
  contract?: { id; status?; totalAmount? };
}

// LLM-generated scope-of-work option (not persisted as its own row; the picked
// option seeds the quote's jobName/summary/description + …ByLang maps).
interface JobOption {
  id: string; jobName: string; summary: string; bullets: string[];
  byLang?: Record<string, { jobName: string; summary: string; bullets: string[] }>; // MULTI-LANG
}
```

### 1.10 Notification

```ts
// clients/dashboard.ts
interface Notification {
  id: string; userId: string;
  type: "quote_sent"|"quote_accepted"|"contract_signed"|"invoice_claimed"
      |"invoice_paid"|"invoice_overdue"|"customer_replied"|"generic";
  title: string; body?: string;
  entityType?: "quote"|"contract"|"invoice"|"customer"|"conversation";
  entityId?: string;
  read: boolean; readAt?: string;
  createdAt: string;
}
```

### 1.11 FileRecord (blob store)

```ts
// clients/files.ts — JSON+base64 upload
interface FileRecord {
  id: string; userId: string;
  filename: string; mimeType: string;
  sizeBytes: number; pageCount: number; sha256: string;
  createdAt: string;
}
// Referenced by logoFileId, insuranceFileId, w9FileId, and agents/chat payload.fileId.
```

### 1.12 ShortLink

```ts
// routes/s/[code].tsx — GET /s/:code resolver, then 302 → /q|/c|/i/:id
interface ShortLinkResolution { kind: "quote"|"contract"|"invoice"; id: string; }
// Implied stored row: { code, userId, kind, entityId, createdAt } keyed by short code.
```

### 1.13 Composite / analytics read models (computed, NOT stored rows)

```ts
// GET /jobs — a per-active-job rollup join (quote+contract+payments)
interface Job {
  id: string;
  customer: { id; name };
  quote: { id; summary; estimatedTotalCents };     // CENTS
  contract: { id; status? } | null;
  totalCents: number; paidCents: number; pctPaid: number;  // CENTS + derived %
  nextDueDate: string | null;
  status: "awaiting"|"on_track"|"awaiting_permit"|"overdue"|"complete";
  statusLabel: string;
}

// GET /analytics/dashboard — the whole-account rollup (all CENTS)
interface DashboardStats {
  customers: number;
  quotes:    { total; draft; sent; accepted };
  contracts: { total; draft; signed };
  invoices:  { total; pending; paid; overdue;
               agingBuckets: { current; aging1_14d; overdue15_30d; overdue30plus } };
  quotedValueCents: number;        // Σ estimatedTotal over status==='sent'
  awaitingResponse: number;
  revenue:  { ytdCents; lastMonthCents; monthOverMonthPct; sparkline12mo: number[/*12*/] };
  payments: { receivedYtdCents; methodMixCents: Record<string,number>;
              topPayors: Array<{ customerId; totalCents }> };
}

// GET /analytics/quotes/win-rate, /insight, /clients/top, /clients/segments
interface WinRate { windowDays; decided; won; lost; winRate: number|null; }
interface Insight { text: string;
  kind: "open_count"|"median_days_to_decide"|"best_day_of_week"|"static_fallback"; }
interface TopClient { customerId; name; revenue12moCents; rank; barPct; }   // CENTS
interface ClientSegmentRow { key: ClientSegmentKey; label; count; pct; }
```

---

## 2. Cardinality at load (seed fixtures)

All seeds are **deterministic & hardcoded** (literal arrays/objects; copy pulled from
i18n keys via `tFor`, numbers inline). Nothing is randomly generated. They are *fallback
fixtures* the pages show until the live analytics/agent endpoints return.

| Seed source | Export | Count | Notes |
|---|---|---|---|
| `lib/clients-seed.ts` | `CLIENTS` | **12** | the canonical demo client roster |
| | `STORIES` / `SINCE_DAYS` | 12 / 12 | keyed by client name (parallel maps) |
| | `FILTERS` | 6 | all + 5 statuses; counts derived from `CLIENTS` |
| | `TOP_CLIENTS` | 5 | hardcoded revenue bars |
| | `SEGMENTS` | 4 | property mgmt / homeowners / small biz / HOAs |
| `lib/quotes-seed.ts` | `QPIPELINE` | **15** | 2 draft, 7 out-for-response, 4 won, 2 lost |
| | `QSTORIES` | 9 | only the non-decided quotes |
| | `buildOpens` fixtures | 7 | OpenEvent timeline pool, sliced per quote |
| `lib/dash-seed.ts` | `SEED_JOBS` | 5 | |
| | `SEED_QUOTES` | 4 | dashboard "pending quotes" strip |
| | `SEED_OUTSTANDING` | 3 | receivables strip |
| | `SEED_ACTIVITY` | 4 | activity feed |
| | `SEED_KPIS` | 1 obj | fixed KPI tile values |
| `lib/asst-seed.ts` | `seedThreads` | 3 groups / **7** items | t1–t7; `seedTotal()` returns 12 (7 + hardcoded 5) |

Seed *UI-row* types (`JobRow`, `QuoteRow`, `OutstandingRow`, `ActivityEntry` from
`components/DashSections.tsx`; `ThreadGroup`/`ThreadEntry`, `Client`, `Quote`/`Stage`)
are **presentational shapes**, not backend DTOs — they carry display gradients/labels and
must not be confused with the real entities above.

---

## 3. Endpoint map (verb + path, grouped by feature)

### Auth / session (`landing.ts`, `verify.ts`, `auth.ts`)
- `POST /auth/send-otp` `{ phoneNumber, language? }` → `{ sent: true }`
- `POST /auth/verify-otp` `{ phoneNumber, code }` → `{ sessionId, userId, isNewUser }`
  (client maps to a discriminated union; routes new users → `/assistant?onboard=1`)
- `GET  /me` → `User` (SSR session resolve; header `x-session-id`)
- `GET  /me/wipe` → `{ ok, deleted }` (irreversible account+data wipe)
- `PUT  /me` → `ProfileUser` (name/email/language)

### Profile / business (`profile.ts`)
- `GET  /profile` → `ProfileSnapshot`  *(also used by `dashboard.ts` as `Profile`)*
- `PUT  /profile/identity` → `BusinessIdentity`
- `PUT  /profile/address` → `BusinessAddress`
- `PUT  /profile/insurance` → `BusinessInsurance`
- `PUT  /profile/tax` → `TaxInfo`

### Dashboard / analytics (`dashboard.ts`)
- `GET  /analytics/dashboard` → `DashboardStats`
- `GET  /jobs` → `Job[]`
- `GET  /notifications?limit=` → `Notification[]`
- `GET  /notifications/unread-count` → `{ count }`
- `POST /notifications/:id/read` ; `POST /notifications/read-all`

### Customers / clients analytics (`clients.ts`)
- `GET  /clients` → `CustomerCard[]`   *(rollup-enriched)*
- `GET  /customers` → `Customer[]` / `CustomerLite[]`
- `POST /customers` → `CustomerCard` ; `PUT /customers/:id` → `CustomerCard`
- `GET  /analytics/clients/top?limit=` → `{ results: TopClient[] }`
- `GET  /analytics/clients/segments` → `{ segments: ClientSegmentRow[] }`

### Quotes (`quotes.ts`, `assistant.ts`, public route)
- `GET  /quotes?status=` → `QuoteCard[]`
- `GET  /quotes/:id` → `QuoteCard` / `Quote`
- `PUT  /quotes/:id` → `QuoteCard` ; `DELETE /quotes/:id` → `{ ok }`
- `POST /quotes/:id/email` `{ to?, from? }` → `{ ok }`
- `GET  /analytics/quotes/win-rate?days=` → `WinRate`
- `GET  /analytics/quotes/insight` → `Insight`
- **Public:** `GET /quotes/:id/public` → `QuotePublic` ;
  `POST /quotes/:id/accept` `{ name?, signature? }` ;
  `POST /quotes/:id/decline` `{ reason?, note?, name? }` ;
  `POST /quotes/:id/inquiry` `{ question, contactBack?, name? }`

### Contracts (`contracts.ts`, public route)
- `GET  /contracts?status=` → `Contract[]` (each with derived `mood`)
- `GET  /contracts/:id` → `Contract` ; `PUT /contracts/:id` ; `DELETE /contracts/:id`
- **Public:** `GET /contracts/:id/public` → `ContractPublic` ;
  `POST /contracts/:id/sign` `{ name, signature }`

### Change orders (public route)
- `GET  /change-orders/:id/public` → `ChangeOrderPublic`
- `POST /change-orders/:id/approve` ; `POST /change-orders/:id/decline`

### Invoices (`dashboard.ts`, public route)
- `GET  /invoices?status=` → `Invoice[]`
- `POST /invoices` `{ customerId?, amount?(CENTS), dueDate, issuedDate?, status? }` → `Invoice`
- **Public:** `GET /invoices/:id/public` → `InvoicePublic` ;
  `POST /invoices/:id/claim-payment` `{ method, reference?, claimedBy? }`

### Payments (`payments.ts`)
- `GET  /payments` → `Payment[]`
- `GET  /payments?method=<m>` → `Payment[]`
- `GET  /payments?invoiceId=<id>` → `Payment[]`
- `GET  /payments/:id` → `Payment`

### Assistant / agents (`assistant.ts`)
- `GET  /agents/conversations?limit=` → `Conversation[]` (404-safe → `[]`)
- `GET  /agents/conversations/:id` → `ConversationDetail`
- `POST /agents/conversations` → `Conversation`
- `POST /agents/conversations/:id/transition-to-terms` → `ConversationDetail`
- `POST /agents/conversations/:id/lock-quote` `{ quoteId }`
- `POST /agents/conversations/:id/accept-contract` `{ contractId }`  *(dev simulate sign)*
- `POST /agents/conversations/:id/send-contract` `{ contractId, channel, language? }`
- `POST /agents/conversations/:id/send-invoice`
- `POST /agents/conversations/:id/bind-customer` `{ customerId }`
- `POST /agents/conversations/sample-quote` → `{ quoteId, created }`
- `POST /agents/chat` `{ conversationId?, content?, kind?, payload? }` → `ChatResult`
- `POST /agents/wizard/answer` ; `POST /agents/wizard/back`
- `POST /agents/job-details/polish` `{ raw, priceCents? }`
- `POST /agents/job-details/options` `{ raw, priceCents? }` → `{ options: JobOption[] }`
- `POST /agents/job-details/prices` `{ raw }`
- `POST /agents/job-details/professionalize` `{ text }`
- `POST /agents/job-details/translate` `{ texts, to }` → `{ texts }`
- `GET  /customers` (customer picker)

### Files (`files.ts`)
- `POST /files` `{ filename, mimeType, base64 }` → `FileRecord`

### Short links (route)
- `GET  /s/:code` → `ShortLinkResolution` (302 redirect)

### Admin (super-admin) (`admin.ts`)
- `GET  /admin/users?q=<phone>` → `AdminUserView[]`
- `POST /admin/users/:id/grant` ; `POST /admin/users/:id/revoke`
- `POST /admin/impersonate/:id` ; `POST /admin/stop-impersonating` → `ImpersonationResponse`
- `GET  /admin/whoami` → `WhoAmI`

### Public-logo (referenced by `/q` and `/i` routes)
- `GET  /api/public-logo/quote/:id` , `GET /api/public-logo/invoice/:id` (image proxy)

---

## 4. Consumption reverse-index (page/island → entity)

Derived from which client each island imports (`grep` over `islands/` + `routes/`).

| Island / route | Entities consumed | Endpoints |
|---|---|---|
| `DashboardPage` | `DashboardStats`, `QuoteCard[]`, `Job[]`, `ProfileSnapshot` | `/analytics/dashboard`, `/quotes`, `/profile` (+ `/jobs`) |
| `DashSidebar` (mounted on **every** authed page) | `DashboardStats`, `ProfileSnapshot`, unread `count` | `/analytics/dashboard`, `/profile`, `/notifications/unread-count` — via `lib/dash-cache.ts` |
| `DashTopbar` | `Notification[]`, unread `count` | `/notifications*` |
| `QuotesPage` | `QuoteCard[]`, `WinRate`, `Insight` | `/quotes`, `/analytics/quotes/*` |
| `QuoteCard`/`QuoteTrack`/`DeleteQuoteButton` | `QuoteCard` | `/quotes/:id`, `DELETE /quotes/:id` |
| `ContractsPage` (+ `ContractCard`/`ContractTrack`) | `Contract[]`(→`ContractCard`), `QuoteCard`, `CustomerCard` | `/contracts`, `/quotes`, `/clients` |
| `InvoicesPage` | `Invoice[]`, `CustomerCard`, `QuoteCard`(jobDetails) | `/invoices`, `/clients` |
| `PaymentsPage` | `Payment[]`, `DashboardStats` | `/payments`, `/analytics/dashboard` |
| `ClientsPage`/`ClientsBoard` | `CustomerCard[]`, `TopClient[]`, `ClientSegmentRow[]` | `/clients`, `/analytics/clients/*` |
| `AsstChat`/`AsstThreads`/`AsstComposer`/`Composer`/`ChatHeaderLive` | `Conversation[]`, `ConversationDetail`, `Message[]`, `Quote`, `Contract`, `CustomerCard`, `FileRecord`, `DashboardStats`(overdue gate) | `/agents/*`, `/quotes/:id`, `/contracts`, `/clients`, `/files` |
| `SettingsPage`/`SetupChecklist` | `ProfileSnapshot`, `BusinessIdentity/Address/Insurance/Tax`, `FileRecord` | `/profile*`, `/files` |
| `AdminPage`/`ImpersonationBanner` | `AdminUserView`, `WhoAmI`, `ImpersonationResponse` | `/admin/*` |
| `LoginForm`/`LandingScripts`/`ContactForm` | OTP send | `/auth/send-otp` |
| `CodeInput` | OTP verify | `/auth/verify-otp` |
| **Public** `routes/q/[id]` + `PublicQuoteActions`/`PublicAcceptQuote` | `QuotePublic` | `/quotes/:id/public`, accept/decline/inquiry |
| **Public** `routes/c/[id]` + `PublicContractView`/`PublicSignContract` | `ContractPublic` | `/contracts/:id/public`, `/sign` |
| **Public** `routes/i/[id]` + `PublicInvoiceClaim` | `InvoicePublic` | `/invoices/:id/public`, `/claim-payment` |
| **Public** `routes/co/[id]` + `PublicChangeOrderActions` | `ChangeOrderPublic` | `/change-orders/:id/public`, approve/decline |
| **Public** `routes/s/[code]` | `ShortLinkResolution` | `/s/:code` |

---

## 5. Data-shape hazards (design-time flags — not benchmarked)

Each is a read pattern that gets expensive on a real backend at scale. Mitigation tagged
**[cache / point-read / denormalize — don't scan]**.

1. **`DashboardStats` is a whole-account rollup rendered on every authed page.**
   It aggregates counts across *all* quotes, contracts, invoices, customers, plus
   `quotedValueCents` (Σ over sent quotes), `revenue.sparkline12mo` (12-month paid-invoice
   rollup), `payments.methodMixCents` and `topPayors` (Σ over all payments). The front-end
   already de-dupes via `lib/dash-cache.ts` (single-flight + sessionStorage warm start)
   **specifically because** `DashSidebar` mounts on every route and was firing
   `/profile`+`/analytics/dashboard` per navigation (audit1 #20). **[precompute these
   counters incrementally / cache; never recompute by scanning on each request].**

2. **Sidebar unread badge — `/notifications/unread-count` per page mount.** A global
   count rendered in the app shell. **[maintain a counter; point-read].**

3. **`GET /clients` returns rollup-enriched `CustomerCard[]`** — every card carries
   `balanceCents`, `activeJobs`, `revenue12moCents`, `temp`, `daysSinceContact`, `status`,
   `lastWhen`, each a per-customer aggregate over that customer's invoices/payments/jobs.
   Listing N customers ⇒ N rollups. Plus `/analytics/clients/top` and `/segments` are
   separate whole-account aggregates. **[denormalize rollups onto the customer row;
   refresh on write].**

4. **`GET /quotes` returns engagement-derived `QuoteCard[]`** — `opens`/`lastOpenAt`
   require scanning OpenEvent rows per quote; `stage`/`daysIn`/`decidedDays` are derived
   from timestamps + opens. Plus `/analytics/quotes/win-rate` and `/insight` scan decided
   quotes. **[store a denormalized `opensCount`/`lastOpenAt` on the quote; bucket counts].**

5. **`GET /jobs`** — each `Job` sums payments to compute `paidCents`/`pctPaid`/`nextDueDate`
   across the active set, joining quote+contract+payments. **[materialize the job rollup].**

6. **`ClientsPage` filter counts** (`FILTERS` — all + per-status) are computed in the seed
   by `CLIENTS.filter(...).length`. On a real backend that's a count-per-status bucket over
   the whole roster, recomputed on each visit. **[status-bucketed counters].**

7. **Public composite reads fan out a join per page load.** `InvoicePublic` joins
   invoice → contract → quote(jobDetails, multi-lang) → customer → contractor profile →
   accepted payment methods → sibling installments. `QuotePublic`/`ContractPublic` join
   the contractor profile + customer. These are customer-facing, uncached, hit from SMS/
   email links (potentially bursty). **[serve from a denormalized public projection /
   point-read, not a live multi-table join].** The codebase already shows the intended
   pattern: `Conversation` **denormalizes** `quoteStatus`/`contractStatus`/`invoiceStatus`
   onto the thread row, explicitly "to drive the sidebar chip without an N+1."

8. **Invoice `urgency` + dashboard `agingBuckets`** are date-derived over all open
   invoices. Recomputing aging on every dashboard load scans the receivables. **[bucket on
   write / scheduled recompute].**

9. **Contract list `mood`** is derived server-side per row (`deriveMood`) and the front-end
   then groups all contracts by mood into three tracks — full-list read with no pagination
   visible. **[paginate / pre-bucket if contract volume grows].**

---

## Open questions / ambiguities

- **`status` vs `stage`/`mood` source of truth.** Quotes expose a stored `status`
  (draft/sent/accepted/declined/expired) AND a derived `stage`
  (adds opened/cooling/stale/won/lost). Contracts expose stored `status` AND derived
  `mood`. The exact persisted `status` value-set for contracts/invoices beyond what the
  counts use (`draft`/`signed`; the 8-value invoice union) isn't fully pinned by the
  clients — the public projections only ever check a subset ("signed"/"declined",
  "accepted"/"lost", "paid"/"claimed").
- **Timestamp type inconsistency is real:** `User`/`ProfileUser`/`Message` use epoch-ms
  `number`; nearly everything else uses ISO `string`. Not resolved here.
- **`ProfileSnapshot.references: unknown[]`** — shape never exercised by the front-end.
- **ChangeOrder stored FKs** (`userId`, `contractId`/`invoiceId`) are inferred from the
  approve path ("invoice_update_failed") — the only typed view is the public projection,
  which omits them.
- **OpenEvent / quote-opens persistence** is only modeled in the seed; the real row shape
  (device/userAgent/IP/timestamp keying) isn't declared in any client.
- **Money units on bare `amount`/`value`/`totalAmount`/`estimatedTotal`/`price` fields**:
  treated as CENTS here per the `dashboard.ts` comment and `lib/format.ts` contract, but
  these fields are not individually annotated, so a few could be dollars on the wire — a
  point to confirm against the backend DTOs.
