# 1.14 ◩ Copy fixes from the "COMPLETED" half: governing-law tail, warranty labels, "Scope of Work" (S) · slug `completed-half-copy-fixes`

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 1.14) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

**Why.** Verified partials on pp. 76-83: the governing-law clause stops at "…where the work is performed." (`lang/*.json:819`, PDF twin `:2129`);
warranty options read "12 months"/"24 months" instead of "1 year"/"2 years" (`:938-939`); clause 2 is titled "Job Details" where the client's list says "Scope of Work".

- [ ] RED — jest unit: `i18n-dictionary-consistency.test.ts` add `describe("REQ-NNN completed-half copy")`: en 819 and 2129 end with
      "without regard to conflict of law rules."; es 819/2129 end with "sin importar las reglas sobre conflicto de leyes."; `termsWizard.warranty.twelveMonths` = "1 year" / "1 año";
      `twentyFourMonths` = "2 years" / "2 años"; `quoteDoc.clause.jobDetails.title` = "Scope of Work" / "Alcance del trabajo". Run → fails.
- [ ] EDIT the values in both dicts (keys unchanged). Also the PDF twin of the clause title (grep `renderQuotePdf.clause.jobDetails.title`).
- [ ] EDIT the three localization maps (`term-i18n.ts:30-33`, `render-quote-pdf/mod.ts` and `render-invoice-pdf/mod.ts` regex tails): add
      `.replace(/\byears\b/gi, "años").replace(/\byear\b/gi, "año")` so a persisted "1 year" still localizes.
- [ ] E2E: extend the NW-54 case in `public-quote-signature.cy.ts` to `cy.contains("without regard to conflict of law rules")`.
- [ ] Done when: unit + e2e green; PDF regenerates with the new clause text (open `/q/:id` → download PDF → read clause 1).

## Source items from the triage (`new-working-issues.md`, client's words + verdict + evidence)

- Step 6: Warranty. No warranty / 6 months / 1 year / 2 years / Custom. [p76–77]
  - **◩ PARTIAL** five slots (`:108-123`) but labels read "12 months" / "24 months", not "1 year" / "2 years" (`lang/en.json:933-939`).

- Remove the governing-law step. Fixed language: "This agreement is governed by the laws of the state where the work is performed, without regard to conflict of law rules." [p80]
  - **◩ PARTIAL** step gone (dead fallback `AsstChat:156-159`) but the body (`lang/en.json:819`) stops at "…where the work is performed." — the clause ", without regard to conflict of law rules." is missing (both dicts + PDF twin).

- Replace the long legal section with the required notices only: Governing Law, Scope of Work, Payment Terms, Change Orders, Customer Responsibilities, Delays and Unforeseen Conditions, Warranty, Limitation of Liability, Right to Stop Work, Termination, Dispute Resolution, Permits and Compliance, Indemnification, Entire Agreement. [p83]
  - **✅ VERIFIED (one title differs)** — `clauseKeys` `quote-doc.tsx:99-114`, `<ol>` `:478-486`, titles `lang/en.json:809-836`; item 2 is titled "Job Details" (`quoteDoc.clause.jobDetails.title`), not "Scope of Work".

## Code at the cited lines (read from this tree while packaging)

### `front-end/lib/term-i18n.ts:30-33`

```
30:   return trimmed
31:     .replace(/\bmonths\b/gi, "meses").replace(/\bmonth\b/gi, "mes")
32:     .replace(/\bweeks\b/gi, "semanas").replace(/\bweek\b/gi, "semana")
33:     .replace(/\bdays\b/gi, "días").replace(/\bday\b/gi, "día");
```
