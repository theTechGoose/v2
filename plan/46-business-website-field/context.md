# 7.10 ⬜ NW-06b — Business website on the From block (M) · slug `nw-06b-website-field`

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 7.10) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

- [ ] RED Deno int (`users/.../business-identity` store test): `upsert({ websiteUrl:"https://hans.work" })` round-trips. RED jest integration (`settings.int.test.ts`): `PUT` the identity with `websiteUrl` → `GET /quotes/:id/public` `contractor.websiteUrl` present. RED e2e (`settings-editable.cy.ts` + `ux-doc-preview.cy.ts`): Settings has `[data-cy=settings-website]`; the From card shows the URL.
- [ ] EDIT: `backend/src/users/dto/business-identity.ts` (`@IsOptional() @IsUrl() websiteUrl?`), the identity store, `PublicContractor` (`public-controller:878-903`) + `loadContractor` (`:906-934`), `SettingsPage.tsx` input, `doc-parts.tsx:183-248 PartyCard` row, `AsstChat.tsx:5571-5625` preview, `render-quote-pdf/mod.ts:161-166`, `send-paperwork-email/mod.ts:392-403`. Remove the dead `websiteUrl?` in `front-end/clients/profile.ts:20` or wire it.

## Phase context (verbatim from the plan, `Phase 7 — Remaining medium items (no decision needed; any order; after Phases 1–5 if time is short)`)



## Source items from the triage (`new-working-issues.md`, client's words + verdict + evidence)

- Make sure the "From" block includes email and website when the Dragon has provided them. (Screenshot shows only name and phone.) [p5]
  - **NW-06 ◩ email already wired everywhere; website does not exist in the data model; plus one real bug.** Effort S (prop) / M (website).
  - Evidence — email renders in all four From surfaces: `front-end/components/quote-doc.tsx:396-403` → `PartyCard`
    (`doc-parts.tsx:183-248`, email row `:223-239`); assistant preview `AsstChat.tsx:5571-5625` (`from.email`); PDF
    `render-quote-pdf/mod.ts:161-166`; email template `send-paperwork-email/mod.ts:392-403`. Source `public-controller/mod.ts:920-926`
    `email: user?.email` (Settings `SettingsPage.tsx:361-372`). Onboarding lets the email be skipped (`lang/en.json:165`
    "name@yourbusiness.com — or 'skip'"), so an empty field renders nothing — the likely screenshot cause.
  - 🐛 Bug: `front-end/routes/assistant/index.tsx:97-104` mounts `<AsstChat>` **without the `from` prop** (compare
    `routes/assistant/[threadId].tsx:148-153`), so a conversation started at `/assistant` drops the whole From block (`:5571` guard).
  - Website: no field anywhere — `backend/src/users/dto/business-identity.ts:110-172` has none, `PublicContractor`
    (`public-controller:878-903`) has none, Settings has no input, `PartyCard` has no prop. `front-end/clients/profile.ts:20`
    `websiteUrl?` is a dead FE-only type.
  - Fix: (1) one-liner `from={{…}}` in `routes/assistant/index.tsx:97`; (2) add `websiteUrl` through DTO → store → `PublicContractor`
    → Settings input → `PartyCard`/preview/PDF; (3) nudge when email is empty (precedent `fromNeedsName` `:5587-5598`).
  - Tests: `jest/unit/ux-page-copy.test.ts:58-69` + `cypress/e2e/ux-doc-preview.cy.ts` (UX-15 phone) only.

## Code at the cited lines (read from this tree while packaging)

### `front-end/islands/AsstChat.tsx:5571-5625`

```
5571:                           {from && (from.business || from.name)
5572:                             ? (
5573:                               <section
5574:                                 class="quote-review__hero"
5575:                                 style="opacity:.92"
5576:                               >
5577:                                 <div class="quote-review__hero-label">
5578:                                   {tFor(previewLang, "asstChat.preview.from")}
5579:                                 </div>
5580:                                 <div class="quote-review__hero-name">
5581:                                   {from.business || from.name}
5582:                                 </div>
5583:                                 {/* UX-26(b)/UX-27: the placeholder account
5584:                                     name is not a finished identity — warn
5585:                                     and invite the fix instead of presenting
5586:                                     "Nuevo usuario" as the sender. */}
5587:                                 {!from.business?.trim() &&
5588:                                   isPlaceholderName(from.name) && (
5589:                                   <a
5590:                                     href="/settings"
5591:                                     class="quote-review__from-warn"
5592:                                     style="display:inline-flex;align-items:center;gap:6px;margin-top:6px;font-size:12px;font-weight:700;color:var(--pink-700,#d94e4e);text-decoration:none"
5593:                                   >
5594:                                     ⚠ {tFor(
5595:                                       previewLang,
5596:                                       "asstChat.preview.fromNeedsName",
5597:                                     )}
5598:                                   </a>
5599:                                 )}
5600:                                 <div class="quote-review__hero-meta">
5601:                                   {from.name && from.business
5602:                                     ? <span>{from.name}</span>
5603:                                     : null}
5604:                                   {from.phone
5605:                                     ? (
5606:                                       <>
5607:                                         <span class="quote-review__dot">·</span>
5608:                                         {/* UX-15: one phone formatter
5609:                                             everywhere — never raw E.164. */}
5610:                                         <span>
5611:                                           {formatPhoneDisplay(from.phone)}
5612:                                         </span>
5613:                                       </>
5614:                                     )
5615:                                     : null}
5616:                                   {from.email
5617:                                     ? (
5618:                                       <>
5619:                                         <span class="quote-review__dot">·</span>
5620:                                         <span>{from.email}</span>
5621:                                       </>
5622:                                     )
5623:                                     : null}
5624:                                 </div>
5625:                               </section>
```

### `backend/src/paperwork/domain/coordinators/render-quote-pdf/mod.ts:161-166`

```
161:       const fromLines = [
162:         contractor?.name,
163:         businessName,
164:         contractor?.phoneNumber,
165:         contractor?.email,
166:       ].filter((v): v is string => !!v && v.trim().length > 0);
```

### `backend/src/paperwork/domain/coordinators/send-paperwork-email/mod.ts:392-403`

```
392:   const senderEmailLine = sender?.email
393:     ? `<div style="color:${COLOR_MUTED};font-size:13px;margin-top:2px"><a href="mailto:${
394:       escapeHtml(sender.email)
395:     }" style="color:${COLOR_MUTED};text-decoration:none">${
396:       escapeHtml(sender.email)
397:     }</a></div>`
398:     : "";
399:   const senderPhoneLine = sender?.phoneNumber
400:     ? `<div style="color:${COLOR_MUTED};font-size:13px;margin-top:2px">${
401:       escapeHtml(sender.phoneNumber)
402:     }</div>`
403:     : "";
```

### `front-end/clients/profile.ts:17-23`

```
17:   logoFileId?: string;
18:   logoUrl?: string;
19:   tagline?: string;
20:   websiteUrl?: string;
21:   /** Language the contractor's customers receive outbound comms in
22:    *  (quotes/SMS/email/docs). Distinct from the contractor's UI language.
23:    *  Defaults to "en" when unset. Stays the DEFAULT (first enabled). */
```
