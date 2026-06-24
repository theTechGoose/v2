# Page — public-contract (`/c/:id`)

The public, auth-FREE service-agreement page a customer opens from an SMS/email
link. It shows the full contract document and (when unsigned) an inline
signature pad to e-sign. Route file: `routes/c/[id].tsx` (46 lines).

## Purpose
Let a customer review and electronically sign their contract without logging
in. The page is intentionally document-like (printable) and renders in the
contractor's outgoing-comms language.

## Composition & data flow
- **NOT SSR-fetched.** Unlike the sibling invoice page, the route does **not**
  call `ssrBackendGet`. The route is a synchronous `define.page` that paints a
  shell + mounts the **`PublicContractView` island**, which fetches the
  contract **client-side** in a `useEffect`:
  `fetch("/api/contracts/:id/public")` (same-origin `/api` proxy) and paints a
  skeleton first. This was a deliberate fix (problems.md #25): the old SSR
  `await` blocked the first byte → blank-white screen on slow networks.
- **Data source:** `GET /contracts/:id/public` → `ContractPublic`
  (data-model § 1.5). Auth-FREE.
- **Component tree:**
  - `routes/c/[id].tsx` (page-composition) — `<Head>` (title, `/landing.css`,
    inline `<style>` mobile+print block), page wrapper div, max-width:760px
    column.
    - `PublicContractView` (island) — loading skeleton / `ErrorCard` / `ContractDoc`.
      - `ContractDoc` (shared-components/contract-doc) — the rendered document.
        - `PublicSignContract` (island) — mounted by `ContractDoc` only when unsigned.
- **Error / expired state:** the island catches a non-ok fetch (404/expired/
  revoked link) and renders the exported **`ErrorCard`** ("This link is no
  longer available" / "We can't open this agreement"). There is no SSR error
  branch on this route — the error is purely client-side.

## Sections
1. Brand strip (logo/business name/address) — `.ctr__no-print`.
2. Pink-ribbon document card (`.ctr`): doc-tag + status pill, hero title,
   "between … and …", To/From party cards.
3. Job details (bullets + line-item table + green total card).
4. Payment schedule milestones.
5. Terms (wizard grid + 14 numbered legal clauses).
6. Signature block (contractor card + customer card; unsigned → sign pad;
   signed → "Signed and binding" band).
7. Contact footer + "powered by" strip.

(All section internals are owned by `contract-doc`; see that spec.)

## Page palette / shell (inline)
- Wrapper: `min-height:100dvh; background:#f7f6f1; color:#1c2c30;
  font-family:-apple-system,…; padding:32px 16px calc(64px + var(--kb-inset,0px));
  scroll-padding-bottom:var(--kb-inset,0px)`. The `--kb-inset` var is the mobile
  soft-keyboard inset (set by `islands/MobileViewport.tsx`) so the sign-pad +
  name input aren't hidden behind the keyboard.
- Column: `max-width:760px; margin:0 auto`.
- CSS: `/landing.css` (resets + the `.spinner` class the sign island reuses) +
  the route's inline `<style>` (mobile 720px overrides + print). See
  `css/public-contract.css`. **`/contracts.css` is NOT loaded here** — that
  stylesheet belongs to the authed `routes/contracts/index.tsx` list page.

## Build order
1. Build the page shell (Head, wrapper, 760px column, inline mobile+print CSS).
2. Build `contract-doc` (shared) against its isolate cases — the bulk of the UI.
3. Build the `public-sign-contract` island (canvas sign pad) it mounts.
4. Build the `public-contract-view` island (skeleton → fetch → ContractDoc /
   ErrorCard) and wire it into the route.

## Local components
- `components/public-contract-view/` ← `islands/PublicContractView.tsx` (island).
- `components/public-sign-contract/` ← `islands/PublicSignContract.tsx` (island,
  signature capture).

## Anti-patterns (page level)
- **`location.reload()`** in `PublicSignContract` after a successful sign
  (900ms timeout) — flagged in that component's spec. A SPA-friendly rebuild
  would swap to the signed view in place (like the invoice claim does with
  local `done` state).
- **Public composite-read fan-out** on `GET /contracts/:id/public` — data-model
  hazard #7. Serve from a denormalized projection.
