# 6.7 ❓ NW-55 — Do you want a real invoice number sequence (INV-0001…) or is the derived `#<8 chars of id>` fine?

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 6.7) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

A stored per-contractor counter is a new field + atomic KV increment in `invoice-store` (M); the derived id is free. Decide before 7.7.

## Phase context (verbatim from the plan, `Phase 6 — ❓ Decisions the client must make, with the work each answer unlocks`)

Send §10 (the message at the bottom) to the client. Do not start these tasks until the answer is back; everything above is unblocked meanwhile.

## Source items from the triage (`new-working-issues.md`, client's words + verdict + evidence)

- **Job Quote & Agreement layout** [p63]
  - Invoice number. Job Details (e.g. "Kitchen backsplash tile install 30 sq ft, porcelain tile"; Start: ASAP; Time to complete: 2–3 days). Payment (Total $1,200: $600 to start, $600 when the job is done). Warranty (6-month workmanship warranty). Cancelation (either side can cancel with 7-day notice; work completed will be paid for).
  - At the bottom, an expandable "Terms & Conditions" containing all the required notices from slide 13.
  - The quote has a pencil and is editable.
  - "Send to client" opens "How do you want to send to customer?" with Text / Email / Text + Email and Keep / Cancel.
  - **NW-55 ◩ content ✓, pencil ✓; four presentation asks missing.** Effort M.
  - Done: Job Details + term grid (`quote-doc.tsx:415-433,456-464`, labels `lang/en.json:885-887`); payment schedule
    (`:436-442`, `doc-parts.tsx:337+`); warranty row + clause (`:886`, `:835-836`); pencil (`static/assistant-page.css:6512-6540`,
    `AsstChat.tsx:5666,5681,5704,6137,6176`).
  - Missing: (1) **invoice number** — only a derived `#{id.slice(0,8)}` (`quote-doc.tsx:325`, `AsstChat:5393-5400`,
    `InvoicesPage:207` `INV-…`, public invoice footer only `routes/i/[id].tsx:557-562`); no stored sequence anywhere.
    (2) **Cancelation row** — exists only as clause 10 (`lang/en.json:833-834` "Either party may cancel … 7 days' written notice")
    and the "work completed will be paid for" half is absent; no `cancellation` term row (`AsstChat.tsx:486-493`).
    (3) **Expandable T&C** — zero `<details>/<summary>/aria-expanded` in `quote-doc.tsx`/`doc-parts.tsx`/`routes/q/[id].tsx`; clauses are an always-open `<ol>` (`:465-477`).
    (4) **Send dialog** — the three channels exist as a caret dropdown (`AsstChat.tsx:701-702`, `:6266-6290`, menu `:6375`,
    `lang/en.json:316-319` "Text + Email"/"Text only"/"Email only"/"Copy link") with no title and **no Keep/Cancel** (zero hits for `"Keep`).
  - Fix: `<details>` wrapper headed by NW-54's key; append the paid-for-work sentence to `termination.body` (web + PDF keys, both
    dicts); promote the caret menu to a modal with Keep/Cancel (`:6266-6420`); decide whether a real invoice number sequence is wanted.
  - Tests: `ux-send-moment.cy.ts`, `ux-doc-preview.cy.ts`, `public-quote-signature.cy.ts`, `invoice-parity.cy.ts`. None pin the four missing items.

## Code at the cited lines (read from this tree while packaging)

_(no resolvable file:line citations in this card)_
