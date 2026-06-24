# contract-doc (ContractDoc)

The rendered service agreement — the whole printable contract document a
customer reads at `/c/:id`. One pure function (`ContractDoc`) takes a single
`ContractPublic` projection and lays out: brand strip → pink-ribbon card →
doc-tag + status pill → hero title + "between … and …" line → To/From party
cards → Job details (bullets + line-item table + green total card) → Payment
schedule milestones → Terms (wizard grid + numbered legal clauses) → Signature
block → contact footer → "powered by" strip. It also exports `ErrorCard` (the
expired/gone state) and the colour constants `INK`, `LINE`, `BG` (the host
route imports these for its page wrapper).

> **Genuinely shared.** Imported by BOTH the public route's island
> (`islands/PublicContractView.tsx`) AND — historically — the route directly;
> today the route mounts the island and the island renders `ContractDoc`. It
> lives in `components/` (not `islands/`) so it can render server- or
> client-side without hydration. Category `shared-components`.

## 1. Classification & behavior
- **Bucket:** `static` / **page-composition** (`components/contract-doc.tsx`,
  1066 lines). A pure presentational function — no hooks, state, fetch, or
  effects of its own. It *composes* one island (`PublicSignContract`) into its
  signature section.
- **Interaction tier:** **page-composition / static.** All output is
  deterministic from the `contract` prop. The only interactivity it introduces
  is the embedded sign-pad island (documented separately under
  `pages/public-contract/components/public-sign-contract/`).
- **Server-mutation action endpoint:** none directly. The signature it mounts
  posts `POST /api/contracts/:id/sign` (see public-sign-contract). No flash;
  the island reloads.
- **Data source:** none of its own — `contract` is a prop. Upstream it comes
  from `ssrBackendGet`/client-fetch of **`GET /contracts/:id/public`** →
  `ContractPublic` (data-model § 1.5). Auth-FREE customer link.
  - **Honest-empty / expired:** handled one level up — when the fetch fails the
    island/route renders `ErrorCard` (exported here) instead of `ContractDoc`.
    `ContractDoc` itself assumes a present `contract` and tolerates missing
    optional sub-objects (no `customer`, no `lineItems`, etc.) by conditionally
    rendering each section.
- **Liveness:** none. Pure request-response render. The signed/declined state
  is whatever the projection's `status` was at fetch time; it does not poll —
  the embedded sign island forces a full `location.reload()` to repaint as
  "signed" (see anti-patterns).
- **Data-shape hazards:**
  - **Public composite-read fan-out (flagged).** `ContractPublic` is a join:
    contract → source quote (`jobDetails`, incl. multi-lang
    `*ByLang`) → customer → contractor profile (name/business/phone/email/
    address/state/commsLanguage/hasLogo) → wizard `terms[]`. Customer-facing,
    uncached, hit from SMS/email links (bursty). Data-model hazard #7:
    **[serve from a denormalized public projection / point-read, not a live
    multi-table join].** (Smaller fan-out than the invoice — no payment-method
    or sibling-installment join here.)
  - **Money is INTEGER CENTS.** `totalAmount` and each `lineItem.price` are
    cents; `fmtMoneyExact` formats. `total = contract.totalAmount ?? Σ(price×qty)`
    — if `totalAmount` is absent it is recomputed from line items, so a wrong
    unit on either side double-counts.
  - **Terms stored in English, localized at render.** `Term.value` is EN;
    `expandTermValue` + `localizeTermValue` (`lib/term-i18n.ts`) translate at
    render per `lang`. Free-text and ratios ("50/50") pass through; only known
    preset labels + numeric durations are mapped (data-model § 1.5 note, MEMORY
    `project_job_details_multilang`).
  - **`commsLanguage` is the language switch**, read off `contractor`, not the
    customer — the doc renders in the *contractor's* outgoing-comms language.
  - **Section numbering is computed, not literal.** A `let sec` counter +
    `num()` increments only when a section actually renders (short-circuit), so
    the 01/02/03 sequence is gapless even though Job details / Payment schedule
    / Signature are each conditional. A rebuild that hard-codes numbers will
    show gaps.
  - **Gating booleans:** `signed = status==='signed'`, `declined =
    status==='declined'`; everything else = "awaiting". `declined` suppresses
    the **entire** signature section (no pad, no signed band).

## 2. Anatomy (inline-style + class structure)
All styling is **inline `style=` strings** (public palette hex). The only CSS
classes are layout hooks the host route's `<style>` targets at the 720px
breakpoint + print: `.ctr`, `.ctr__inner`, `.ctr__title`, `.ctr__total-amt`,
`.ctr__terms-grid`, `.ctr__milestones`, `.ctr__no-print`, `.ctr__tofrom`.

```
<>                                                    ← Fragment (no wrapper)
  <div class="ctr__no-print">                         ← brand strip (hidden in print)
     [hasLogo] <img src="/api/public-logo/contract/{id}">
     <div>{businessLabel}</div>                       ← TEAL .18em caps 11px
     [addressLine] <div>{addressLine}</div>
  <article class="ctr"                                ← CREAM #fffdf7, radius 24, big shadow,
                                                          1px rgba(255,107,107,.10) border
     <div [8px pink ribbon] linear-gradient PINK→PINK_DARK>
     <div class="ctr__inner" padding 36px 44px 40px>
        <div [flex space-between]>                     ← top row
           <span doc-tag pill>{docTag} · #{ID8}</span> ← rgba(20,72,82,.10), TEAL caps
           <Pill … />                                  ← status: signed(green) / declined(red #a83b3b) / awaiting(teal)
        <h1 class="ctr__title">{heroTitle}</h1>        ← Helvetica Neue 900, 42px, TEAL
        [customerName] <div>between <b>{biz}</b> and <b>{cust}</b> · effective <b>{date}</b></div>
        <section class="ctr__tofrom"                   ← grid auto-fit minmax(220px,1fr) gap14
           <PartyCard role={to}  … />                  ← customer
           <PartyCard role={from} … />                 ← contractor
        [items>0] <section>                            ← JOB DETAILS
           <SectionHeader n="01" title={jobDetails}/>  ← see §"SectionHeader" below
           {detailLines → <ul> bullets (green dot) | <p> if single}
           [items>1] <table>                           ← description / [qty] / amount cols
           <div [green total card]                     ← linear 135deg #e8f3e2→#dceadb,
                 .ctr__total-amt>{fmtMoneyExact(total)} ←   1px rgba(81,152,67,.25), radius16
        [milestones>0] <section>                       ← PAYMENT SCHEDULE
           <SectionHeader n="02" .../>
           <div class="ctr__milestones" grid auto-fit minmax(140px,1fr)>
              {milestones.map → KV-ish card label/amount/when}
        <section>                                      ← TERMS (always renders)
           <SectionHeader n="03" .../>
           [hasTermGrid] <div class="ctr__terms-grid" grid 1fr 1fr>{<KV/> rows}</div>
           [hasTermGrid] <hr 1px LINE/>
           <ol>{clauses.map → <li><b>{title}.</b> {body}</li>}</ol>  ← 14 numbered legal clauses
        [!declined] <section>                          ← SIGNATURE
           <SectionHeader n="04" title={signHere}/>
           <div>{signed ? bothCaptured : bySigning(customerFirst)}</div>
           <div [grid auto-fit minmax(200px,1fr)]>
              <div [contractor card]>                  ← cursive name (Snell Roundhand), "by", date
              {signed
                ? <div [customer SIGNED card]>          ← cursive customerSignedName + signedAt
                : <div [YOUR signature card]>}          ← dashed underline + "sign / type below"
           {!signed && <PublicSignContract contractId={id} lang={lang} />}  ← ISLAND
           {signed && <div [green "Signed and binding" band + check svg]>}
        [phone||email] <footer [contact]>              ← initials avatar + "Questions? Call/email …"
  <div [powered-by strip]> <img /logo.png> {poweredBy} #{ID8}
```

- **Local sub-components (all in this file):** `Pill`, `SectionHeader`, `KV`,
  `PartyCard`. Local helpers: `cstr(lang)` (i18n string table), `expandStateName`,
  `expandTermValue`, `isEmptyWarranty`, `computeMilestones` (→ `lib/payment-split.ts`),
  `sumLineTotals`, `initialsFromName`, `fmtDate`, `termValue`.
- **⚠️ SectionHeader is NOT ui/SectionHead.** This component defines its own
  private `SectionHeader({n,title})` (a numbered teal badge + caps title +
  hairline rule). It does **NOT** import the shared `components/ui/SectionHead`
  (which, per `shared-components/ui-section-head/`, is confirmed-unused, zero
  imports). The build-brief's claim that contract-doc "uses ui/SectionHead" is
  inaccurate — record the private `SectionHeader` instead. (See Open questions.)
- **External deps:** `lib/format.ts` (`detailLines`, `fmtMoneyExact`, `fmtPhone`,
  `telHref`), `lib/i18n.ts` (`tFor`), `lib/term-i18n.ts` (`localizeTermValue`),
  `lib/payment-split.ts` (`computePaymentSplit`, `MilestoneRole`), and the
  `PublicSignContract` island.

## 3. Props
| name | type | default | control | signal? |
|---|---|---|---|---|
| `contract` | `ContractPublic` (required) | — | json (single object) | no |

`ContractPublic` shape (data-model § 1.5): `id`, `quoteId?`, `customerId?`,
`status?`, `totalAmount?`(cents), `effectiveDate?`, `startDate?`,
`estimatedCompletionDate?`, `signedAt?`, `customerSignedName?`, `contractor?`
(name/businessName/phoneNumber/email/addressLine/state/commsLanguage/hasLogo),
`customer?` (name/phoneNumber/email), `jobDetails?` (summary/jobName/description
+ `*ByLang` maps + `lineItems[]`), `terms?: Term[]`, `createdAt?`.
`ErrorCard({ message, lang })` is the secondary export.

## 4. States → cases
| state | meaning | case |
|---|---|---|
| unsigned | `status` not signed/declined → teal "Awaiting your signature" pill; mounts `PublicSignContract` | `cases/unsigned/unsigned.json` |
| signed | `status='signed'` → green pill, filled cursive customer signature, "Signed and binding" band, no pad | `cases/signed/signed.json` |
| declined | `status='declined'` → red pill; **whole signature section suppressed** | `cases/declined/declined.json` |
| es | `contractor.commsLanguage='es'` flips the whole doc; `*ByLang.es` copy used | `cases/es/es.json` |
| no-line-items | `lineItems=[]` → Job details section omitted; total from `totalAmount`; numbering stays gapless | `cases/no-line-items/no-line-items.json` |
| single-line-item | one item → bullets render, line-item table suppressed (`items.length>1` gate); "Due Now" terms → single full milestone "on signing" | `cases/single-line-item/single-line-item.json` |
| error/expired | (separate export) `ErrorCard` "This link is no longer available / can't open" | covered by `public-contract-view/cases/error` |

## 5. Events
- `ContractDoc` itself emits no events (static).
- The embedded `PublicSignContract` island owns the signature drawing + submit
  events — see that component's spec § 5.

## 6. Motion (real CSS only)
- The doc has **no animation** of its own. No transitions, no keyframes.
- The host route adds a 720px-breakpoint resize of padding/font + a print
  block (see `css/contract-doc.css`).
- The embedded sign island has the only motion (button `transform 160ms` +
  borrowed `.spinner`). No rAF/canvas animation in the doc; the canvas drawing
  is in the island (jank lint there).
- **Reduced motion:** N/A for the doc (nothing animates). The public surface
  does **not** load the Sabor tokens reduced-motion clamp — flag carried on the
  sign island/skeleton.

## 7. Responsive
- Mobile-first; the doc lives inside the route's `max-width:760px` column.
- All multi-column blocks use `grid-template-columns: repeat(auto-fit, minmax(…,1fr))`
  (To/From 220px, milestones 140px, signature 200px) so they collapse to one
  column on phones without a media query. The Terms grid is a fixed
  `1fr 1fr` collapsed to `1fr` by the route's `.ctr__terms-grid` 720px override.
- At ≤720px the route shrinks `.ctr__inner` padding (36/44→28/22), `.ctr__title`
  42→30, `.ctr__total-amt` 42→34, milestones → fixed 2-up. Verify at ~390 and
  640.

## 8. A11y
- Headings: a single `<h1>` (hero title). Section headers are styled `<div>`s
  (not `<h2>`) — heading hierarchy is shallow (rebuild could promote
  `SectionHeader` to `<h2>`).
- Status, doc-tag, milestone labels are plain text/colour — colour-only status
  (green/red/teal pill) but each pill also carries a text label, so not
  colour-alone.
- Links (`tel:`/`mailto:`) are real anchors. The brand-strip `<img>` and
  `/logo.png` have empty `alt=""` (decorative) — correct.
- Signature-section a11y lives on the embedded island (canvas keyboard
  fallback discussion there). The doc's "type your name below" copy points at
  it.

## 9. Used on
- **public-contract route** (`routes/c/[id].tsx`) — via the
  `PublicContractView` island which renders `<ContractDoc>` after the
  client-side fetch resolves.
- **`islands/PublicContractView.tsx`** — the direct importer (renders
  `ContractDoc` or `ErrorCard`).
- Evidence: `grep -rn "contract-doc"` → `routes/c/[id].tsx` (imports `BG, INK,
  LINE`) + `islands/PublicContractView.tsx` (imports `ContractDoc`,
  `ContractPublic`, `ErrorCard`). No authed-app importer.
