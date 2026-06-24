# PaymentsPage

The /payments island. Fetch → enrich → derive status → bucket → render
hero/KPIs/tracks/side-rail. 1028 lines; PaymentCard, LandedRow, the four side
widgets, hero, KPIs are local sub-components (own folders).

## 1. Classification & behavior
- **Bucket:** `island` (`islands/PaymentsPage.tsx`).
- **Interaction tier:** **whole-page island, client-only state.** Self-fetches
  on mount; `lang` prop is an ignored SSR seed (reads `langSignal.value`).
- **Client state owned:** `s: State { loading, error, payments, invoices,
  customers }`. That's it — there are **no mutations on this page**, so no busy
  flags, no modals. (PaymentCard owns only a local `flipped`.)
- **Server actions + flash:** **none.** This is a read-only page. PaymentCard's
  CTA + back-foot buttons are no-ops (`stopPropagation` only); the hero CTAs are
  links into `/assistant?seed=…`. No `location.reload()` anywhere.
- **Data source per region:**
  - payments ← `paymentsClient.list()` (`GET /payments`), `.catch → []`.
  - invoices ← `dashboardClient.invoices(undefined)`, `.catch → []` (joined to
    payments to resolve customer + issuedDate for avg-days).
  - customers ← `dashboardClient.customers()`, `.catch → []`.
  - parallel `useEffect([])`, `alive` guard.
- **Honest-empty:** `loading` → Skeletons (SHARED); `error` → `.qpage-error`
  (UNSTYLED, see §8); else "fresh" hero variant + Landed-track hint + per-widget
  empty copy.
- **Liveness:** request-response only; no polling. (No refresh path at all — the
  page never mutates.)
- **Data-shape hazards:**
  - **Payment-sum rollups over jobs/payments are recomputed client-side every
    render**: `monthTotal`/`transitTotal`/`attentionTotal`, `avgDays`
    (receivedAt − issuedDate over landed), and all four side widgets. On a real
    backend these mirror `DashboardStats.payments.{methodMixCents,topPayors}` +
    `revenue.sparkline12mo` — whole-account Σ scans. **[denormalize/precompute].**
  - **Status is invented client-side** (`deriveStatus` + `SETTLE_DAYS`) — the
    `Payment` DTO has no status. ACH<2d / check<5d ⇒ "transit"; everything else
    "landed". `attention` is never produced (no source signal) so its track +
    KPI always read 0.
  - **PSideFlow buckets by array index** (`weeks[11-(i%12)] += a`), NOT by
    `receivedAt` — fabricated trend; hardcoded Feb/Mar/Apr labels.
- **Anti-patterns:**
  - Whole-page island, frozen SSR props (only `lang`), fetch-on-mount. **Fix:**
    SSR the payment list as a hydration seed.
  - **Undefined CSS classes** in the Top-payors widget + LandedRow render
    unstyled (see payment-side-rail.md / landed-row.md). Real visible bug.
  - PaymentCard actions are dead (no-ops). The "Record a payment" / "Export
    this month" hero CTAs route through the assistant rather than acting here.

## 2. Anatomy
```
<>
  <PaymentsHero …/>                          ← .pph + .pph__stack stubs
  <PaymentsKpis …/>                          ← .qkpi (In-transit cell accent)
  <div class="qlay">
    <div>                                     ← main column
      {attention>0 && <QuoteTrack 01 Needs attention> PaymentCard[] }
      <QuoteTrack 0n Just landed>
        recentLanded → .qcards PaymentCard[]
        olderLanded  → .qdone   LandedRow[]
        (else landedEmpty hint)
      {transit>0 && <QuoteTrack 0m In transit> PaymentCard[] }
    </div>
    <aside class="qside">                      ← sticky rail
      <PSideFlow/> <PSideTopPayors/> <PSideMix/> <PSideTip/>
    </aside>
  </div>
</>
```
- Local helpers: `methodLabel`, `tnFor`, `P2PIcon`, `METHOD_ICON`,
  `METHOD_AV_BG`, `SETTLE_DAYS`, `deriveStatus`, `initialsOf`, `whenLabel`,
  `noteFor`, `enrich`, `STATUS_MOOD`.
- Deps: QuoteTrack[shared], Skeletons[shared], `I`/`ICN`, `fmtMoney`, `tFor`/
  `langSignal`, paymentsClient/dashboardClient.

## 3. Props
| name | type | default | widget | signal? |
|---|---|---|---|---|
| `lang` | `Lang` | (ignored SSR seed) | — | reads `langSignal.value` |

## 4. States → cases
| state | meaning | case |
|---|---|---|
| loading | Skeletons | `isolate/cases/loading/loading.json` |
| error | `.qpage-error` text | `isolate/cases/error/error.json` |
| fresh | 0 payments → fresh hero + empty widgets | `isolate/cases/fresh/fresh.json` |
| landed-only | landed payments, no transit/attention | `isolate/cases/landed/landed.json` |
| with-transit | an ACH/check still settling → transit track shows | `isolate/cases/with-transit/with-transit.json` |

## 5. Events
- No page-level interactive events. (Track collapse → QuoteTrack; card flip →
  PaymentCard; hero CTAs are plain `<a>` navigations.)

## 6. Motion
- None of its own. Hero stub-stack hover/rotate = payments-hero. Card flip =
  PaymentCard. Reduced-motion via global clamp.

## 7. Responsive (own `@media`)
- quotes.css: `≤1200px` `.qlay`→1 col + `.qside` static; `≤768px` `.qcards`/
  `.qkpi`→1 col; `≤1100px` `.qdone`→1 col; `≤560px` `.qdone__row` tighter +
  `.qdone__when` hidden.
- payments.css: `≤760px` `.pph`→1 col + stub stack re-fans vertically.

## 8. A11y
- `.qpage-error` unstyled, no `role="alert"`.
- `.pph__stack` is `aria-hidden="true"` (decorative) — good.
- PaymentCard buttons that do nothing should be removed or wired (they read as
  actionable but aren't).

## 9. Used on
`/payments` only (mounted by `routes/payments/index.tsx`).
