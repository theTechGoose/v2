# Unified Quote + Contract Builder — Two-Phase Process

We collapse the Quote Boss and Contract Boss into a single flow with two distinct phases:

- **Phase 1 — Chat phase.** Open-ended conversation: the contractor describes the job, the bot returns an instant quote, they refine it together until the price and scope feel right.
- **Phase 2 — Wizard phase.** A button-clicking flow for the structured contract terms. Every question is multiple-choice; the last button is always **Custom**, which opens a small modal chat scoped to that one field.

Phase 1 nails down *what the work is and what it costs*. Phase 2 nails down *how it gets paid for, when, and under what terms*.

---

## Phase 1 — Chat phase

### Opening prompt (text input)

> "What kind of job is this? Describe it in a sentence or two."

A single free-text box, no preset buttons. The contractor types something like *"Full kitchen remodel — cabinets, quartz counters, tile backsplash, new appliances"* and submits.

### First draft

The bot responds with the initial quote:

> Here's a first draft:
>
> **QUOTE: $X,XXX**
>
> **Includes** — …
> **Not Included** — …
> **Notes** — …
>
> Anything to change?

### What the chat handles

- Scope tweaks: "Add demo of the existing tile", "Skip the backsplash."
- Price moves: "Bump it to $18k", "Tighter — under $12k."
- Material swaps: "Switch to engineered hardwood", "Use Benjamin Moore Aura."
- Line-item edits: "Add a $400 permit line", "Drop the disposal fee."
- Free-form notes / exclusions: "Customer to supply paint", "Add a note that we're not responsible for hidden water damage."
- Tier requests: "Show me a budget version."

Each turn the bot returns an updated quote in the same format.

### UI refinements for the chat phase

- **Live quote card pinned to the right** (or below on mobile) — current price, line items, includes/excludes always visible. Updates with each turn so the contractor doesn't have to scroll back.
- **Quick-action chips above the input**: `Cheaper tier` · `Premium tier` · `Add line item` · `Add exclusion`. Tapping any of them seeds the next message.
- **Inline edits on the quote card**: tap a line item's price or quantity to override it directly without typing a sentence.
- **Undo last change** button — surfaces after every bot response so back-and-forth is reversible.

### Finishing Phase 1

A persistent **Continue to terms** button is visible the whole time. Clicking it locks the current quote draft and drops the contractor into Phase 2.

---

## Phase 2 — Wizard phase

A linear wizard. Each step is a question + a row of preset buttons + a final **Custom** button. The Custom popup is a tightly-scoped chat: it asks only about that field, captures the answer, closes itself, and fills the result back into the wizard as a chip.

### 1. Config

> "Use a previous config, or start a new one?"

A **config** is a saved, named bundle of the contract-term answers — payment terms, warranty, termination notice, dispute resolution, governing state, state notices.

`{Saved config 1}` · `{Saved config 2}` · … · `New config`

- Picking a saved config pre-fills steps 4–10 with that bundle's values. The contractor still walks through them and can override any step. If anything was changed, the wizard offers to either update the existing config or save it under a new name when finishing.
- Picking `New config` opens a popup:

  > "What do you want to call this config?"

  Free-text input (e.g. *"Standard residential"*, *"Commercial — net 30"*). The name is set up front; the values get filled in as the contractor walks through the rest of the wizard, and the config is auto-saved when they finish.

The config name is shown as a sticky pill at the top of the wizard for the rest of Phase 2 — they always know which bundle they're editing.

### 2. Customer

> "Who is this for?"

Existing customers shown as buttons (most-recent first). Plus:

`+ New customer` · `Custom` (search if list is long)

`+ New customer` popup → name (required), email, phone.

### 3. Start date

> "When does work start?"

`Today` · `Tomorrow` · `Next Monday` · `In 1 week` · `In 2 weeks` · `Custom`

Custom popup → "What date?" (accepts natural language, normalized to ISO).

### 4. Estimated completion

> "Wrap-up by?"

`1 week` · `2 weeks` · `1 month` · `6 weeks` · `2 months` · `Custom`

Relative durations from the start date. Custom popup → date or duration.

### 5. Payment terms

> "How do you want to get paid?"

The buttons here are the contractor's saved **PaymentTerms** templates (`GET /payment-terms`), shown by `name`. Plus a final `Custom` button.

`{Saved term 1}` · `{Saved term 2}` · `{Saved term 3}` · … · `Custom`

Each saved PaymentTerms is `{ name, installments[], description? }`, where each installment is `{ percent, dueDate, label?, note? }` and percents sum to 100. When picked, the wizard calls `GET /payment-terms/:id/resolve?total={quoteTotal}` to turn the percents into actual dollar amounts against the project total, then shows them as a chip ("30/30/40 — $3,840 / $3,840 / $5,120").

`Custom` popup → mini chat that builds a new PaymentTerms object: name → add installments one at a time (percent + due date + optional label) until percents sum to 100 → optionally save the new template back via `POST /payment-terms` so it appears as a button next time. The resolved schedule is what gets attached to the contract (snapshot, not a reference — the contract stays stable if the template is later edited or deleted).

Net days (15) and late fee (1.5%) are applied as defaults and shown as editable chips alongside the picked term.

### 6. Warranty

> "Offer a warranty?"

`None` · `6 months` · `12 months` · `24 months` · `Custom`

If anything other than None is picked, a second row appears:

> "What does it cover?"

`Materials` · `Craftsmanship` · `Both`

Custom popup → months + coverage in two quick prompts.

### 7. Termination notice

> "Days written notice to terminate?"

`5` · `10` · `15` · `30` · `Custom`

### 8. Dispute resolution

> "If there's a dispute?"

`Mediation` · `Arbitration` · `Court`

If `Court` → inline popup: "Which county or state hears disputes?"

### 9. Governing state

> "Whose law governs?"

Top 3–5 recent / nearby states as buttons. Plus `Custom` (search any state).

### 10. State-specific notices

> "Add any state-required notices?"

`None` · `Custom`

Custom popup → free-text the notice block.

---

## UI refinements for the wizard

- **Sticky breadcrumb / chip strip at the top.** Each completed step shows as a chip with its value (e.g. *"Start: Mar 12"*, *"Net 15 · 1.5% late"*). Tap any chip to jump back and edit — the wizard scrubs to that step, the contractor changes the answer, and a `Resume` button drops them back where they were.
- **Sticky quote summary.** The quote total + customer name pinned to the header so they're always visible. The wizard never disconnects from what's being priced.
- **Single-screen mode for power users.** A "Show all on one page" toggle in the header collapses the wizard into a long form (one card per step, all expanded). Daily users tab through it in 30 seconds. First-timers stay in the linear wizard.
- **Skip-the-walk for unchanged configs.** If the contractor picks a saved config in step 1 *and* the customer/dates are pre-known (e.g. coming from a customer page), offer a `Looks the same as last time — finalize` shortcut that skips the rest of the wizard. They can still expand any step to verify before committing.
- **Autosave + resume.** Every step is saved as it's answered; closing the tab and coming back resumes exactly where they left off, with a `Pick up where you left off` banner.
- **Custom popup as a sheet, not a modal blocker.** The popup slides up from the bottom (mobile) or in from the right (desktop) without dimming the wizard, so the contractor can still see the chips they've set.
- **Validation as you go.** Payment-term percents that don't sum to 100, completion dates before start dates, etc. — flagged inline on the offending chip, not at the end.

---

## Finishing the wizard

A persistent **Finalize** button is visible from step 1 onward, but stays disabled until the required steps have answers. Clicking it:

1. Saves the latest quote draft from Phase 1 + the contract patch from Phase 2.
2. Saves or updates the config (using the name from step 1).
3. Creates the customer (if new).
4. Creates the draft quote with `pendingContractTerms` attached.
5. Redirects to the quote detail page.

A **Back to chat** link in the header reopens Phase 1 with the current quote loaded — useful if Phase 2 surfaces a number that no longer fits.

---

## Phase summary

| | Phase 1 — Chat | Phase 2 — Wizard |
|---|---|---|
| **Mode** | Free-form chat | Multi-step button picker |
| **Speed** | Slower, conversational | Fast, mostly clicks |
| **Captures** | Job description, quote scope, price, line items, notes | Config name, customer, dates, payment, warranty, legal |
| **Escape hatch** | Continue-to-terms button | Custom popup per field, breadcrumb chips for re-edits |
| **Output** | `buildResult` (line items, total, includes/excludes) | `contractPatch` + customer + named config |
| **Ends with** | "Continue to terms" → drops into Phase 2 | "Finalize" → creates quote + contract |

The combined output is the same as today: a draft quote with `pendingContractTerms`, ready to send for signature.
