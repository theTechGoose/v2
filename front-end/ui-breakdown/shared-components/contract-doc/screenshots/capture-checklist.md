# Capture checklist — contract-doc (ContractDoc)

**Theme:** light only (public document palette).
**Backend:** REQUIRED — needs a real signed/unsigned contract id. The page is
auth-FREE (customer link), so a valid `/c/:id` URL is all you need; obtain one
by sending a contract from the authed app (assistant flow) and copying the
short link, or hit `/contracts/:id/public` to confirm a live id.
**NO fabricated screenshots** — only shoot against a real backend response.

## Route / URL
- `http://localhost:5280/c/<contractId>` — the doc renders inside
  `PublicContractView` after its client fetch resolves.
- The doc is the `<article class="ctr">` plus its brand strip + powered-by
  strip.

## Viewports (mobile-first)
- **~390px** (primary phone) — verify the route's 720px overrides fire:
  `.ctr__inner` padding 28/22, `.ctr__title` 30px, `.ctr__total-amt` 34px,
  Terms grid 1-col, milestones 2-up; To/From + signature cards stack.
- **640px** — mid tablet.
- (Optional 760px to see the full max-width column.)

## Element(s) to crop
1. Full document top: brand strip → ribbon → doc-tag + status pill → hero
   title + "between … and …" line.
2. To/From party cards (auto-fit two-up vs stacked at 390).
3. Job details: bullet list + line-item table + green total card ("the money
   moment").
4. Payment schedule milestone cards.
5. Terms: wizard KV grid + numbered legal clause list.
6. Signature block (see transient states).
7. Contact footer (initials avatar) + powered-by strip.

## Transient states to drive (each is a different contract id/status)
1. **unsigned** — teal "Awaiting your signature" pill; "YOUR signature" dashed
   card; `PublicSignContract` pad mounted below.
2. **signed** — green "Signed {date}" pill; filled cursive customer signature
   card; green "Signed and binding" band; NO pad.
3. **declined** — red "Declined" pill; signature section entirely absent.
4. **es** — a contract whose `contractor.commsLanguage='es'`: whole doc in
   Spanish (docTag "Cotización y Acuerdo", "Esperando tu firma", clause
   titles, milestone labels).
5. **no-line-items / single-line-item** — confirm the line-item table is
   suppressed and section numbers stay gapless (01,02…).

## Motion to film
- None in the doc. (Sign-pad motion is filmed under public-sign-contract.)

## Print
- `Cmd-P` / print preview at desktop width: `body` white, brand strip
  (`.ctr__no-print`) hidden, card shadow removed + 1px LINE border. One frame.
