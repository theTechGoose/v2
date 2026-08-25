# Rune spec — the ideal backend (refactor target)

This directory is the **source-of-truth spec** for the backend, written as
[rune](https://) `.rune` files — one per module — from which the keep/Danet backend
(controllers, coordinators, DTOs, data adapters, tests, app bootstrap) regenerates
with `rune sync`. You edit the `.rune`, regenerate, and fill in the stubbed bodies;
you never hand-author the generated tree.

**This is a refactor spec — it describes the *ideal* module boundaries, not the
current code.** The live backend ships **8 modules**, but two of them are packaging
conveniences rather than service areas: `paperwork` stapled 9 unrelated route
surfaces into one bag, and `users` folded the business-profile module back in "to
cut cross-module wiring overhead" (its own comment). This spec splits both into
cohesive bounded contexts, each with a single reason to change:

- `paperwork` → **quotes · billing · public**
- `users` → **identity · profile**

There is deliberately **no `contracts` module**: the Contract entity was merged into
the Quote — the quote IS the "Quote + Agreement" document (terms, schedule dates,
acceptance signature), and accepting the quote at `/q` is the one signature ceremony,
which also triggers milestone billing.

The result is **11 modules / 157 HTTP endpoints**. Every `.rune` passes `rune check`
(verified, 11/11), and the split is **lossless** — all 157 endpoints of the merged
backend are conserved.

## Modules

| # | Module | Endpoints | REQ | DTO | TYP | PLY | Responsibility |
|---|--------|----------:|----:|----:|----:|----:|----------------|
| 1 | `core` | 0\* | 7 | 17 | 40 | 1 | Shared substrate: KV repository, rate-limit, event bus, i18n, relative-time, sparkline, and the **transcription** client (`[PLY]` whisper/stub). No HTTP surface. |
| 2 | `identity` | 14 | 14 | 27 | 32 | 0 | **(was users)** Auth: phone-OTP send/verify (Twilio `ex:`), sessions, `/me`, super-admin & impersonation. |
| 3 | `profile` | 18 | 18 | 33 | 67 | 0 | **(was users)** The contractor's business profile: identity, address, insurance, tax, references, contract-defaults (the agreement defaults that print on the Quote + Agreement) — the data that prints on documents. |
| 4 | `crm` | 16 | 16 | 17 | 30 | 0 | Customers + the double-entry ledger (accounts, entries, computed balances). |
| 5 | `quotes` | 12 | 12 | 24 | 57 | 0 | **(was paperwork)** The proposal **and agreement** stage: the quote IS the Quote + Agreement document — line-items, terms-wizard `terms[]`, schedule dates, acceptance signature — plus document-open engagement tracking. |
| 6 | `billing` | 31 | 33 | 54 | 81 | 0 | **(was paperwork)** Money in: invoices (aging/forecast/dunning, grouped by `quoteId`), manual payments, payment-terms, receipts, and `cron` jobs. |
| 7 | `public` | 12 | 12 | 42 | 107 | 1 | **(was paperwork)** The **unauthenticated** customer surface — view/accept (the single signature ceremony, which also bills)/pay by unguessable shortlink, plus the agreement PDF. Redacted projections only. |
| 8 | `communication` | 18 | 19 | 30 | 43 | 0 | Conversations, messages, notifications, transactional email (Postmark `ex:`), public contact form, voice-stream. |
| 9 | `agents` | 21 | 21 | 70 | 83 | 6 | The AI assistant: chat, quote wizard, conversations, job-details. The **LLM client** is a `[PLY]` (openai/stub). |
| 10 | `analytics` | 10 | 10 | 32 | 107 | 1 | Read-only projections: dashboard stats, client/quote cards, win-rate insight (`[PLY]`), active jobs, global search — all quote-anchored. |
| 11 | `files` | 5 | 6 | 10 | 21 | 1 | File upload/list/meta/download/delete; internal voice-memo transcription (`[PLY]`). |

\* `core` is shared infrastructure with no controllers; its REQs are internal
(`[ENT]`-less) and consumed by the other modules.

## Why paperwork → 3 and users → 2

A `[MOD]` is **one deployable service area with one reason to change** — not one bag
per doc-folder. The two monoliths failed that test:

- **`paperwork`** mixed the *sales proposal + agreement* (quotes — one merged
  Quote + Agreement document, since the Contract entity was folded into the Quote),
  *money* (invoices/payments/terms), and the *unauthenticated customer
  surface* (public). Those have different lifecycles, DTOs, stores, and — critically
  for `public` — a different **trust boundary** (no session; the id *is* the
  capability). Splitting them lets each evolve and deploy on its own.
- **`users`** conflated *authentication* (credentials, OTP, sessions — security-
  sensitive) with the *business profile* (company info CRUD — a different audience).
  The code admits profile was a separate module folded in for wiring convenience;
  this spec splits it back.

Two cross-cutting surfaces were assigned deterministically: document-open
**views** went to `quotes` (their sole purpose is the quote "Viewed" stage / opens
count), and the **paperwork-email** dispatch routes were split by document type
(quote→`quotes`, invoice→`billing`).

Modules deliberately **left as-is**: `crm`, `communication`, `agents`, `analytics`,
`files`, `core` — each is already a single cohesive context.

## How rune maps to the generated code

| Rune construct | Generated / source artifact |
|----------------|------------------------------|
| `[MOD] x` | `backend/src/x/` + `mod-root.ts` |
| `[ENT] surface.action(In): Out` | a `@Controller("surface")` method in `entrypoints/<surface>/mod.ts` |
| `[REQ] noun.verb(In): Out` | a coordinator in `domain/coordinators/<noun>-<verb>/mod.ts` |
| `db:` / `ex:` / `fs:` / `mq:` step | a `domain/data/<noun>/mod.ts` adapter (KV, OpenAI/Postmark/Twilio, bytes, event bus) |
| instance/static step | a pure fn in `domain/business/<noun>/mod.ts` |
| fault (`not-found`, …) | an error case → `fixtures/heal-rules.json` |
| `[PLY]`/`[CSE]` | a `<noun>/base` contract + `<noun>/implementations/<case>` variants |
| `[DTO] NameDto` | a class-validator DTO in `dto/<name>.ts` |
| `[TYP:mods] t` | a named primitive + its validators |

## Cross-cutting conventions

- **Owner identity** is `[TYP:ext] userId` — minted from the session *outside* each
  module (rune's composition contract); boundary lookups wrap it as `OwnerDto`. This
  keeps every module independently syncable; `identity` is the producer that the
  `$userId` rows auto-bind to.
- **List** endpoints return a `(s)`-array wrapper DTO; **delete** returns `OkDto`
  (verb `remove`/`purge`, never the reserved `delete`); **path params** fold into the
  input DTO; **PDF/audio** are `Uint8Array` fields.
- **`public`** carries no `userId` on inputs (no auth) and returns redacted
  customer-safe projections.

## Regenerate

```sh
rune check  spec/<module>.rune                    # 0 = clean (all 11 pass)
rune sync   spec/<module>.rune --root <project>   # scaffold into the shared root
```

Sync every module into the **same** `--root` to compose one app; keep wires them
together and the `[TYP:ext] userId` rows auto-bind to `identity`. Then fill the
generated `mod.ts` stub bodies (create-once, dev-owned), `deno check`, `rune lint`.

Suggested order (substrate & producers first):
`core → identity → profile → crm → quotes → billing → public →
communication → agents → analytics → files`.

## Known modeling simplifications (honest disclosure)

Faithful at the endpoint/DTO/architecture level; a few values are simplified because
rune `[TYP]`s resolve to primitives:

- **`Record<string,string>` maps** (per-language `descriptionByLang`/`jobNameByLang`
  on quotes; the payment `methodMixCents` map) → a single primitive TYP.
- **String-union enums** (quote `status`/`stage`, payment `method`, language `en`/`es`)
  → `string` (the union noted in the TYP description).
- A few `analytics` projection field names differ cosmetically from source; all
  fields are structurally present.

Everything else — every controller method, every DTO field, every data boundary, the
LLM/transcription polymorphism, the manual-payment claim→confirm flow, and the
auth/ownership model — is reproduced.
