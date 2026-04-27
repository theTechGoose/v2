# Backend Reference — `v2/backend`

> **Target:** `v2/backend` (the new, partial Deno + Danet rebuild).
> The old `/backend` at the project root is a **port source only** — fields, business rules, and DTO shapes are referenced for fidelity, but no code is preserved verbatim.

This document is the gap analysis between the **frontend prototype** (Landing, Dashboard, Assistant) and the **current state of `v2/backend`**, plus a recommended module roadmap to close the gap. The Assistant chat is intentionally deferred to a future `agents` module — a stub surface is sketched in §4 so the frontend can target stable URLs.

---

## §1 — Current state of `v2/backend`

### 1.1 Module list

```
v2/backend/
├── bootstrap/
│   ├── mod.ts            # Danet bootstrapServer({ port, swagger:false })
│   └── config.ts         # PORT env var (default 3000)
├── deno.json             # tasks: start | dev | test
├── fixtures/bruno/       # HTTP fixtures (bruno API client) — per-module folders
└── src/
    ├── core/             # Generic Repository<T>, KV singleton, Entity base, parseAs<T>()
    ├── crm/              # customer, account, entry  (full CRUD + balance coordinator)
    ├── paperwork/        # quote, contract, invoice, view, payment-terms (full CRUD)
    └── communication/    # conversation, message  (full CRUD)
```

### 1.2 Endpoint inventory (current)

| Module | Method + Path | Purpose |
|---|---|---|
| **CRM** | `POST /customers` · `GET /customers` · `GET /customers/:id` · `PUT /customers/:id` · `DELETE /customers/:id` | Customer CRUD |
| | `POST /accounts` · `GET /accounts[?customerId=]` · `GET /accounts/:id` · `GET /accounts/:id/balance` · `PUT /accounts/:id` · `DELETE /accounts/:id` | Account CRUD + balance computation |
| | `POST /entries` · `GET /entries[?accountId=&transactionId=]` · `GET /entries/:id` · `PUT /entries/:id` · `DELETE /entries/:id` | Journal entry CRUD |
| **Paperwork** | `POST /quotes` · `GET /quotes` · `GET /quotes/:id` · `PUT /quotes/:id` · `DELETE /quotes/:id` | Quote CRUD |
| | `POST /contracts` · `GET /contracts` · `GET /contracts/:id` · `PUT /contracts/:id` · `DELETE /contracts/:id` | Contract CRUD |
| | `POST /invoices` · `GET /invoices` · `GET /invoices/:id` · `PUT /invoices/:id` · `DELETE /invoices/:id` | Invoice CRUD |
| | `POST /views` · `GET /views[?paperworkType=&paperworkId=]` · `GET /views/summary/:type/:id` · `GET /views/:id` · `PUT /views/:id` · `DELETE /views/:id` | Document view tracking |
| | `POST /payment-terms` · `GET /payment-terms` · `GET /payment-terms/:id` · `GET /payment-terms/:id/check` · `GET /payment-terms/:id/resolve?total=` · `PUT /payment-terms/:id` · `DELETE /payment-terms/:id` | Payment schedule templates |
| **Communication** | `POST /conversations` · `GET /conversations` · `GET /conversations/:id` · `PUT /conversations/:id` · `DELETE /conversations/:id` | Conversation CRUD |
| | `POST /messages` · `GET /messages[?conversationId=]` · `GET /messages/:id` · `PUT /messages/:id` · `DELETE /messages/:id` | Message CRUD |

### 1.3 DTO shapes (current)

```ts
// crm/dto/customer.ts
{ id, name, email?, phoneNumber?, address?, notes?, createdAt, updatedAt }

// crm/dto/account.ts
{ id, name, customerId?, currency?, description?, createdAt, updatedAt }

// crm/dto/entry.ts
{ id, accountId, amount: number, occurredAt: ISOString,
  transactionId?, description?, reference?, createdAt, updatedAt }

// paperwork/dto/quote.ts
{ id, customerId?, summary, lineItems: { description, quantity, unit, price }[],
  estimatedTotal?, status?, createdAt, updatedAt }

// paperwork/dto/contract.ts
{ id, quoteId, customerId?, status?,
  effectiveDate?, startDate?, estimatedCompletionDate?,
  totalAmount?, signedAt?, createdAt, updatedAt }

// paperwork/dto/invoice.ts
{ id, contractId, dueDate, customerId?, amount?, issuedDate?,
  status?, paidAt?, createdAt, updatedAt }

// paperwork/dto/payment-terms.ts
{ id, name, installments: { percent: 0–100, dueDate, label?, note? }[],
  description?, createdAt, updatedAt }

// paperwork/dto/view.ts
{ id, paperworkType: 'quote'|'contract'|'invoice', paperworkId,
  viewedAt, viewerId?, viewerEmail?, userAgent?, ipAddress?,
  referrer?, durationMs?, createdAt, updatedAt }

// communication/dto/conversation.ts
{ id, title?, customerId?, createdAt, updatedAt }

// communication/dto/message.ts
{ id, conversationId, role: 'user'|'assistant'|'system',
  channel: 'text'|'email'|'web'|'phone'|'in_person',
  content, subject?, fromAddress?, toAddress?, createdAt, updatedAt }
```

### 1.4 What's NOT in `v2/backend` yet

| Concern | Status | Impact on frontend |
|---|---|---|
| **`users` module (auth + identity)** | Not implemented — every endpoint is anonymous; no user record | Dashboard cannot identify the logged-in contractor |
| **Per-user scoping** | DTOs have no `userId` field; data is global | Listings would expose all tenants' data |
| **`profile` module (business identity, address, insurance, tax, contract defaults, references)** | No module | No business name / address / W-9 for letterhead, customer-facing pages, or default contract terms |
| **Notification inbox** | No module | Topbar bell + Dashboard activity ticker have no source |
| **Analytics** | No module / coordinator | KPI tiles & sparkline have no source |
| **Email send** | No module | Cannot deliver quote/contract/invoice to customer |
| **File storage** | No module | Cannot upload W-9 (referenced by old contract flow) |
| **Public/shareable views** | No `/public` variants | Customer-facing quote / contract sign / invoice view not reachable without login |
| **Agents (LLM)** | No module | Assistant page chat has no backend (deferred — see §4) |
| **SSE / event stream** | No streaming endpoints | Live activity ticker on Dashboard has to poll |
| **Search** | No module | Topbar `⌘K` search has nothing to call |
| **PDF generation** | No module | "Send PDF" buttons can't render |
| **Health check** | No `/health` endpoint | Cannot front with a load balancer |

---

## §2 — What the **Landing page** needs

**The landing page IS the login.** The phone-input form in the contact section is the **OTP-request step** — not a marketing lead capture. On submit, the page transitions (or routes) to a separate **6-digit code entry screen** that completes login and drops the session cookie.

### 2.A Login flow (landing → code-verify)

```
[Landing page]                                 [Verify code page]
  enter phone   ─── POST /auth/send-otp ───→     enter 6 digits
                ←── { sent: true } ─────────     POST /auth/verify-otp
                                                 ←── { sessionId, contractorId }
                                                 set cookie → redirect /dashboard
```

Endpoints (public, no auth guard):

```
POST /auth/send-otp        body: { phoneNumber, language? }      → { sent: true }
POST /auth/verify-otp      body: { phoneNumber, code }           → { sessionId, userId }
POST /auth/logout          header: x-session-id                  → { ok: true }
```

**Terminology clarification.** Two things are easy to confuse:

- **OTP code** — the 6 numeric digits the user types (e.g. `"123456"`). That's it. Nothing else. Just digits.
- **OTP record** — the **server-side row** we save in KV under `["otp", phoneNumber]` while the code is in flight. The record bundles the code together with metadata: `{ phoneNumber, code, language, attempts, sentAt }`. It expires after 5 minutes.

When this doc says "the OTP record carries language", that means the **record** has a `language` field. The code itself is still just digits.

The `language` field on the `POST /auth/send-otp` body is **the language the user has selected on the landing page's EN/ES toggle at the moment they tap submit**. The server stores it on the OTP **record** (alongside the code, attempts, etc.) and uses it for two purposes:

1. **Localize the SMS body** the user is about to receive (`"Your code is 123456"` vs `"Tu código es 123456"`).
2. **Seed `User.language`** if and only if `verify-otp` ends up creating a new user — see §3.A's "First-time signup language capture" callout below.

The frontend should always send `language` (defaulting to `'en'` if the toggle hasn't been touched) so an existing user who switches the landing toggle to Spanish gets a Spanish SMS this one time, even though their stored `User.language` stays as it was.

The `verify-otp` response sets an `x-session-id` HTTP-only cookie; subsequent requests forward it. **First-time signups** auto-create a User record (id derived from phone, `language` copied from the OTP record) — the rest of the profile (name, business identity, address, etc.) is filled in via `/dashboard/settings`; see §3.A and §3.C.

**Public endpoints** (no guard): `POST /auth/send-otp`, `POST /auth/verify-otp`, anything ending in `/public` (see §3.G).

The verify-code page itself is documented at `pages/verify/root.md` + `pages/verify/components/code-input.md`. It's a separate Fresh route (`/verify`), not a modal on the landing page, so it can be deep-linked when the user gets the SMS on a different device.

---

## §3 — What the **Dashboard page** needs

The Dashboard (`Paperwork Monsters Dashboard.html`) is the contractor's authenticated home. It needs:

### 3.A `users` module (NEW) — auth + identity

Owns the entire authentication boundary plus the identity bits that belong to the *person* (not the business). The previous monolithic "ContractorProfile" was doing too much — splitting it lets each aggregate be PUT independently, and isolates auth concerns from business-data concerns.

**Naming convention adopted from here forward:** `userId` is the canonical foreign key for the authenticated principal. `contractorId` (used in earlier drafts of this doc + the existing v2 DTOs) is the **same value** — kept as a domain-language alias in places where "contractor" reads better, but in code, prefer `userId`. New modules write `userId`; existing v2 DTOs that already say `contractorId` can either rename or keep the alias (cheap because nothing has shipped yet).

#### Endpoints

```
POST  /auth/send-otp        body: { phoneNumber, language? }      → { sent: true }       (public)
POST  /auth/verify-otp      body: { phoneNumber, code }           → { sessionId, userId }(public)
POST  /auth/logout          header: x-session-id                  → { ok: true }         (auth)

GET   /me                                                          → User                 (auth)
PUT   /me                   body: Partial<User>                    → User                 (auth — updates name/email/language)
DELETE /me                                                         → { ok: true }         (auth — account closure; cascades or soft-deletes)
```

The auth endpoints (`/auth/*`) live under the users module rather than a separate `auth` module — they're the lifecycle of a `User`, not a separate concern. Keep the URL prefix `/auth/*` for clarity to API consumers.

#### First-time signup language capture

The landing page's EN/ES toggle (see `pages/landing/components/i18n.md`) holds the user's choice **before they have an account**. To preserve that choice through to their `User` record:

1. Landing's contact-form sends `{ phoneNumber, language: langSignal.value }` to `POST /auth/send-otp`.
2. Server generates the 6-digit code (just digits, e.g. `"123456"`) **and** writes an OTP record:
   ```ts
   ["otp", "+15125551234"] → { phoneNumber, code: "123456", language: "es", attempts: 0, sentAt }
   ```
   The `language` lives on the *record*, not on the code.
3. The SMS body is rendered in that language and dispatched containing only the code.
4. On `POST /auth/verify-otp`:
   - Server looks up the OTP record by phone, validates the typed `code`, then reads the record's `language`.
   - If a User with this phone **already exists**: ignore the record's `language` (the user has settings; respect them).
   - If a User does **not** exist: create one and **copy `language` from the OTP record into `User.language`**. This becomes the new user's default for SMS, email, and dashboard rendering.
5. Subsequent changes go through `PUT /me` (the `/dashboard/settings` page surfaces this; see §3.A's settings note below).

So an existing English user who switches the landing toggle to ES gets a Spanish SMS this one time (because the OTP record carried `language: 'es'`) but keeps `User.language === 'en'` after verifying.

#### Settings — language preference

The `/dashboard/settings` page exposes `User.language` as an editable preference (the section is "Account → Language"). Saving fires `PUT /me { language }`. The dashboard re-renders in the new language on the next request (Fresh's SSR reads `User.language` at request time and seeds `langSignal` accordingly — same pattern as the landing's `Accept-Language` fallback in `i18n.md`).

#### `User` DTO

```ts
// users/dto/user.ts
{
  id:           string,        // canonical user id; === contractorId in domain language
  phoneNumber:  string,        // login phone, normalized E.164 (e.g. "+15125551234")
  name?:        string,        // personal display name, e.g. "Diego R."
  email?:       string,        // account email (login is phone-based; email is for receipts/notices)
  language?:    'en' | 'es',   // UI language preference
  createdAt:    string,
  updatedAt:    string,
}
```

**Required-on-signup:** only `id`, `phoneNumber`, `createdAt`, `updatedAt`. Auto-created on first successful `verify-otp`.

#### Storage

| Key | Value | TTL |
|---|---|---|
| `["user", userId]`                           | `User` record                            | none |
| `["user_by_phone", phoneNumber]`             | `userId` (reverse lookup)                | none |
| `["session", sessionId]`                     | `{ userId, createdAt }`                  | 30 days |
| `["otp", phoneNumber]`                       | `{ code, attempts, sentAt, language }`   | 5 min |
| `["otp_attempts", phoneNumber]`              | `number` (rate-limit counter)            | 15 min |

#### Auth guard

`@Injectable() AuthGuard` reads `x-session-id` from cookie or header, looks up `["session", sessionId]`, attaches `userId` to the request scope, and exposes it via `@CurrentUser()` parameter decorator (or `@CurrentContractor()` if you prefer the domain term — they're aliases that resolve to the same string).

`@SkipAuth()` decorator marks endpoints the guard ignores (the three `/auth/*` endpoints + everything ending in `/public` — see §3.G).

### 3.B `userId` on every domain entity (BLOCKING)

Every existing v2 DTO needs a `userId: string` field, populated automatically from the auth context in the controller (never trusted from the request body). Listings filter by `userId`. Cross-tenant access throws `ForbiddenError`.

| DTO | Field to add |
|---|---|
| `crm/dto/customer.ts`              | `userId: string` |
| `crm/dto/account.ts`               | `userId: string` |
| `crm/dto/entry.ts`                 | `userId: string` |
| `paperwork/dto/quote.ts`           | `userId: string` |
| `paperwork/dto/contract.ts`        | `userId: string` |
| `paperwork/dto/invoice.ts`         | `userId: string` |
| `paperwork/dto/payment-terms.ts`   | `userId: string` |
| `paperwork/dto/view.ts`             | (kept anonymous — recipients are customers, not the user) |
| `communication/dto/conversation.ts`| `userId: string` |
| `communication/dto/message.ts`     | (inherit through `conversationId`) |

Add a secondary KV index per resource: `["customer_by_user", userId, customerId]` so list-by-user doesn't full-scan. The old backend's pattern in `backend/src/foundation/domain/data/*` is the reference (it uses `contractorId`; same idea).

### 3.C `profile` module (NEW) — business identity, broken into sub-aggregates

The dashboard's sidebar footer (`"Diego R. · Riley Roofing Co."`) reads `User.name` from §3.A and `BusinessIdentity.businessName` from this module. The Topbar greeting reads only `User.name`.

**Why split:** the old monolithic `ContractorProfile` mixed identity, business info, compliance docs, contract defaults, and a W-9 file pointer into one aggregate. Different update lifecycles (insurance might be edited yearly, contract defaults rarely, business name once), different visibility rules (`paymentInstructions` is private, `businessName` goes on every customer-facing doc), and different validation needs. Splitting into sub-aggregates lets each one PUT independently and makes the public-facing read endpoint trivial to filter.

Each sub-aggregate is a separate document, all keyed by `userId`. The convenience `GET /profile` endpoint fans out across them so the dashboard fetches with one round-trip.

#### Sub-aggregates

```ts
// profile/dto/business-identity.ts        — what the business is called
{
  userId:          string,        // FK → User.id
  businessName?:   string,        // "Riley Roofing Co."
  legalName?:      string,        // optional formal entity name
  businessLicense?:string,        // license number string
  logoFileId?:     string,        // FK → file module
  createdAt: string, updatedAt: string,
}

// profile/dto/business-address.ts         — where the business operates
{
  userId:    string,
  street?:   string,
  city?:     string,
  state?:    string,              // 2-letter US state code
  postal?:   string,
  country?:  string,              // default "US"
  createdAt: string, updatedAt: string,
}

// profile/dto/business-insurance.ts       — liability + WC insurance
{
  userId:          string,
  provider?:       string,
  policyNumber?:   string,
  coverageCents?:  number,        // e.g. 100000000 = $1M
  expiresAt?:      string,        // ISO date — drives renewal reminders
  createdAt: string, updatedAt: string,
}

// profile/dto/tax-identity.ts             — W-9 + TIN handling
{
  userId:        string,
  w9FileId?:     string,          // FK → file module
  w9UploadedAt?: string,
  tinHashed?:    string,          // SHA-256 salted, never raw
  tinSalt?:      string,
  tinMasked?:    string,          // "***-**-1234" for display
  createdAt: string, updatedAt: string,
}

// profile/dto/contract-defaults.ts        — boilerplate for new contracts
{
  userId:                  string,
  defaultTerms?:           string,        // T&Cs boilerplate
  paymentInstructions?:    string,        // "Make checks payable to..."
  paymentTermsTemplateId?: string,        // FK → paperwork.PaymentTerms (preset)
  warrantyMonths?:         number,
  terminationNoticeDays?:  number,
  disputeResolution?:      'mediation' | 'arbitration' | 'court',
  governingState?:         string,        // 2-letter code; usually = BusinessAddress.state
  createdAt: string, updatedAt: string,
}

// profile/dto/reference.ts                — past-client references
{
  id:              string,        // own id (one user has many)
  userId:          string,
  contactName:     string,
  phoneNumber?:    string,
  email?:          string,
  jobDescription?: string,
  position?:       number,        // ordering for display
  createdAt: string, updatedAt: string,
}
```

#### Endpoints

```
GET   /profile                                   (auth)  → composite read (see below)
GET   /profile/:userId/public                    (no auth) → safe customer-facing subset

# identity ----------------------------------------------------------------
GET   /profile/identity                          (auth)  → BusinessIdentity
PUT   /profile/identity                          (auth)  body: Partial<BusinessIdentity>

# address ----------------------------------------------------------------
GET   /profile/address                           (auth)  → BusinessAddress
PUT   /profile/address                           (auth)  body: Partial<BusinessAddress>

# insurance --------------------------------------------------------------
GET   /profile/insurance                         (auth)  → BusinessInsurance
PUT   /profile/insurance                         (auth)  body: Partial<BusinessInsurance>

# tax + W-9 file --------------------------------------------------------
GET   /profile/tax                               (auth)  → TaxIdentity (no raw TIN, only masked)
PUT   /profile/tax                               (auth)  body: { tin?: string }   (server hashes + masks)
POST  /profile/tax/w9        multipart            (auth)  → { fileId }
GET   /profile/tax/w9                            (auth)  → binary (own only)
GET   /profile/tax/w9/meta                       (auth)  → { uploadedAt, sizeBytes, mimeType }
DELETE /profile/tax/w9                           (auth)  → { ok }
POST  /profile/:userId/tax/w9/verify             (no auth, rate-limited) body: { tinPlain } → binary if TIN matches

# contract defaults -----------------------------------------------------
GET   /profile/contract-defaults                 (auth)  → ContractDefaults
PUT   /profile/contract-defaults                 (auth)  body: Partial<ContractDefaults>

# references ------------------------------------------------------------
GET   /profile/references                        (auth)  → Reference[]
POST  /profile/references                        (auth)  body: Partial<Reference>  → Reference
PUT   /profile/references/:id                    (auth)  body: Partial<Reference>  → Reference
DELETE /profile/references/:id                   (auth)  → { ok }
```

#### Composite reads

```ts
// GET /profile  →
{
  user:             User,
  identity:         BusinessIdentity   | null,
  address:          BusinessAddress    | null,
  insurance:        BusinessInsurance  | null,
  tax:              TaxIdentity        | null,        // with tinMasked, never raw
  contractDefaults: ContractDefaults   | null,
  references:       Reference[],
}

// GET /profile/:userId/public  →   (safe-for-customers subset)
{
  identity: { businessName, businessLicense, logoFileId } | null,
  address:  { city, state, country } | null,           // never street/postal
  insurance:{ provider, coverageCents } | null,         // never policy number
  hasW9:    boolean,                                    // presence only, no file
}
```

The dashboard's sidebar/topbar greeting hits `GET /me` (one trip; cheap). The `/dashboard/settings` page hits `GET /profile` (composite). Customer-facing pages (e.g. `/quote/:id/public`) hit `GET /profile/:userId/public`.

#### Storage

| Key | Value |
|---|---|
| `["profile_identity",  userId]`             | `BusinessIdentity`  |
| `["profile_address",   userId]`             | `BusinessAddress`   |
| `["profile_insurance", userId]`             | `BusinessInsurance` |
| `["profile_tax",       userId]`             | `TaxIdentity`       |
| `["profile_defaults",  userId]`             | `ContractDefaults`  |
| `["profile_reference", userId, referenceId]`| `Reference`         |

W-9 file binary lives in the `file` module (§3.H), referenced by `TaxIdentity.w9FileId`.

#### What lives where (reading guide)

| If you're displaying… | Read from |
|---|---|
| Dashboard topbar greeting `"Hey, Diego 👋"`           | `User.name`                      |
| Dashboard sidebar footer `"Diego R."` (top)           | `User.name`                      |
| Dashboard sidebar footer `"Riley Roofing Co."` (bottom)| `BusinessIdentity.businessName` |
| Quote/Contract/Invoice letterhead — business name     | `BusinessIdentity.businessName`  |
| Quote/Contract letterhead — license #                 | `BusinessIdentity.businessLicense`|
| Customer-facing "About this contractor" sidebar       | `GET /profile/:userId/public`    |
| Default payment terms on new contracts                | `ContractDefaults.*`             |
| W-9 download for customer                             | `POST /profile/:userId/tax/w9/verify` (rate-limited, TIN-gated) |
| App language                                          | `User.language`                  |

#### Required-on-signup

Only the `User` record is created at OTP verification. **All five profile sub-aggregates are absent until the user opens `/dashboard/settings` and saves them.** The composite `GET /profile` returns `null` for any aggregate that hasn't been created yet. The dashboard should show a "Finish setting up your business profile" banner until at least `BusinessIdentity` exists.

### 3.D `analytics` module (NEW) — KPI tiles

The Dashboard hero shows three tiles + a sparkline (`pages/dashboard/components/kpi-cards.md`):
- `▲24% vs March` (revenue trend)
- `$4,180 ahead`
- `4 quotes awaiting`

Plus the sparkline (`pages/dashboard/components/sparkline.md`) renders 12 monthly revenue data points.

Single coordinator endpoint:

```
GET /analytics/dashboard
→ {
    customers: number,
    quotes: { total, draft, sent, accepted },
    contracts: { total, draft, signed },
    invoices: { total, pending, overdue, paid },
    revenue: {
      ytd: number,
      lastMonth: number,
      monthOverMonthPct: number,           // +24, -3, etc.
      sparkline12mo: number[]              // length-12 revenue array
    },
    quotedValue: number,                   // sum of open quotes' estimatedTotal
    awaitingResponse: number,              // quotes sent but not accepted/declined
  }
```

Implementation: a `domain/coordinators/compute-dashboard-stats.ts` that fans out across the existing `customer-store`, `quote-store`, `contract-store`, `invoice-store`, all filtered by `contractorId`. No new storage required — pure read.

### 3.E `notification` module (NEW) — topbar bell + activity ticker

Dashboard topbar shows a rotating activity ticker (`pages/dashboard/components/activity-ticker.md`). In the prototype it cycles a hardcoded array; production needs:

```
GET    /notifications?unreadOnly=&limit=&cursor=    → { items: Notification[], nextCursor?: string }
GET    /notifications/unread-count                  → { count: number }
POST   /notifications/:id/read                      → { ok }
POST   /notifications/read-all                      → { ok }
```

DTO:
```ts
// notification/dto/notification.ts
{
  id: string,
  contractorId: string,
  type: 'quote_sent' | 'quote_accepted' | 'contract_signed' | 'invoice_paid' | 'invoice_overdue' | 'customer_replied',
  entityType?: 'quote' | 'contract' | 'invoice' | 'customer',
  entityId?: string,
  title: string,                // "Quote sent to Greenleaf HOA"
  body?: string,
  read: boolean,
  readAt?: string,
  createdAt: string,
}
```

Storage:
- `["notification", id]` → record
- `["notification_by_contractor", contractorId, createdAt, id]` → secondary index for "list newest first" without full scan

Notifications are **emitted from the existing CRUD modules** by the controllers via a shared in-process `EventBus` (port `backend/src/foundation/domain/data/event-bus.ts`). Examples: `QuoteController.send()` emits `{ type: 'quote_sent', ... }`, `InvoiceController.pay()` emits `{ type: 'invoice_paid', ... }`. The notification module subscribes and writes records.

### 3.F `email` module (NEW)

Quote / contract / invoice "send" buttons on the Dashboard need email delivery (Postmark — old backend at `backend/src/email/email.mod.ts` is a 60-line wrapper, port verbatim).

```
POST /quotes/:id/email           body: { to, message? }    → { ok }
POST /contracts/:id/email        body: { to, message? }    → { ok }
POST /invoices/:id/email         body: { to, message? }    → { ok }
```

Provide a single internal service:
```ts
// email/email.service.ts
sendEmail(to: string, subject: string, htmlBody: string): Promise<boolean>
```

Configuration: `POSTMARK_API_KEY` env var. If unset, log to stdout and return `true` (dev mode).

### 3.G Public endpoints (NEW)

Customer-facing pages (the recipient receives an email link to view a quote / sign a contract / pay an invoice) must be reachable without auth. Add a `/public` variant for each (matches old backend convention):

```
GET   /quotes/:id/public                         → Quote with masked contractor profile
POST  /quotes/:id/accept                         body: { signature?, name? }   → { ok }    (public)

GET   /contracts/:id/public                      → Contract
GET   /contracts/by-quote/:quoteId/public        → { contractId? }
POST  /contracts/:id/sign                        body: { signature, name, tin? }   → { ok }   (public)

GET   /invoices/:id/public                       → Invoice
```

Public endpoints are **not** behind the auth guard. Mark them with a custom `@SkipAuth()` decorator the guard reads.

### 3.H `file` module (NEW) — W-9 upload

Profile flow needs file storage. Match old backend: KV-backed (no S3) initially.

```
POST   /files                       multipart           → { id, key }
GET    /files/:id                                      → binary
DELETE /files/:id
```

Storage:
- `["file", contractorId, fileKey]` → `Uint8Array`
- `["file_meta", contractorId, fileKey]` → `{ filename, mimeType, sizeBytes, uploadedAt }`

Note: Deno KV has a 64 KiB value limit. For larger uploads, chunk into pages (`["file", contractorId, fileKey, pageIndex]`) and reassemble on read. Old backend at `backend/src/foundation/domain/data/file-store.ts` already does this — port it.

### 3.I Activity stream / SSE (OPTIONAL)

The activity ticker can poll `GET /notifications?limit=5&unreadOnly=true` every ~10s and rotate locally. **Recommended for v1.** A future SSE endpoint at `GET /events` (using Danet's stream support) can replace polling — defer.

---

## §4 — What the **Assistant page** needs (DEFERRED)

The Assistant page chat UI is **not implemented** in this docs pass. The frontend will scaffold the chat shell with a static seed and mark every chat-internal component `[DEFERRED]`. To keep frontend work unblocked, the eventual `agents` module should expose this surface (subject to change as the agents project lands):

```
POST /agents/chat                  body: { conversationId?, content }    → { conversationId, message: AssistantMessage }
GET  /agents/conversations[?limit=&cursor=]
GET  /agents/conversations/:id     → { conversation, messages: Message[] }
```

The **Communication module already covers conversation/message persistence** — the `agents` module composes on top of it. `Conversation.contractorId` (after §3.B) is the tenant scope; messages with `role: 'assistant'` come from the agents module; messages with `role: 'user'` come from the user.

The agents module owns:
- LLM call (Claude API)
- Streaming response
- Tool/action use (e.g., "create quote from this scope")
- Wizard state (multi-step inline form embedded in chat — see `pages/assistant/components/wizard.md`)
- Voice transcription (deferred even within the agents module)

The frontend chat shell **does not depend on the agents module shipping** — it can render a static seed in development and switch to live data when `/agents/*` becomes available.

---

## §5 — Recommended module roadmap (build order)

Prioritized for "ship the Dashboard." Each step lists the minimum to unblock the next.

| # | Module | Scope | Unblocks |
|---|---|---|---|
| 1 | `users` (NEW) | Twilio OTP, `User` DTO, session KV with 30-day TTL, `AuthGuard`, `@CurrentUser()` (alias `@CurrentContractor()`) param decorator, `@SkipAuth()` opt-out, `/auth/*` + `/me` endpoints. | Every other authenticated endpoint |
| 2 | DTO migration | Add `userId` to existing DTOs (§3.B), add secondary indexes, update controllers to scope by `userId`. | Multi-tenant safety |
| 3a | `profile.identity` (NEW) | `BusinessIdentity` aggregate + GET/PUT /profile/identity. | Sidebar footer business name, doc letterhead |
| 3b | `profile.address` (NEW) | `BusinessAddress` aggregate + endpoints. | Letterhead, governing-state default for contracts |
| 3c | `profile.contract-defaults` (NEW) | `ContractDefaults` aggregate + endpoints. | Default payment terms / warranty / dispute resolution on new contracts |
| 3d | `profile` composite read (NEW) | `GET /profile` + `GET /profile/:userId/public` fan-out endpoints. | Dashboard `/settings` page; customer-facing pages |
| 4 | `analytics` (NEW) | Coordinator only — pure reads from existing stores, scoped by `userId`. | Dashboard KPI tiles & sparkline |
| 5 | `notification` (NEW) + EventBus | In-process `EventBus`, controllers emit on state changes, notification module subscribes & persists. | Dashboard activity ticker, topbar bell |
| 6 | `email` (NEW) | Postmark wrapper; per-resource `/email` endpoints. | "Send" buttons on quote/contract/invoice |
| 7 | Public endpoints | `/quotes/:id/public`, `/contracts/:id/public`, `/invoices/:id/public`, `POST /quotes/:id/accept`, `POST /contracts/:id/sign`. | Customer-facing flow (sent emails contain links) |
| 8 | `file` (NEW) | KV-backed, chunked-page storage. | W-9 upload (`profile.tax`), business logo upload, photo attachments |
| 9 | `profile.insurance` + `profile.tax` + `profile.references` (NEW) | Three remaining sub-aggregates of `profile`. Tax depends on `file` module shipping (W-9 storage). | Compliance display; customer trust signals |
| 10 | (PARALLEL) `agents` | LLM chat, conversation persistence, tool use. | Assistant page (deferred from this doc pass) |

Steps 1 and 2 are **sequential and blocking** for everything else. Steps 3a–3d, 4, 5, 6, 7 can run in any order (and somewhat in parallel) once #2 lands. Steps 8 and 9 ride together since `profile.tax` requires `file`.

The `profile` module is intentionally split across three roadmap rows (3a/3b/3c/3d for the launch-blocking aggregates, 9 for the rest) because the dashboard only needs identity + address + contract-defaults to ship. Insurance/tax/references can come post-launch.

---

## §6 — Lower priority (post-Dashboard)

### 6.A Marketing-only landing variant (deferred)

If a separate marketing landing (no login form) is ever needed for ads/SEO, it would be a different route — `/about`, `/pricing`, etc. — that funnels into the same `/` login flow. Not on the roadmap; the current `/` IS the login.

### 6.B Health & status

```
GET /health                       → { status: 'ok', version, uptimeSec }    (public)
```

Useful for Render/Fly/Railway healthchecks.

### 6.C Search

Topbar `⌘K` search hits one endpoint that fans out across customers/quotes/contracts/invoices and returns a typed-union result. KV does not support full-text — implement a simple substring-match scan filtered by `contractorId`. Acceptable up to ~10k records.

```
GET /search?q=&type=customer|quote|contract|invoice&limit=
→ { results: SearchHit[] }
```

### 6.D PDF generation

"Save as PDF" buttons. Two options:
1. **Server-side:** Puppeteer in a worker (heavy). Old backend doesn't do this — quotes/contracts present as HTML and rely on browser Print → PDF.
2. **Client-side:** `html2canvas` + `jsPDF`, or browser print stylesheet. Cheaper. Recommended for v1.

---

## §7 — DTO refinements (existing v2 DTOs)

Current DTOs are minimal. The following fields exist in the prototype mockups (`hero.md`, `doc-tabs.md`, etc.) but are not yet on the v2 DTOs. Add them when implementing the Dashboard, not now:

| DTO | Missing field(s) | Source/why |
|---|---|---|
| `quote` | `assumptions: string[]`, `exclusions: string[]`, `timeline: string`, `pendingContractTerms: { ... }` | Quote mockup shows assumptions/exclusions; old backend's quote.ts has these |
| `quote` | `acceptedAt?: string` | Already implied by `status='accepted'`, make it explicit |
| `contract` | full `paymentTerms`, `warranty`, `disputeResolution`, `terminationNoticeDays`, `state`, `stateNotices`, `signature`, `customerSignedName`, `customerTinHash`, `customerTinSalt`, `customerTinMasked`, `providerSignature`, `providerSignedAt`, `providerSignedName` | Contract sign flow; port shape from old `backend/src/contract/dto.ts` |
| `invoice` | `taxBreakdown[]`, `paymentMethod`, `lateFeePct`, `invoiceNumber: string` (sequential per user) | Invoice mockup has invoice number `INV-#41`; needs a per-user counter (`["invoice_seq", userId]` with atomic `Deno.Kv.atomic().sum(...)`) |
| `customer` | `messages: { type, entityId, sentAt, to }[]` | Track outbound emails for "last contacted" |

These changes are **non-breaking** (all new fields are optional). Land them lazily as features need them, not in one big migration.

---

## §8 — Port-from-old-backend cheatsheet

The old `/backend` (root, not v2) has battle-tested implementations of every missing module. Use it as a reference; do not preserve its file structure. Map:

| New (v2) | Port from (old) | Notes |
|---|---|---|
| `v2/backend/src/users/` | `backend/src/auth/` + identity bits of `backend/src/profile/profile.dto.ts` | Auth (OTP/session/AuthGuard) belongs here, plus the `User` DTO (id, phoneNumber, name, email, language). The old backend put `name`/`email` on the profile; in v2 they go on `User`. |
| `v2/backend/src/profile/` | rest of `backend/src/profile/` | Old monolithic ContractorProfile splits into `BusinessIdentity`, `BusinessAddress`, `BusinessInsurance`, `TaxIdentity`, `ContractDefaults`, `Reference[]`. Each is a sub-aggregate keyed by `userId`. **Do not preserve the single-document shape.** |
| `v2/backend/src/notification/` | `backend/src/notification/` | Storage keys + `notification_by_user` index (renamed from `notification_by_contractor`) |
| `v2/backend/src/analytics/` | `backend/src/analytics/` | Single coordinator endpoint, scoped by `userId` |
| `v2/backend/src/email/` | `backend/src/email/email.mod.ts` | 60-line Postmark wrapper |
| `v2/backend/src/file/` | `backend/src/foundation/domain/data/file-store.ts` | Chunked KV file storage; backs both `profile.tax.w9FileId` and `profile.identity.logoFileId` |
| `v2/backend/src/foundation/event-bus.ts` | `backend/src/foundation/domain/data/event-bus.ts` | In-process pub-sub |
| `v2/backend/src/health/` | `backend/src/health/` | Optional |
| `v2/backend/src/search/` | (no equivalent — old backend uses KV scans inline) | Fresh implementation |
| `v2/backend/src/agents/` | `backend/src/boss/` | Boss is the LLM-in-CRUD, but agents is **chat-only**; don't carry over the action-execution side |

Old backend file pointers:
- `backend/src/auth/auth.controller.ts`, `auth.service.ts` → users module's auth surface
- `backend/src/profile/profile.controller.ts`, `profile.service.ts`, `profile.dto.ts` → split across `users.User` (name/email/language) + `profile.*` sub-aggregates
- `backend/src/analytics/analytics.controller.ts`, `analytics.service.ts`
- `backend/src/notification/*`
- `backend/src/email/email.mod.ts`
- `backend/src/foundation/domain/data/{event-bus,file-store,session-store}.ts`

---

## §9 — Testing convention to keep

`v2/backend` already has a strong test pattern:
- `*.test.ts` — unit tests for `domain/business/*` (pure functions)
- `*.smk.test.ts` — smoke tests for `domain/data/*` (KV roundtrip with `KV_PATH=:memory:`)
- `*.e2e.test.ts` — end-to-end through controllers via real HTTP

Every new module added in §5 must ship with:
- A `.smk.test.ts` proving its store roundtrips
- A `.e2e.test.ts` proving the auth guard rejects unauthenticated requests and accepts authenticated ones with the correct `contractorId` scoping
- A negative test proving cross-tenant access raises 403

---

## §10 — Frontend ↔ backend endpoint map (cheat sheet)

What every Dashboard component calls, in one place. Cross-reference with each component doc.

| UI surface | Endpoint(s) |
|---|---|
| Landing — phone-input form (request OTP) | `POST /auth/send-otp` — see §2.A |
| `/verify` — 6-digit code entry (verify OTP) | `POST /auth/verify-otp` — see §2.A |
| Logout (sidebar account menu) | `POST /auth/logout` |
| Sidebar profile footer | `GET /profile` |
| Sidebar profile footer — top line ("Diego R.") | `GET /me` (`User.name`) |
| Sidebar profile footer — bottom line ("Riley Roofing Co.") | `GET /profile/identity` (`businessName`) |
| Sidebar nav badges (e.g. "4" on Conversations) | `GET /analytics/dashboard` (counts come from here) |
| Topbar greeting "Hey, Diego 👋" | `GET /me` (`User.name`) |
| Topbar activity ticker | `GET /notifications?limit=10` (poll every 10s) |
| Topbar `⌘K` search | `GET /search?q=&type=` (§6.C) |
| Hero KPI tiles | `GET /analytics/dashboard` |
| Sparkline (12-mo revenue) | `GET /analytics/dashboard` (`revenue.sparkline12mo`) |
| `/dashboard/settings` page (full profile editor) | `GET /profile` composite (one trip, returns user + all 6 sub-aggregates) |
| Customer-facing `/quote/:id/public` letterhead | `GET /profile/:userId/public` |
| Default contract terms when drafting a new contract | `GET /profile/contract-defaults` |
| W-9 download (customer side, TIN-gated) | `POST /profile/:userId/tax/w9/verify` |
| Phone preview (decorative) | none — static |

Assistant (deferred):

| UI surface | Endpoint(s) |
|---|---|
| Thread list | `GET /agents/conversations` *(future)* — for now, static seed |
| Active thread | `GET /agents/conversations/:id` *(future)* |
| Send message | `POST /agents/chat` *(future)* |

Landing: `POST /auth/send-otp` only (the phone-input is the OTP-request — see §2.A).

---

## §11 — Open decisions for the team

These are flagged for confirmation before implementation:

1. **Demo mode.** The old project's `CLAUDE.md` mentions an `X-Demo-Mode: true` header and `routes/demo/` in the frontend. v2/backend has no demo support. Decide: (a) carry it forward, (b) drop in favor of seed-only test fixtures, (c) defer until post-launch. **Recommendation: (c) defer** — onboarding without auth is nice-to-have, not blocking.
2. **i18n — server-side localization scope.** The landing's EN/ES toggle is captured at signup and stored on `User.language` (decided — see §3.A "First-time signup language capture"). The OTP SMS body is localized off the OTP record's `language`. Open question: which **other** server-rendered artifacts need localization? Candidates: `POST /quotes/:id/email` body, `POST /contracts/:id/email` body, `POST /invoices/:id/email` body, future invoice/contract PDFs. Recommend: localize the three email bodies off `User.language` of the *sender* (the contractor); leave PDFs in EN until a customer asks.
3. **Single-tenant vs team accounts.** Current model is one phone number = one User (= one tenant). The dashboard mockup has no team UI. The `users`/`profile` split makes adding `Team` and `Membership { teamId, userId, role }` modules straightforward later, but defer until product validates the need.
4. **Soft delete.** Old backend hard-deletes. Quote mockup shows revisions (`revise` action creates v2). Keep hard-delete unless the user signals otherwise.

---

## §12 — Don't-do list

These were tempting and explicitly **not** in scope:

- ❌ Carrying over the old `boss` module verbatim. Boss conflates chat + action execution; Assistant chat (when it lands) is chat-only.
- ❌ Generic plugin/extension architecture. YAGNI.
- ❌ Moving from KV to Postgres. KV is fine until ~100k records per tenant.
- ❌ Multi-stage approval workflows on quotes/contracts. Single-actor model only.
- ❌ Webhooks. Internal `EventBus` is enough; outbound webhooks are post-launch.
