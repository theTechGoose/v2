# Backend plan — `/clients` and `/quotes` page support

> **Scope:** what the existing v2 backend (`v2/backend/src/`) must grow to render `pages/clients/` and `pages/quotes/` correctly. Nothing else.
>
> **Default principle:** add derivation, not new aggregate stores. The existing per-user `listByUser` scans on `CustomerStore`, `QuoteStore`, `InvoiceStore`, `ViewStore` are cheap (KV index → in-memory filter) and already pass auth gates. New endpoints should compose those stores in a coordinator (mirroring `ComputeDashboardStats`) rather than introduce new write paths.
>
> **Money fields:** keep DTOs as dollars (existing convention in `Quote.estimatedTotal`, `Invoice.amount`). Convert to **cents** only on the analytics roll-up boundary (matches `DashboardStats`).
>
> **Cross-references in this doc:**
> - §1 — what's already shipped (don't rebuild)
> - §2 — `/clients` requirements (Customer extensions + analytics)
> - §3 — `/quotes` requirements (Quote lifecycle + opens + analytics)
> - §4 — endpoint summary table
> - §5 — implementation order
> - §6 — testing strategy (per-rule coverage matrix + definition of done)
> - §7 — non-goals

---

## 1. What already exists (reuse, don't rebuild)

| Surface | Lives at | Notes |
|---|---|---|
| Customer CRUD | `crm/entrypoints/customer-controller/mod.ts` (`GET/POST/PUT/DELETE /customers`) | Owner-scoped via `requireUser`. Add fields to DTO, do not add a parallel `/clients` controller — the route is `/customers`; the frontend term "clients" is UI-only. |
| Quote CRUD + `?status=` filter | `paperwork/entrypoints/quote-controller/mod.ts` | `GET /quotes?status=draft\|sent\|accepted` works today. The richer `stage` filter must be additive — keep `status` semantics intact. |
| Public quote accept (records `acceptedAt`) | `paperwork/entrypoints/public-controller/mod.ts:72` | Already mutates `acceptedAt` via cast. Promote to DTO (§3.1). |
| **Open-tracking** for any paperwork | `paperwork/entrypoints/view-controller/mod.ts` + `paperwork/dto/view.ts` | `View` already has `viewedAt`, `userAgent`, `ipAddress`, `durationMs`. `GET /views?paperworkType=quote&paperworkId=:id` returns the raw timeline. **Reuse for the quote-card flip — do not invent a new `/quotes/:id/opens` collection store.** |
| Dashboard rollup pattern | `core/analytics/domain/coordinators/compute-dashboard-stats/mod.ts` | Read coordinator that fans across stores. New analytics rollups for `/clients` and `/quotes` follow this exact pattern. |
| Notification feed | `GET /notifications` | Used identically by both pages' topbars. No change needed. |
| Profile | `GET /profile` | Same. |

---

## 2. `/clients` — what's missing

### 2.1 `Customer` DTO additions

The Clients page renders a "warmth" signal, segment chip, and VIP crown that have no source on today's `Customer` DTO. Add the **owner-controlled** fields (`segment`, `vip`) to `CreateCustomerDto` / `UpdateCustomerDto` / `Customer`:

```ts
// crm/dto/customer.ts
@IsOptional() @IsIn(["property_mgmt","homeowner","small_biz","hoa"])
segment?: ClientSegment;

@IsOptional() @IsBoolean()
vip?: boolean;
```

Everything else the card renders (`last`, `lastWhen`, `lastTone`, `balance`, `balanceSub`, `jobs`, `jobsSub`, `status`, `temp`, `daysSinceContact`) is **derived** — never accept it from a request body, never persist it on the customer record. Compute it in the list endpoint (§2.2).

### 2.2 `GET /customers` — return enriched rows

Today's `CustomerController.list` returns raw `Customer[]`. Wrap it in a coordinator that joins each customer with its derived rollup. New shape:

```ts
// crm/dto/customer.ts
export interface CustomerCard extends Customer {
  // last activity
  lastWhen:         string;            // ISO of most recent quote/invoice/view event
  lastWhenRel:      string;            // "3 days ago" — server-side formatted (frontend expects it)
  lastTone:         "hot" | "warm" | "cold";

  // balance
  balanceCents:     number;            // positive = owes you, negative = credit on file
  balanceSub:       string;            // "INV-208 · due in 3 days" | "settled · quote out $5,800" | "50% deposit on file"

  // jobs (active = quote accepted, no signed contract OR signed contract with no paid invoice covering all line items)
  activeJobs:       number;
  jobsSub:          string;            // "active" | "scheduled" | "overdue" | "no active jobs"

  // mood band
  status:           "active" | "lead" | "owes" | "regular" | "cold";
  temp:             number;            // 0–100 warmth score (sort key)
  daysSinceContact: number;

  // 12-month revenue rollup (for TopClients leaderboard reuse)
  revenue12moCents: number;
}
```

Place the coordinator at `crm/domain/coordinators/build-customer-cards/mod.ts`. It runs:
1. `CustomerStore.listByUser(userId)`
2. `QuoteStore.listByUser(userId)`, `InvoiceStore.listByUser(userId)`, `ViewStore.listByType("quote")` — three parallel reads
3. For each customer, fold quotes/invoices/views by `customerId` and compute fields above

**Status derivation rules** (keep these single-sourced — frontend does not re-derive):

| status | rule |
|---|---|
| `owes` | `balanceCents > 0` |
| `active` | At least one accepted quote or signed contract with no terminal invoice |
| `lead` | Has only `draft` or `sent` quotes; no accepted/signed history |
| `regular` | `revenue12moCents > 0` and no `active` job and no balance |
| `cold` | `daysSinceContact > 60` and not `owes` |

Precedence top-to-bottom — first match wins.

**Temp (warmth score):**
```
temp = clamp(100
  − min(daysSinceContact, 60) * 1.2          // recency penalty
  + (revenue12moCents > 0 ? 20 : 0)           // money penalty wipe
  + (vip ? 15 : 0)
  + (activeJobs > 0 ? 10 : 0)
, 0, 100)
```

This is the sort key for the toolbar's "Warmth" sort.

### 2.3 `GET /analytics/clients/top?period=12mo&limit=5`

For the right-rail `<TopClients>` leaderboard. New controller at `core/analytics/entrypoints/clients-controller/mod.ts`. Returns:

```ts
{
  results: [{
    customerId:     string;
    name:           string;
    revenue12moCents: number;
    rank:           number;     // 1-indexed
    barPct:         number;     // 0–100 — that customer's revenue / leader's revenue
  }]
}
```

Reuses `BuildCustomerCards` output → sort desc → take top N. **Do not** introduce a separate revenue store; revenue is derived on every call.

### 2.4 `GET /analytics/clients/segments`

For `<ClientsSegments>` mini bar chart. Returns:

```ts
{
  segments: [{
    key:    "property_mgmt" | "homeowner" | "small_biz" | "hoa";
    label:  string;          // "Property mgmt"
    count:  number;
    pct:    number;          // 0–100, count / total customers
  }]
}
```

Group `Customer.segment` (§2.1). Customers without `segment` set fall under a "Unsorted" key — return them at the end of the array so the UI can choose to render or hide.

### 2.5 LoopBar / TodayLoop — defer

Root.md flags this as `GET /agents/conversations?suggested=today` (FUTURE). The `agents` module already has `conversations-controller`; **don't add a "suggested today" filter yet**. Ship the page with a static seed for v1 and revisit when the agents drafting flow exists. The LoopBar's "Open the loop" CTA links to `/assistant`; the avatars are decorative.

---

## 3. `/quotes` — what's missing

### 3.1 `Quote` DTO — promote stage timestamps

The public controller already casts `acceptedAt` onto Quote (`paperwork/entrypoints/public-controller/mod.ts:83`). Promote to first-class fields and add the rest of the lifecycle:

```ts
// paperwork/dto/quote.ts
@IsOptional() @IsString() sentAt?:     string;   // set when contractor emails
@IsOptional() @IsString() acceptedAt?: string;   // already written today
@IsOptional() @IsString() lostAt?:     string;   // contractor-marked or auto (≥30d quiet)
@IsOptional() @IsString() acceptedSignature?: string;  // already written today
@IsOptional() @IsString() acceptedName?:      string;  // already written today
```

`sentAt` is set by the email controller (`paperwork-email-controller`) when the quote leaves. Patch that controller — currently it sends mail but does not stamp `sentAt`.

### 3.2 `GET /quotes` — return `QuoteCard[]` with derived `stage`

Mirror the customer treatment. Wrap the existing list response in a coordinator at `paperwork/domain/coordinators/build-quote-cards/mod.ts`:

```ts
export type QuoteStage = "draft" | "sent" | "opened" | "cooling" | "stale" | "won" | "lost";

export interface QuoteCard extends Quote {
  stage:        QuoteStage;
  daysIn:       number;            // days since entering current stage
  opens:        number;             // deduped to ~1/hour
  lastOpenAt:   string | null;
  sentDays:     number | null;     // null for drafts
  decidedDays:  number | null;     // populated only for won/lost
  customerName: string | null;     // joined for the card avatar/initials
}
```

**Stage derivation** (single source — frontend does not re-derive). `now` is the request time:

| Stage | Rule |
|---|---|
| `draft` | `sentAt == null` |
| `sent` | `now - sentAt < 24h` AND `opens === 0` |
| `opened` | `opens >= 1` AND `now - sentAt >= 24h` AND not won/lost AND has open in last 48h |
| `cooling` | `now - sentAt > 4d` AND `opens >= 1` AND no opens in last 48h AND not won/lost |
| `stale` | `now - sentAt > 7d` AND `opens === 0` AND not won/lost (no decision recorded) |
| `won` | `acceptedAt != null` OR a signed contract references this `quoteId` |
| `lost` | `lostAt != null` OR `now - sentAt > 30d` with no signal |

`won` / `lost` win over earlier stages. The "opened+hot" sub-state (`opens >= 3`) is **frontend-only** styling — it does not change `stage`.

**Opens count derivation** — reuse `ViewStore`:

```ts
const views = await viewStore.listByPaperwork("quote", quote.id);
// dedupe to ≤1/hour
const opens = bucketByHour(views).length;
const lastOpenAt = views.at(-1)?.viewedAt ?? null;
```

This is the only place the dedup window is encoded; if it ever changes, change it here.

### 3.3 `GET /quotes/:id/opens` — timeline for the card flip

Per the page spec ("flip card → engagement timeline"). This is mostly a thin wrapper over the existing view store but with a friendlier shape than raw `View`:

```ts
{
  opens: [{
    at:      string;            // ISO
    atRel:   string;            // "2h ago"
    device:  "desktop" | "mobile" | "tablet" | "unknown";  // sniffed from userAgent
    durationMs?: number;
  }]
}
```

Implementation: `paperwork/entrypoints/quote-controller/mod.ts` adds `@Get(":id/opens")`. Owner-gated (the contractor must own the quote — `getOwned`). The view store's existing `listByPaperwork` is the source. Device sniff lives in a new `paperwork/domain/business/device-from-ua/mod.ts` helper.

> Do not expose this on the public controller — only the contractor sees their own engagement data.

### 3.4 `GET /analytics/quotes/win-rate?days=90`

For `<QSideRate>` half-donut. New controller at `core/analytics/entrypoints/quotes-controller/mod.ts`:

```ts
{
  windowDays: 90,
  decided:    number,    // won + lost
  won:        number,
  lost:       number,
  winRate:    number,    // 0–100; null if decided === 0
}
```

Source: `QuoteStore.listByUser(userId)`, filter to those with `acceptedAt` or `lostAt` within `windowDays`, count.

### 3.5 `GET /analytics/quotes/insight`

For `<QSideTip>`. Returns one statistical observation:

```ts
{
  text:  string;            // "Your average quote is opened 2.3× before acceptance."
  kind:  "open_count" | "median_days_to_decide" | "best_day_of_week" | "static_fallback";
}
```

Ship a **static-fallback** copy in v1 (root.md OK's this) so the page doesn't block on the calculator. Wire real insights when there's enough data per user (`>= 10` decided quotes) — until then return the static one. No persistence; pure derivation.

### 3.6 KPI strip — `<QuotesKpis>`

Root.md says "all derived from `GET /quotes`". The four tiles are:
- **In flight** — count of `stage in (sent, opened, cooling)`
- **Out for response** — count of `stage in (sent, opened)`
- **Drafting** — count of `stage === draft`
- **Decided this month** — count of quotes with `acceptedAt` or `lostAt` in current calendar month

All deriveable client-side from `GET /quotes`. **No new endpoint.** Document in `quotes-kpis.md` rather than here.

---

## 4. Endpoint summary

| Endpoint | Method | Auth | Status | Notes |
|---|---|---|---|---|
| `/customers` | GET | required | **extend** | Return `CustomerCard[]` (§2.2) instead of raw `Customer[]`. Breaking change — gate via `?cards=1` for one release if needed. |
| `/customers` | POST/PUT | required | **extend DTO** | Accept new optional `segment`, `vip` (§2.1). Existing fields untouched. |
| `/customers/:id` | GET | required | unchanged | Detail panel uses raw `Customer` shape. |
| `/analytics/clients/top` | GET | required | **NEW** | §2.3. `period=12mo&limit=5`. |
| `/analytics/clients/segments` | GET | required | **NEW** | §2.4. |
| `/quotes` | GET | required | **extend** | Return `QuoteCard[]` with derived `stage` (§3.2). Same `?status=` filter still works. |
| `/quotes` | POST/PUT | required | **extend DTO** | Promote `sentAt`, `acceptedAt`, `lostAt`, signature fields (§3.1). |
| `/quotes/:id/opens` | GET | required | **NEW** | §3.3. Owner-gated wrapper over `ViewStore`. |
| `/analytics/quotes/win-rate` | GET | required | **NEW** | §3.4. |
| `/analytics/quotes/insight` | GET | required | **NEW** | §3.5. Static fallback OK in v1. |
| `/views` (POST) | POST | public | unchanged | Already records the open events the quote-card flip reads. |
| `/agents/conversations?suggested=today` | GET | required | **defer** | LoopBar / TodayLoop. Static seed for v1. |

---

## 5. Implementation order — PR-by-PR

Eight independently shippable PRs. Each row lists every file to touch + the gate that decides "done."

> **Module wiring reminder** — every new controller must be added to its module's `controllers: [...]` array and every new coordinator/store to `injectables: [...]`. The three module roots are:
> - `crm/mod-root.ts` — Customer surface
> - `paperwork/mod-root.ts` — Quote / View surface
> - `core/mod-root.ts` — analytics rollups (already imports CrmModule + PaperworkModule, so coordinators here can DI any store)
>
> Forgetting the wiring is the most common silent failure — Danet bootstraps fine but `requireUser` throws "no provider" at request time. Every PR below ends with a wiring step; do not skip it.
>
> **Cross-module coordinator placement** — `crm/` cannot import from `paperwork/` (paperwork already imports crm; reversing would cycle). When a coordinator needs both Customer + Quote/Invoice/View stores, it lives in `core/analytics/domain/coordinators/` — same precedent as `ComputeDashboardStats`. The originating controller (e.g. `CustomerController` in `crm/`) DI's the coordinator from `core/`.

### PR 1 — Customer DTO extension (§2.1)

Pure additive. No coordinator yet; existing `GET /customers` keeps returning raw `Customer[]`.

| File | Change |
|---|---|
| `crm/dto/customer.ts` | Add `segment?: ClientSegment` and `vip?: boolean` to `CreateCustomerDto`, `UpdateCustomerDto`, `Customer` interface. Export `ClientSegment` union (`"property_mgmt" \| "homeowner" \| "small_biz" \| "hoa"`). |
| `crm/entrypoints/customer-controller/e2e.test.ts` | Add: `POST /customers accepts segment + vip`, `PUT /customers/:id updates segment + vip`, `POST /customers rejects invalid segment`. |

**Gate:** `deno task test` green; round-trip the new fields over HTTP.

### PR 2 — `BuildCustomerCards` coordinator + `GET /customers` enrichment (§2.2)

Largest PR. Touches the wire shape of `GET /customers` — frontend must consume the new fields in the same release (or the change ships behind `?cards=1` for one release; default to no flag, single coordinated frontend bump).

| File | Change |
|---|---|
| `crm/dto/customer.ts` | Add `CustomerCard` interface (extends `Customer` with derived fields). |
| `core/util/relative-time.ts` | **NEW** (if not already present). `relativeTime(iso: string, now: Date): string` returns "3 days ago" / "2h ago". Pure function. Unit-test alongside. |
| `core/analytics/domain/coordinators/build-customer-cards/mod.ts` | **NEW.** `@Injectable` coordinator. `run(userId, now = new Date()): Promise<CustomerCard[]>`. Fans across `CustomerStore`, `QuoteStore`, `InvoiceStore`, `ViewStore`. Status precedence + temp formula live here. |
| `core/analytics/domain/coordinators/build-customer-cards/mod_test.ts` | **NEW.** All 13 rules from §6.1 first table. |
| `crm/entrypoints/customer-controller/mod.ts` | Inject `BuildCustomerCards`. `list()` returns `flow.run(user.id)` instead of raw store. `get(:id)` is unchanged (returns raw `Customer`). |
| `crm/entrypoints/customer-controller/e2e.test.ts` | Add: `GET /customers returns CustomerCard[] with derived fields` (spot-check `status === "owes"` end-to-end with a fixture pending invoice). |
| `core/mod-root.ts` | Register `BuildCustomerCards` in `injectables`. |
| `_test/fixtures.ts` | **NEW.** Export `seedCustomer`, `seedQuote`, `seedInvoice`, `seedView`, `seedAcceptedQuote`. Used by every subsequent PR. |

**Gate:** every row of the §6.1 customer table green; e2e spot-check green.

### PR 3 — Clients analytics endpoints (§2.3, §2.4)

| File | Change |
|---|---|
| `core/analytics/dto/clients-stats.ts` | **NEW.** `TopClient`, `ClientSegmentRow`, response shapes. |
| `core/analytics/entrypoints/clients-controller/mod.ts` | **NEW.** `@Controller("analytics")` exposing `GET /analytics/clients/top` and `GET /analytics/clients/segments`. Reuses `BuildCustomerCards`. |
| `core/analytics/entrypoints/clients-controller/e2e.test.ts` | **NEW.** Four canonical cases per endpoint. |
| `core/mod-root.ts` | Register `ClientsController` in `controllers`. |

**Gate:** four canonical cases per endpoint green.

### PR 4 — Quote DTO promotion + email controller stamps `sentAt` (§3.1)

Pure additive on the DTO; one behavioral change in the email controller.

| File | Change |
|---|---|
| `paperwork/dto/quote.ts` | Add `sentAt?`, `acceptedAt?`, `lostAt?`, `acceptedSignature?`, `acceptedName?` to all three shapes. |
| `paperwork/entrypoints/paperwork-email-controller/mod.ts` | On successful quote send → `quoteStore.update(id, userId, { sentAt: now, status: "sent" })`. Idempotent (don't overwrite an existing `sentAt` on resend). |
| `paperwork/entrypoints/public-controller/mod.ts` | Drop the `as Partial<Quote>` casts on `acceptedSignature` / `acceptedName` (`mod.ts:81–82`) — the DTO now covers them. Behavior unchanged. |
| `paperwork/entrypoints/quote-controller/e2e.test.ts` | Add: `email send stamps sentAt`, `email send is idempotent on resend` (sentAt unchanged). |

**Gate:** existing public-controller e2e tests still green; new email tests green.

### PR 5 — `BuildQuoteCards` coordinator + `GET /quotes` enrichment (§3.2)

| File | Change |
|---|---|
| `paperwork/dto/quote.ts` | Add `QuoteCard` interface + `QuoteStage` union. |
| `core/analytics/domain/coordinators/build-quote-cards/mod.ts` | **NEW.** Stage derivation, opens dedup (1/hr), customer-name join. `run(userId, now = new Date()): Promise<QuoteCard[]>`. |
| `core/analytics/domain/coordinators/build-quote-cards/mod_test.ts` | **NEW.** All 15 rules from §6.1 second table. |
| `paperwork/entrypoints/quote-controller/mod.ts` | Inject `BuildQuoteCards`. `list()` calls `flow.run(user.id)`. The existing `?status=` filter still works — apply it client-side after enrichment, **not** as a stage filter (preserves existing semantics for the dashboard's "Quotes awaiting" panel). |
| `paperwork/entrypoints/quote-controller/e2e.test.ts` | Add: `GET /quotes returns QuoteCard[] with stage`, `GET /quotes?status=sent still filters`. |
| `core/mod-root.ts` | Register `BuildQuoteCards` in `injectables`. |

**Gate:** every row of the §6.1 quote stage table green.

### PR 6 — `GET /quotes/:id/opens` (§3.3)

Thin layer over `ViewStore`. Ships with the quote-card flip UI.

| File | Change |
|---|---|
| `paperwork/dto/quote.ts` | Add `QuoteOpensResponse` shape. |
| `paperwork/domain/business/device-from-ua/mod.ts` | **NEW.** `deviceFromUa(ua: string): "desktop" \| "mobile" \| "tablet" \| "unknown"`. Pure function. |
| `paperwork/domain/business/device-from-ua/mod_test.ts` | **NEW.** Cover the four buckets. |
| `paperwork/entrypoints/quote-controller/mod.ts` | Add `@Get(":id/opens")`. Call `store.getOwned(id, user.id)` first (auth gate), then `viewStore.listByPaperwork("quote", id)`. Map `View → timeline entry`. Inject `ViewStore` into the constructor. |
| `paperwork/entrypoints/quote-controller/e2e.test.ts` | Add: `GET /quotes/:id/opens happy path`, `GET /quotes/:id/opens by another user is rejected`. |
| `paperwork/mod-root.ts` | No new injectable — `ViewStore` already registered. |

**Gate:** owner-isolation e2e green; device-sniff unit tests green.

### PR 7 — `GET /analytics/quotes/win-rate` (§3.4)

| File | Change |
|---|---|
| `core/analytics/dto/quotes-stats.ts` | **NEW.** `WinRateResponse`. |
| `core/analytics/domain/coordinators/compute-quote-win-rate/mod.ts` | **NEW.** Pure derivation over `QuoteStore.listByUser`. |
| `core/analytics/domain/coordinators/compute-quote-win-rate/mod_test.ts` | **NEW.** All 3 rules from §6.1 win-rate table. |
| `core/analytics/entrypoints/quotes-controller/mod.ts` | **NEW.** `@Controller("analytics")` exposing `GET /analytics/quotes/win-rate`. |
| `core/analytics/entrypoints/quotes-controller/e2e.test.ts` | **NEW.** Four canonical cases. |
| `core/mod-root.ts` | Register `QuotesController` + `ComputeQuoteWinRate`. |

**Gate:** rule table + canonical cases green.

### PR 8 — `GET /analytics/quotes/insight` (§3.5)

Static fallback first.

| File | Change |
|---|---|
| `core/analytics/dto/quotes-stats.ts` | Add `InsightResponse`. |
| `core/analytics/domain/coordinators/compute-quote-insight/mod.ts` | **NEW.** Returns `static_fallback` until `decided >= 10`. |
| `core/analytics/domain/coordinators/compute-quote-insight/mod_test.ts` | **NEW.** Both rules from §6.1 insight table. |
| `core/analytics/entrypoints/quotes-controller/mod.ts` | Add `@Get("quotes/insight")` to existing controller. |
| `core/analytics/entrypoints/quotes-controller/e2e.test.ts` | Add insight cases. |
| `core/mod-root.ts` | Register `ComputeQuoteInsight`. |

**Gate:** rule table green; static-fallback path returns non-empty `text` for a fresh user.

### Stop

LoopBar / TodayLoop (§2.5) waits for the agents drafting flow. Do not start it as part of this initiative.

### Start here — PR 1 launch checklist

The first commit should be small enough to land same-day:

1. Edit `crm/dto/customer.ts` — add the `ClientSegment` union, three field additions on `Customer`, two on each Dto, decorators (`@IsOptional() @IsIn(SEGMENTS)` for `segment`, `@IsOptional() @IsBoolean()` for `vip`).
2. Edit `crm/entrypoints/customer-controller/e2e.test.ts` — add three tests against the existing `withServer`/`login` harness (no new fixtures needed yet).
3. `cd v2/backend && deno task test` — must be green.
4. Commit. PR 1 done.

PR 2 starts with `_test/fixtures.ts` so every subsequent PR can import from one place.

---

## 6. Testing strategy

---

## 6. Testing strategy

The existing v2 backend uses two tiers and we follow them exactly — no new test infrastructure:

- **Coordinator unit tests** — pure functions of `(stores, userId, now)`. Deterministic. No HTTP, no auth, no KV bootstrap. Cover every branch of every derivation table in this doc. New coordinators must accept `now: Date = new Date()` as a parameter (already the pattern at `core/analytics/domain/coordinators/compute-dashboard-stats/mod.ts:34`) so time-sensitive rules are testable without mocking the clock.
- **Controller e2e tests** — boot the real server with `KV_PATH=:memory:`, log in via the OTP flow, hit endpoints over `fetch`. Cover the wire shape, auth gate, and owner isolation. Pattern lives at `crm/entrypoints/customer-controller/e2e.test.ts:43` and `core/analytics/entrypoints/dashboard-controller/e2e.test.ts:31`.

Both tiers run via `deno task test` in `v2/backend/`. Each new file follows the existing colocation convention (`mod.ts` next to `e2e.test.ts`).

### 6.1 Per-rule coverage matrix

Every rule asserted in §2.2 and §3.2 must have a named test. The list below is the ship-blocker — if a row has no test, the corresponding rule is not actually validated.

**`BuildCustomerCards` (`crm/domain/coordinators/build-customer-cards/mod_test.ts`):**

| Test name | Asserts |
|---|---|
| `status: owes wins when balance > 0` | A customer with one accepted quote AND one pending overdue invoice → `status === "owes"` (owes precedence over active) |
| `status: active when accepted quote exists with no terminal invoice` | One accepted quote, no invoices → `status === "active"` |
| `status: lead when only draft/sent quotes` | One draft + one sent, no accepted/signed → `status === "lead"` |
| `status: regular when 12mo revenue > 0 and no active job` | Paid invoice within 12 months, no open quotes → `status === "regular"` |
| `status: cold when daysSinceContact > 60 and not owes` | Last activity 90 days ago, balance 0 → `status === "cold"` |
| `temp: monotonic in daysSinceContact` | Two customers identical except for `lastWhen` → newer one has higher `temp` |
| `temp: vip bumps score by 15` | Same fixture with `vip:true` vs `vip:false` → 15-point delta |
| `temp: clamped to [0,100]` | Extreme inputs do not produce out-of-range values |
| `balanceCents: positive when invoices owed` | Pending invoice $200 + deposit $50 → `balanceCents === 15_000` |
| `balanceCents: negative on credit` | Deposit on file with no invoice → `balanceCents < 0` |
| `revenue12moCents: excludes invoices outside window` | Paid invoice 13 months ago → not counted |
| `lastWhen: takes max across quote/invoice/view events` | View at T+1d after a quote at T → `lastWhen` is the view |
| `daysSinceContact: rounds down` | Activity 36h ago → `daysSinceContact === 1` |

**`BuildQuoteCards` (`paperwork/domain/coordinators/build-quote-cards/mod_test.ts`):**

The stage table in §3.2 is the spec — one test per row, plus precedence tests:

| Test name | Asserts |
|---|---|
| `stage: draft when sentAt is null` | No `sentAt` → `"draft"` regardless of opens |
| `stage: sent within 24h of sentAt with 0 opens` | `sentAt = now − 6h`, opens 0 → `"sent"` |
| `stage: opened when opens >= 1 and >= 24h since sent and recent open` | `sentAt = now − 2d`, view at `now − 12h` → `"opened"` |
| `stage: cooling when sentAt > 4d and last open > 48h ago` | `sentAt = now − 5d`, last view 3d ago → `"cooling"` |
| `stage: stale when sentAt > 7d and 0 opens` | `sentAt = now − 10d`, no views → `"stale"` |
| `stage: won when acceptedAt set` | Any other timing, `acceptedAt != null` → `"won"` |
| `stage: won when a contract references the quoteId` | No `acceptedAt`, but contract with `quoteId` exists → `"won"` |
| `stage: lost when lostAt set` | `lostAt != null` → `"lost"` |
| `stage: lost when sentAt > 30d with no signal` | `sentAt = now − 35d`, opens 0, no decision → `"lost"` |
| `stage precedence: won/lost beat earlier stages` | A quote that would otherwise be `"opened"` but has `acceptedAt` set → `"won"` |
| `opens: dedupes within a 1-hour bucket` | Three views at `T`, `T+30m`, `T+45m` → `opens === 1` |
| `opens: counts separate hour buckets` | Views at `T` and `T+90m` → `opens === 2` |
| `daysIn: measured against stage entry, not record creation` | Quote created 30d ago, sent 2d ago → if `stage === "sent"`, `daysIn === 0` (within 24h) |
| `decidedDays: null unless won/lost` | Stage `"sent"` → `decidedDays === null` |
| `customerName: joined from customer store` | Quote with valid `customerId` → name populated; orphaned `customerId` → `null` (not a throw) |

**Win-rate coordinator (`core/analytics/domain/coordinators/compute-quote-win-rate/mod_test.ts`):**

| Test name | Asserts |
|---|---|
| `windowDays: excludes decisions outside the window` | `acceptedAt = now − 100d`, window 90 → not counted |
| `winRate: null when decided === 0` | Fresh user with no decisions → `winRate === null` (not divide-by-zero) |
| `winRate: 50% on 1 won + 1 lost` | Round-trip math |

**Static insight (`core/analytics/domain/coordinators/compute-quote-insight/mod_test.ts`):**

| Test name | Asserts |
|---|---|
| `insight: returns static_fallback when decided count < 10` | Fresh user → `kind === "static_fallback"` |
| `insight: returns open_count observation when decided count >= 10 and data supports it` | Seeded fixture → real observation, never `null` text |

### 6.2 Controller e2e tests

One file per new/extended endpoint, following `customer-controller/e2e.test.ts`. Each file runs the four canonical cases plus shape assertions:

| Test name | Asserts |
|---|---|
| `<verb> <path> happy path round-trip` | 200 + expected fields on the response |
| `<verb> <path> without session is rejected` | `res.ok === false` |
| `<verb> <path> scopes by owner` | A's data invisible to B |
| `<verb> <path> shape contract` | Response keys match the DTO declared in this doc (catches accidental field drops in the redaction projection) |

**Files to add:**

- `crm/entrypoints/customer-controller/e2e.test.ts` — extend the existing file with `GET /customers returns CustomerCard[] with derived fields` (assert `status`, `temp`, `balanceCents` are present; spot-check one rule end-to-end so the wire path is exercised — the exhaustive rule coverage lives in the coordinator unit tests).
- `core/analytics/entrypoints/clients-controller/e2e.test.ts` — `GET /analytics/clients/top` and `GET /analytics/clients/segments`.
- `paperwork/entrypoints/quote-controller/e2e.test.ts` — extend with: `GET /quotes returns QuoteCard[] with stage`, `GET /quotes/:id/opens returns owner-only timeline`, `GET /quotes/:id/opens by another user is rejected`.
- `core/analytics/entrypoints/quotes-controller/e2e.test.ts` — `GET /analytics/quotes/win-rate?days=90`, `GET /analytics/quotes/insight`.

### 6.3 Time injection — the only non-obvious bit

Stage rules and `daysIn` / `daysSinceContact` are functions of `now`. **Do not mock `Date.now()`.** Instead, every coordinator takes `now: Date = new Date()` as the last parameter, and unit tests pass a fixed timestamp. The controller calls `coordinator.run(userId)` with no `now` so production uses the real clock. This mirrors `ComputeDashboardStats.run(userId, now)` — same convention, no new test plumbing.

For the e2e tests (which can't pass `now` over HTTP), use boundaries far from the present: a fixture quote created ~now is `"sent"` or `"draft"` regardless of the day the test runs, and a fixture quote with `sentAt = "2020-01-01"` is `"stale"` on every wall clock. Tests that need a *specific* stage transition belong in the unit tier, not e2e.

### 6.4 Fixture seeding

Reuse the existing `withServer` + `login` helpers verbatim — they're already in every `e2e.test.ts`. New helpers to add (so test bodies stay short):

- `seedQuote(port, sid, overrides)` → POST `/quotes`, returns the parsed body
- `seedView(port, paperworkType, paperworkId, viewedAtIso)` → POST `/views`
- `seedAcceptedQuote(port, sid, customerId)` → POST `/quotes` then PUT to set `acceptedAt`

Park them in `backend/src/_test/fixtures.ts` so all four new e2e files import from one place.

### 6.5 What's explicitly NOT covered by tests

- **Editorial copy / "stories".** Backend doesn't generate them in v1. Nothing to test.
- **Frontend-only styling sub-states** (e.g. `opened+hot` when `opens >= 3`). Backend returns `stage === "opened"` either way; the styling decision is in frontend tests.
- **The `View` POST path itself.** Already covered by `view-controller/e2e.test.ts`. We only add owner-gated *read* coverage on the new `/quotes/:id/opens` wrapper.

### 6.6 Definition of done

A step in §5 is shipped only when:

1. Its coordinator unit test file exists with every row of the relevant rule table green.
2. Its e2e file has the four canonical cases (happy / no session / cross-owner / shape) green.
3. `deno task test` passes from `v2/backend/` with no new failures elsewhere.
4. The endpoint is reachable from a curl against a freshly bootstrapped server using a real session cookie (manual smoke — one-line check, not automated).

If any of those four is missing, the step is not done — even if the code "works."

---

## 7. Non-goals / explicitly out of scope

- **No new persistence.** Every field in §2.2 and §3.2 is derived per-request. If the listByUser scans become slow, the cache lives in the coordinator (mirrors `ComputeDashboardStats`).
- **No `Job` entity.** "Active jobs" is a derived count from accepted quotes / signed contracts (root.md says the same). Don't introduce a `Job` table to satisfy the card.
- **No "stage" field on the stored `Quote` record.** Stage is a function of timestamps + opens; storing it would create two sources of truth.
- **No editorial copy ("stories" / `QSTORIES`) on the backend.** Production pulls those from the agents module per-conversation summary; until that exists, the frontend renders deterministic captions from the derived fields. Backend stays out of copy generation.
- **No new public endpoints.** All additions are owner-gated. The customer-facing flow is unchanged.
