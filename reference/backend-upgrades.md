# Backend upgrades — what's ready for the frontend

> Built against the plan in `reference/backend.md`. Everything below is live in the v2 backend (`v2/backend/`), tested (673 passing), and ready to wire from the frontend.

## TL;DR

| Page | Endpoints you can call today |
|---|---|
| `/clients` | `GET /clients`, `GET /analytics/clients/top`, `GET /analytics/clients/segments` |
| `/quotes`  | `GET /quotes`, `GET /quotes/:id/opens`, `GET /analytics/quotes/win-rate`, `GET /analytics/quotes/insight` |

All new endpoints are session-gated (`x-session-id` header), owner-scoped, and return JSON. Money fields are **cents** on analytics roll-ups, **dollars** on the resource DTOs (matches the existing convention).

---

## 1. `/clients` page

### `GET /clients` — enriched customer cards

Replaces the previous "render whatever raw `GET /customers` returns" approach. Returns one row per customer with everything the card UI needs **already derived server-side** — frontend should **not** re-derive `status`, `temp`, `lastTone`, etc.

```ts
type CustomerCard = Customer & {
  lastWhen:         string | null;       // ISO timestamp of latest activity
  lastWhenRel:      string;              // "3 days ago" — server-formatted
  lastTone:         "hot" | "warm" | "cold";
  balanceCents:     number;              // positive = owes you, negative = credit
  balanceSub:       string;              // e.g. "INV-208 · due in 3 days" | "settled · quote out $5,800"
  activeJobs:       number;
  jobsSub:          string;              // "active" | "scheduled" | "overdue" | "no active jobs"
  status:           "active" | "lead" | "owes" | "regular" | "cold";
  temp:             number;              // 0–100 warmth score; sort key for the toolbar
  daysSinceContact: number;
  revenue12moCents: number;
};
```

The base `Customer` shape now includes two owner-controllable fields you can set on create/update:

```ts
type Customer = {
  // ...existing fields
  segment?: "property_mgmt" | "homeowner" | "small_biz" | "hoa";
  vip?:     boolean;
};
```

Pass these on `POST /customers` and `PUT /customers/:id` like any other field.

**Status precedence** (single-sourced — frontend must not re-derive):
- `owes` if `balanceCents > 0`
- `active` if accepted quote with no terminal invoice
- `lead` if only draft/sent quotes, no accepted history
- `regular` if 12mo revenue > 0 and no active job
- `cold` if `daysSinceContact > 60` and not owes

Sort by `temp` desc for the toolbar's "Warmth" sort.

### `GET /analytics/clients/top?limit=5`

Right-rail leaderboard. `limit` defaults to 5, max 50.

```ts
{
  results: Array<{
    customerId:       string;
    name:             string;
    revenue12moCents: number;
    rank:             number;   // 1-indexed
    barPct:           number;   // 0–100 — that customer's revenue / leader's revenue
  }>;
}
```

### `GET /analytics/clients/segments`

Mini bar chart of customer segment distribution.

```ts
{
  segments: Array<{
    key:   "property_mgmt" | "homeowner" | "small_biz" | "hoa" | "unsorted";
    label: string;     // e.g. "Property mgmt", "Unsorted"
    count: number;
    pct:   number;     // 0–100
  }>;
}
```

`unsorted` rolls up customers without a `segment` field set; render or hide as you like.

### Deferred — LoopBar / TodayLoop

The agents-driven "suggested today" feed (`GET /agents/conversations?suggested=today`) is **not yet wired**. Ship the page with a static seed for v1 — revisit when the agents drafting flow exists. The LoopBar's "Open the loop" CTA points at `/assistant`; avatars are decorative.

---

## 2. `/quotes` page

### `GET /quotes[?status=<stage>]` — enriched quote cards

Returns `QuoteCard[]` with a derived `stage` plus engagement signals. The `?status=` filter still works but **now filters by `stage`** (the derived value), not the raw `status` column. Pass any of the stage values below.

```ts
type QuoteStage = "draft" | "sent" | "opened" | "cooling" | "stale" | "won" | "lost";

type QuoteCard = Quote & {
  stage:        QuoteStage;
  daysIn:       number;            // days since entering current stage
  opens:        number;            // deduped to ≤1 per hour
  lastOpenAt:   string | null;
  sentDays:     number | null;     // null for drafts
  decidedDays:  number | null;     // populated only for won/lost
  customerName: string | null;     // joined for the card avatar/initials; null if customerId is orphaned
};
```

Stage rules (server-derived — don't re-derive in the frontend):

| Stage     | Trigger |
|-----------|---------|
| `draft`   | `sentAt` is null |
| `sent`    | `now − sentAt < 24h`, no opens |
| `opened`  | ≥1 open, sent ≥24h ago, last open within 48h |
| `cooling` | sent >4d ago, ≥1 open, no opens in last 48h |
| `stale`   | sent >7d ago, 0 opens |
| `won`     | `acceptedAt != null` OR a contract references this `quoteId` |
| `lost`    | `lostAt != null` OR sent >30d with no signal |

`won`/`lost` always win over earlier stages. The `opens >= 3` "hot" sub-state is a **frontend styling decision** — backend always returns `stage === "opened"`.

### Quote DTO additions

The `Quote` shape now includes lifecycle timestamps as first-class fields (no more casting):

```ts
type Quote = {
  // ...existing fields
  sentAt?:             string;   // set by the email controller on first send
  acceptedAt?:         string;   // set by the public accept endpoint
  lostAt?:             string;   // contractor-marked or auto (≥30d quiet)
  acceptedSignature?:  string;
  acceptedName?:       string;
};
```

`sentAt` is stamped automatically by `POST /quotes/:id/email` on the **first** successful send (idempotent — resends do not overwrite). The legacy `status` field still exists; `sentAt` is the source of truth for the `sent` stage.

### `GET /quotes/:id/opens` — engagement timeline

For the card flip / engagement view. Owner-gated — only the contractor who owns the quote can read this. **Do not expose this on the public surface.**

```ts
{
  opens: Array<{
    at:          string;            // ISO
    atRel:       string;            // "2h ago"
    device:      "desktop" | "mobile" | "tablet" | "unknown";
    durationMs?: number;            // when present
  }>;
}
```

Returns the full view history (not deduped) — show every open if you want; the card's `opens` count is the deduped 1-per-hour version.

### `GET /analytics/quotes/win-rate?days=90`

For `<QSideRate>`'s half-donut. `days` defaults to 90.

```ts
{
  windowDays: number;
  decided:    number;          // won + lost
  won:        number;
  lost:       number;
  winRate:    number | null;   // 0–100; null when decided === 0 (don't divide-by-zero)
}
```

### `GET /analytics/quotes/insight`

For `<QSideTip>`. Returns a single statistical observation:

```ts
{
  text: string;
  kind: "open_count" | "median_days_to_decide" | "best_day_of_week" | "static_fallback";
}
```

Until a user has 10+ decided quotes, `kind` is always `"static_fallback"` and you'll get a generic copy line — that's expected for v1. Once data accrues, real observations kick in. Render `text` directly; don't branch on `kind` in v1.

### KPI strip (`<QuotesKpis>`)

No new endpoint — derive client-side from `GET /quotes`:

- **In flight** = count where `stage in (sent, opened, cooling)`
- **Out for response** = count where `stage in (sent, opened)`
- **Drafting** = count where `stage === "draft"`
- **Decided this month** = count where `acceptedAt` or `lostAt` falls in the current calendar month

---

## 3. Things that didn't change (keep using as-is)

- `GET /notifications`, `GET /unread-count`, `POST /read-all` — unchanged
- `GET /profile` — unchanged
- `POST /quotes`, `PUT /quotes/:id`, `DELETE /quotes/:id`, `GET /quotes/:id` (raw) — unchanged behavior; DTO accepts the new optional timestamp fields
- `POST /customers`, `PUT /customers/:id`, `DELETE /customers/:id`, `GET /customers/:id` (raw) — unchanged behavior; DTO accepts `segment` + `vip`
- `POST /views` (public open-tracking POST) — unchanged
- `POST /quotes/:id/accept` (public) — unchanged
- `GET /analytics/dashboard` — unchanged

The list at `GET /customers` still returns raw `Customer[]` (no derived rollups). Use `GET /clients` for the page-aligned card shape.

---

## 4. Breaking changes to be aware of

1. **`GET /quotes` shape** — was `Quote[]`, is now `QuoteCard[]` with derived `stage`. The `?status=` query param now filters on the derived `stage`. If anything was depending on the raw `Quote[]` response, switch it to use `GET /quotes/:id` (per-record) or read `QuoteCard.<base-field>` (the base `Quote` fields are still spread onto each card).

2. **Email send now stamps the quote** — `POST /quotes/:id/email` will set `quote.sentAt` and `quote.status = "sent"` on first success. Idempotent on resend. If the frontend was relying on `status` staying `draft` after a send, that's fixed now.

That's it for breaking changes.

---

## 5. Auth + errors

All the new endpoints follow the established pattern:

- Send the session via `x-session-id: <id>` header (same as today's `/customers`, `/quotes`, etc.).
- No session → `401`-equivalent (response body has `ok: false`).
- Cross-owner reads → `403` (e.g. trying to read `GET /quotes/:id/opens` for someone else's quote).

Money rules unchanged: DTOs are dollars; analytics roll-ups are cents.

---

## 6. Verification

`deno task test` from `v2/backend/` passes 673 tests covering:

- 13-rule customer-card derivation matrix
- 15-rule quote-stage derivation matrix
- 4 canonical e2e cases per new endpoint (happy / no-session / cross-owner / shape)
- `sentAt` stamping + idempotency
- Owner-isolation on `/quotes/:id/opens`
- Win-rate boundary cases (window exclusion, divide-by-zero, 50% round-trip)
- Insight static-fallback path

If anything looks off in practice, the unit-test files are the authoritative spec for each rule — same path each time:
`v2/backend/src/analytics/domain/coordinators/<flow>/int.test.ts`.
