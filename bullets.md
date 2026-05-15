# Session upgrades — user flow bullets

## Contractor — drafting a quote in the assistant chat

- Polish step now also produces a **`jobName`** (≤3 words, Title Case) alongside `summary` + `description`; threaded through quote creation so every downstream surface has a stable, three-word label.
- Initial-three-option screen ("I know my price" / "have job details" / "quick quote") buttons untouched, but downstream copy on the in-chat card updated.
- **Composer auto-hides** whenever an unanswered wizard card is showing or the MoneyInput screen is open, so the contractor can't type while they should be tapping options.
- "Get paid on completion" replaced everywhere with **"Payment upon completion"** (wizard spec, AsstChat presets, AssistantSections demo).

## Contractor — in-chat Quote + Agreement card

- "Draft" pill replaced with **dynamic status chip**: Draft / Sent / Viewed / Approved / Declined, driven by `lockedPayload.status`.
- Inner "Job Details" section heading renamed to **"Terms"**.
- Time-to-Complete value now prefixed with **"Estimated:"** (e.g. "Estimated: 2 days").
- Warranty row **hidden** when the contractor's answer normalizes to "No warranty" / "none" / etc. — the legal-text clause in the contract's Fine Print still applies regardless.
- Split-button main label changed from "Send by Text + Email" → **"Click here to send by Text + Email"** (and matching variants for sms-only / email-only).

## Customer — public contract preview (`/c/:id`)

- Hero uses **`jobName`** (with summary fallback) so the heading reads as a real noun-phrase title.
- Subtitle no longer says `("Contractor")` / `("Client")` — reads cleanly as *"Between Hansen Construction and Hans Pedersen · effective May 12, 2026."*
- "The deal in plain English" recital block **removed** entirely.
- New **To / From block** under the subtitle (To = customer name/phone/email; From = contractor business/phone/email/address).
- Section structure collapsed to **01 Job details · 02 Payment schedule · 03 Terms · 04 Sign here** (Schedule merged into Terms; Fine Print stays as an un-numbered subsection of Terms with 14 clauses).
- Sign Here section label "Contractor signed" → **"Contractor Signature"**; hint copy "By signing, you agree…" → **"By signing below, you agree…"**.
- Footer copy reads **"Questions before signing? Call X or email Y! I look forward to working with you."**
- Small **"Powered by Paperwork Monsters"** logo strip at the bottom of the doc.

## Customer — outbound quote/contract email

- Subject now follows the roadmap format: **`"{Business Name}" Quote for "{Customer Name}", "{Job Name}"`**.
- **Contractor is CC'd** on every outbound (new `cc?: string[]` on `SendEmailInput`, plumbed to Postmark).
- From address is a **per-business alias**: `<emailAlias>@paperworkmonster.com` (slug generated from business name on first save, with `-2`/`-3` collision resolution; falls back to `noreply@paperworkmonster.com`).
- Email shell renders a centered logo header in the message body.

## Customer — outbound quote/contract SMS

- Quote + contract bodies rewritten to the roadmap p.8 template:
  > Hi {customerFirst}, this is {senderFirst} from {businessName}.
  >
  > Your quote for {jobName} is ready: {shortUrl}
  >
  > Please let me know if you have any questions. I look forward to working with you!
- Graceful fallbacks: salutation/business/jobName each drop independently when missing.

---

## Customer — public invoice page (`/i/:id`)

- Whole page rebuilt — was a minimal "Online payment is coming soon" stub.
- **Status pill**: Due / Past due / Awaiting confirmation / Paid.
- Hero shows **job name + milestone framing**: *"Backyard Junk Removal · Invoice 2 of 3 — Final payment"*.
- **Paid-so-far chip strip** for installments 2+: small pills showing what's already been settled across the contract.
- **"How would you like to pay?"** method buttons (Check / Venmo / Zelle / Cash App / Cash / Bank transfer / Other) populated from the contractor's accepted-methods config.
- Tapping a method reveals the contractor's handle inline (*"Send to @hans-hansen on Venmo"*) plus a reference + name input, then a single **"I sent it"** button.
- Submission records a **`PaymentIntent`** on the invoice and flips status to `claimed`; the customer sees an "Awaiting confirmation" view + a *"We'll text you a receipt when funds land"* note.
- Trust footer: contractor's name + phone + email + small Powered-by logo strip.
- Past-due, paid, void states each render distinct UI (no claim form when paid; an "already-claimed" strip when the customer already submitted; etc.).

## Contractor — invoice dashboard (`/invoices`)

- **Forecast hero** replaces the "outstanding total" headline: *"$4,800 expected this week — Tue: Hansen $2,000 (ACH) · Fri: Acme $2,800 (check)"* with an **at-risk callout** for overdue amounts.
- Falls back to "Quiet week — $X coming next week" then the legacy outstanding total when no forecast data exists.
- New **"Awaiting confirmation"** track (between Overdue and Out for payment) — shows invoices the customer has claimed but the contractor hasn't confirmed yet.
- New **"Upcoming"** track for `scheduled` milestone invoices that haven't fired yet.
- **One-tap "Confirm received"** CTA on claimed cards → records a Payment row, flips invoice to paid, fires PDF receipt to customer + CC to contractor.
- **Mute toggle** on overdue/out invoice cards: silences the overdue-reminder cadence per-invoice.
- **"Export {year} CSV"** button in the hero CTA row.

## Contractor — milestone auto-scheduling

- When a contract with a multi-installment payment term (50/50, 30/30/40, "Deposit + balance", etc.) is signed, the system now creates **the full set of invoices** at once:
  - First invoice: status `sent`, dueDate today + 7d (matches prior behavior).
  - Remaining invoices: status `scheduled`, with **equal-spaced `scheduledFor` dates** over the contract's start→completion window.
- Contractor sees the entire revenue pipeline on day one in the new "Upcoming" track.

## Contractor — scheduled-invoice nudges

- Daily cron (`POST /cron/run-nudges`) sweeps all scheduled invoices whose `scheduledFor <= today + 1 day` and emits an `invoice:nudge_due` domain event.
- Each event is meant to surface as a chat message *"Time to send invoice 2 of 3 for the Hansen job?"* with one-tap **Send now** / **Postpone** / **Edit first** CTAs (event plumbing in place; chat-card UI wires through the existing notification path).

## Contractor — overdue payment reminders

- Day **3 / 7 / 14 / 30** cadence engine (`SendPaymentReminder` coordinator).
- Day 3, 7, 14: **text + email to customer** with per-step copy (gentle → following-up → personal-note).
- Day 30: **escalates to contractor's topbar bell only** — no customer dispatch.
- **Never regresses**: once Day 30 has fired, no smaller step ever fires for that invoice.
- **Per-invoice mute** (`remindersMuted`) short-circuits the entire cadence.
- Triggered via `POST /cron/run-reminders` for an auto sweep, or `POST /cron/invoice-reminder` for a manual one-shot.

## Contractor — voice + photo payment capture

- `POST /invoices/record-payment/voice` with a transcript like *"Got $1,200 cash from the Hansens for the deck job"* → regex parser extracts amount, method, payer-hint, reference → matches against open invoices.
- `POST /invoices/record-payment/photo` accepts pre-parsed OCR fields (amount, payerHint, method, reference) and runs the same matcher.
- **Exactly one match** → records the Payment, flips invoice to paid, fires the PDF receipt automatically.
- **Zero or 2+ matches** → returns a disambiguation list (`{ invoiceId, label, amount, customerName }`) for the UI to render as a picker.

## Contractor — payment-methods settings

- `BusinessIdentity.acceptedPaymentMethods` extended with typed config for **Check / Venmo / Zelle / Cash App / Cash / ACH / Other**, each with handle/address fields.
- ACH routing/account numbers are **redacted on the public projection** — the public invoice page knows ACH is offered, not how to reach the bank.

## Contractor — tax-time export

- `GET /invoices/export.csv?year=YYYY` streams a CSV of paid invoices with columns **Date / Customer / Job / Amount / Method / Reference**.
- One-click "Export {year} CSV" button on the `/invoices` hero.

## Customer — payment receipt

- `RenderReceiptPdf` coordinator (sibling of contract PDF, also pure pdf-lib so it runs on Deno Deploy).
- On `ConfirmPayment`: customer gets an email + SMS with the PDF attached; contractor is CC'd.
- Email body is a warm *"Thanks{, name} — we got it!"* with amount + reference; SMS is a single-line link to the public invoice page via a fresh shortlink.

---

## Testing + tooling

- **+67 new backend tests** across the session (704 baseline → 771 with all phases). Same 36 pre-existing failures from `main` unchanged; zero new regressions.
- Coverage added for: milestone math, scheduled-date computation, reminder cadence (day picker, no-regress, mute, copy), nudge-due predicate, forecast bucketing per settlement window, voice-transcript parser (dollar formats, word-forms, family-name plural, Cash App vs cash priority), public claim endpoint (records intent, rejects unknown method, 409 on already-paid).
- **Cypress harness** stood up under `cypress/` as a self-contained npm project (so it doesn't fight Deno's `nodeModulesDir: manual`):
  - Config + tsconfig + support files with custom commands (`cy.loginAs`, `cy.apiCreateInvoice`, `cy.apiClaimPayment`, `cy.apiConfirmPayment`).
  - **4 e2e specs**: public invoice page flow (method picker, claim records, empty-state fallback) · contractor confirm-received + mute toggle persistence · CSV export Content-Type + button href · voice capture exact-match + disambiguation.
  - `cd cypress && npm install && npm run run` (with `deno task serve` running) to execute.

## Logos

- New logo `<img>` references wired into the in-app **Topbar**, the **public contract preview footer**, the **public invoice page footer**, and the **outbound email shell header**. Pointing at the existing `/static/logo.svg`; favicon swap deferred until you drop a new file in.
