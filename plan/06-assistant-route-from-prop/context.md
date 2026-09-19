# 1.6 🐛 NW-06 — `/assistant` passes the `from` prop (S) · slug `nw-06-from-prop-and-website`

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 1.6) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

**Goal.** A conversation started at `/assistant` shows the From block (business, name, phone, email) on the review card.
**Why.** `front-end/routes/assistant/index.tsx:97-104` mounts `<AsstChat>` without `from`; `routes/assistant/[threadId].tsx:148-153` has it.
The preview guard `AsstChat.tsx:5571` hides the whole block when `from` is undefined. Both routes already compute `businessName`, `user`, `profile` identically.

- [ ] RED — e2e: `cypress/e2e/ux-doc-preview.cy.ts` add `it("REQ-NNN NW-06 a conversation started at /assistant shows the From block")`:
      start at `cy.visit("/assistant")` (NOT a thread URL), walk to the review card exactly as the spec's existing case does, assert
      `.quote-review__hero-label` containing the "From" label exists and the hero shows the contractor's email. Run → fails.
- [ ] EDIT `routes/assistant/index.tsx`: between lines 99 and 100 paste lines 148-153 of `[threadId].tsx` verbatim:
      `from={{ business: businessName, name: user?.name, phone: user?.phoneNumber, email: profile?.user?.email }}`.
- [ ] Optional nudge (same task): in `AsstChat.tsx:5587-5598` there is a `fromNeedsName` warning linking to `/settings`; add a sibling
      `!from.email` warning with a new key `asstChat.preview.fromNeedsEmail` ("Add your email in Settings so customers can reply") in both dicts.
- [ ] **Website field: NOT in this task.** It does not exist in the data model (`backend/src/users/dto/business-identity.ts`), Settings, or `PartyCard`.
      It is its own M task — see 7.10.
- [ ] Unit/integration: `n/a — SSR prop plumbing`.

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

### `front-end/routes/assistant/index.tsx:97-104`

```
97:                 <AsstChat
98:                 initialMessages={[]}
99:                 userInitials={userInitials}
100:                 sendLanguages={profile?.identity?.commsLanguages ??
101:                   (profile?.identity?.commsLanguage
102:                     ? [profile.identity.commsLanguage]
103:                     : ["en"])}
104:               />
```

### `front-end/routes/assistant/[threadId].tsx:148-153`

```
148:                   from={{
149:                     business: businessName,
150:                     name: user?.name,
151:                     phone: user?.phoneNumber,
152:                     email: profile?.user?.email,
153:                   }}
```

### `front-end/islands/AsstChat.tsx:5568-5574`

```
5568:                             /* Roadmap p.5 (Preview.docx): FROM = the contractor.
5569:                               Read-only; the editable TO (customer) follows. */
5570:                           }
5571:                           {from && (from.business || from.name)
5572:                             ? (
5573:                               <section
5574:                                 class="quote-review__hero"
```

### `front-end/islands/AsstChat.tsx:5587-5598`

```
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
```
