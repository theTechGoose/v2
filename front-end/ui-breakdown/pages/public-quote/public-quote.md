# Page — Public Quote (`/q/:id`)

Customer-facing, **auth-free** SSR quote document. A homeowner opens a link from
an SMS/email (`https://…/q/<quoteId>`), reads the estimate, and either **accepts**
(type-name e-sign), **declines** (with reason), or **asks a question** — all
without logging in. This is the *public surface*: a printed-document look with a
**separate inline-styled palette** (warm paper `#f7f6f1`, headings `#144852`,
body `#1c2c30`, system font stack, 18px card radius). It is **not** Sabor-tokened
— see `design-tokens.md` § Public surface palette.

Route source: `routes/q/[id].tsx` (copied to `js/[id].tsx`, 345 lines).

## 1. Purpose & data flow
- **SSR fetch:** `ssrBackendGet<QuotePublic>(`/quotes/${id}/public`)` inside the
  `define.page` async handler. `ssrBackendGet` returns
  `{ ok, status, data?, errorText? }` (`lib/backend-fetch.ts`). On `r.ok` →
  `quote = r.data`; otherwise `quote` stays `undefined`.
- **No auth.** Ownership is implicit in the route + opaque id (the link itself is
  the bearer token). There is no session/cookie gate, no `ssrBackendGetAuthed`.
- **Language resolution (multi-lang):** `lang: Lang = quote?.contractor?.commsLanguage === "es" ? "es" : "en"` (roadmap p.13 — customer-facing copy follows the
  contractor's *outgoing-comms* language, default `en`). Resolved ONCE at SSR and
  threaded as a prop to `PublicShell`, `QuoteCard`, and the islands. The page uses
  `tFor(lang, key, vars)` (explicit-lang lookup) — never the reactive `t()`,
  because there is no on-page language toggle.
- **Per-language content fields:** `QuotePublic` carries `jobNameByLang`,
  `summaryByLang`, `descriptionByLang` (keyed by lang code). The page reads
  `…ByLang?.[lang] ?? <flat fallback>` so the document renders in the picked
  language when those maps are populated (see `project_job_details_multilang`
  memory). Title precedence:
  `jobNameByLang[lang] ?? jobName ?? summaryByLang[lang] ?? summary ?? tFor(lang,"publicQuote.quote")`.
- **Money is CENTS.** `estimatedTotal` and each `lineItems[].price` are integer
  cents; `fmtMoneyExact` divides by 100 (`1099000` → `"$10,990.00"`). Total =
  `estimatedTotal ?? Σ price*qty`.

### Data-shape hazards
- **Public composite-read join fan-out (data-model #7):** `/quotes/:id/public`
  joins the quote → **contractor profile** (`name/businessName/phone/email/
  addressLine/commsLanguage/hasLogo`) + **customer** (`name`) into one
  `QuotePublic`. These links are customer-facing, uncached, and hit from
  SMS/email (bursty). Rebuild target: serve a **denormalized public projection /
  point-read**, not a live multi-table join.
- **Honest-empty / expired-link:** when `!r.ok` the page builds
  `err = tFor(lang,"publicQuote.linkExpired")` and renders `ErrorCard`. Also
  guards `err || !quote`. Note the lang on an error is derived from a
  `quote?.contractor` that is `undefined` → always falls back to `en` on a failed
  fetch (a *Spanish* expired link will show in English — minor).
- `quote.id.slice(0,8)` is rendered as the human reference (`#a1b2c3d4`).

## 2. Page composition (inline render functions — DOCUMENT THESE)
The route defines three module-local render functions (NOT islands, NOT shared
components). They are the page's `page-composition` tier and must be rebuilt as
part of this page:

| fn | role | tier |
|---|---|---|
| `PublicShell({children,brand,address,logoUrl,lang})` | warm-paper outer frame: `min-height:100dvh;background:#f7f6f1`, centered `max-width:640px` column, optional logo `<img>` (≤48px tall, from `/api/public-logo/quote/:id` when `contractor.hasLogo`), green eyebrow headline (businessName→name→`publicQuote.contractorFallback`), optional address line, the `{children}` slot, and a `powered by Paperwork Monster` footer. | page-composition |
| `QuoteCard({quote})` | the white `border-radius:18px` document card: header (eyebrow "Quote" + hero `<h1>` + optional sub-summary + `#id8` + accepted/declined status pill), optional greeting, job-details paragraph/bullets, **line-item table (only when `lineItems.length > 1`)**, estimated-total band, the mounted `PublicQuoteActions` island (only when not accepted/declined), and a contractor contact footer (tel/mailto). | page-composition |
| `ErrorCard({message,lang})` | white card, `publicQuote.errorHeading` + message. Shown on expired/unavailable. | page-composition |
| `jobDetailsBlurb(summary)` | helper: lower-cases + strips a leading `"Quote: "` so the derived job-details sentence reads naturally. | (pure fn) |

`<Head>` sets a per-lang `<title>` and loads `/landing.css` (resets only).

## 3. Sections (top → bottom, inside PublicShell)
1. **Brand header** — optional logo, green uppercase eyebrow (business/contractor
   name), optional address, 18px gap.
2. **QuoteCard header** — "QUOTE" eyebrow, hero title (`Helvetica Neue` 24/900),
   optional secondary summary line (only when a distinct `jobName` ≠ `summary`),
   `#<id8>`, and a status pill: **Accepted** (green, `status==="accepted"`) /
   **Declined** (`#a83b3b`, `status==="lost"`).
3. **Greeting** — `publicQuote.greeting {name}` (customer first name) when a
   linked customer name exists.
4. **Job details** — three branches off `detailLines(qDesc)`:
   - `>1` lines → green-bulleted `<ul>`;
   - `1` line → `<p white-space:pre-wrap>`;
   - `0` lines → derived sentence `publicQuote.jobDetails` interpolating
     `jobDetailsBlurb(summary)` + `publicQuote.linesOfWork.{one|other}` (only when
     a `summary` exists; else nothing).
5. **Line items table** — **rendered only when `lineItems.length > 1`** (a single
   line just repeats the total; the bullets above already describe scope). The
   `Qty` column is shown only when some line has `quantity > 1` (`showQty`); each
   row total = `price*qty` via `fmtMoneyExact`.
6. **Estimated-total band** — green-tinted gradient pill (`border-radius:14px`),
   "Estimated total" eyebrow + big `Helvetica Neue` 28/900 amount.
7. **Actions island** — `<PublicQuoteActions>` mounts here **unless** the quote is
   already `accepted`/`lost` (settled quotes hide all action UI).
8. **Contact footer** — dashed top border; tel + mailto links when the contractor
   has a phone/email (`fmtPhone`, `telHref`).
9. **Powered-by footer** — subtle `#b9c1bf` `powered by {brand}`.

## 4. States
| state | trigger | rendering |
|---|---|---|
| valid-pending | `r.ok`, `status` ∉ {accepted,lost} | full card + actions island |
| accepted | `status==="accepted"` | green "Accepted" pill; **no** actions island |
| declined | `status==="lost"` | `#a83b3b` "Declined" pill; **no** actions island |
| expired-link | `!r.ok` | `ErrorCard` with `publicQuote.linkExpired` |
| unavailable | `r.ok` but `!quote` (defensive) | `ErrorCard` with `publicQuote.unavailable` |
| es | `contractor.commsLanguage==="es"` | every string via `tFor("es",…)` |

## 5. Build order
1. `PublicShell` frame (paper bg, 640px column, logo/eyebrow/address/footer).
2. `ErrorCard` (cheap; unblocks the failure path).
3. `QuoteCard` header + status pill.
4. Job-details branch logic (`detailLines` + derived sentence).
5. Line-item table (gated `>1`, `showQty` column).
6. Estimated-total band.
7. Mount `PublicQuoteActions` island (see its spec) — gated on not-settled.
8. Contact footer + powered-by.
9. Wire `<Head>` title precedence + `/landing.css`.

## 6. Local components
- `components/public-quote-actions/` ← `islands/PublicQuoteActions.tsx` (island;
  decline/ask + delegates accept to PublicAcceptQuote).
- `components/public-accept-quote/` ← `islands/PublicAcceptQuote.tsx` (island;
  type-name e-sign accept flow).

## 7. Responsive & a11y
- **Single column**, `max-width:640px` container, `padding:32px 16px`. No media
  queries of its own — the 640px cap *is* the responsive story; verify at ~390px
  (mobile) and 640px. Uses `100dvh` + `--kb-inset` padding so the soft keyboard
  doesn't cover the inputs.
- A11y gaps: the status pill is a decorative `<span>` (no role); the document has
  one `<h1>` (good). Inputs/buttons live in the islands (see their specs).

## 8. CSS
Almost entirely inline styles (captured in `js/[id].tsx` and the component specs).
`css/public-quote.css` documents only the externally-loaded `/landing.css` reset
expectations + the `--kb-inset` soft-keyboard variable contract.
