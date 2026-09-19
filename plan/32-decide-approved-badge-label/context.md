# 6.5 ❓ NW-44 — Badge says "Accepted"; client wrote "Approved". (S) · slug `nw-44-approved-label`

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 6.5) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

- If **Approved**: RED unit `jest/unit/quote-status.test.ts` (`badgeLabel("accepted","en") === "Approved"`, es "Aprobada") + e2e `quotes-status-badges.cy.ts`. EDIT `shared/quote-flow/quote-status.ts:54-55` `BADGE_LABELS`, `lang/*.json:2447` `quotesPage.status.accepted`, `shared/quote-flow/email-format.ts:78/88` `STATUS_LABELS.accepted`. The persisted value `"accepted"` must NOT change.

## Phase context (verbatim from the plan, `Phase 6 — ❓ Decisions the client must make, with the work each answer unlocks`)

Send §10 (the message at the bottom) to the client. Do not start these tasks until the answer is back; everything above is unblocked meanwhile.

## Source items from the triage (`new-working-issues.md`, client's words + verdict + evidence)

- **NW-44:** lifecycle ships as "Accepted", client wrote "Approved".

- Quote badge: "Draft", then "Sent" once sent, then "Viewed", then "Approved" once they sign. Refer to "Quote & Agreement - Preview.docx" for the updates. [p41]
  - **NW-44 ✅ DONE, ships as "Accepted" (❓ wording).** `shared/quote-flow/quote-status.ts:8-14` forward-only flow; badge
    `QuotesPage.tsx:96-113,170-176` (`data-cy="quote-status-badge"`); `viewed` on non-owner public read `public-controller:415,420`;
    labels `lang/en.json:2006-2009,2447`. Rationale for "Accepted" at `quote-status.ts:5-7`. **But** the assistant creates quotes
    already `sent` (NW-10), so "Draft" is never observed from that path. Rename = 2 keys + `BADGE_LABELS`.

## Code at the cited lines (read from this tree while packaging)

### `shared/quote-flow/quote-status.ts:54-55`

```
54:   en: { draft: "Draft", sent: "Sent", viewed: "Viewed", accepted: "Accepted" },
55:   es: {
```
