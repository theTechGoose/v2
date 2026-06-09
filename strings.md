# Hardcoded Strings Audit

> Generated 2026-06-08. A catalog of **user-facing / customer-facing text literals** baked into the source rather than pulled from a central i18n layer. Built for the EN/ES localization effort.

## Scope & method

Every `.tsx`/`.ts` source file under `front-end/` (routes, islands, components, lib) and the customer-/contractor-facing layers of `backend/src/` (communication, paperwork, agents) was read in full. Entries are grouped by file as:

```
- `LINE` | "exact string" | context
```

**Included:** JSX text, button/link labels, headings, placeholders, `aria-label`/`title`/`alt`, `<title>`/meta, toast / error / empty-state / loading messages, `confirm()`/`alert()` text, option labels, status chips, relative-time & month/weekday labels, SMS / email / push-notification copy, OTP text, PDF (receipt & contract) copy, in-chat assistant messages, and seed/demo display data that renders to the screen.

Also inventoried (Parts 6–8): **LLM prompts & tool definitions** (verbatim), the **contract-terms wizard spec**, and **error / log message text**. The guiding rule for these: *if editing the string won't break the app, it's in.*

**Excluded** — only genuinely load-bearing tokens, i.e. things that *would* break if changed: object/JSON keys & field names, KV/storage key strings & prefixes, enum/union literal values used in logic, internal status/error **codes** other code switches on (these are tagged `[load-bearing code]` where listed for awareness, not for editing), import paths & URLs, route strings, env-var names, type literals, and CSS. Test files (`*.test.ts` / `*e2e*` / `*smk*`) are skipped.

## The i18n situation (why this list is so long)

- The **only** centralized i18n system is `front-end/lib/lang.ts` — a `STRINGS: Record<Lang, Strings>` dict (EN/ES) covering **just the marketing landing page + the verify/login flow**. It is imported by **12 files**.
- **Everything else is hardcoded.** The entire authenticated app (dashboard, assistant, quotes, contracts, invoices, payments, clients, settings, all public document views) renders English text inline.
- Several **public document surfaces are bilingual but the translations are inlined per-file**, not centralized — each via a local `es` flag or a per-file string table: `routes/q/[id].tsx`, `routes/i/[id].tsx`, `components/contract-doc.tsx`, `islands/AsstChat.tsx` (quote preview), `routes/login.tsx`, and the backend senders (`send-paperwork-sms`, `send-paperwork-email`, `send-payment-reminder`, `send-signed-confirmation`, `confirm-payment`, `render-contract-pdf`, `send-otp`). These have EN+ES side by side in code with no shared keys.
- `islands/LandingScripts.tsx` keeps its **own** EN/ES dictionaries (`I18N` / `DOC_CONTENT`) separate from `lib/lang.ts`, applied via `[data-i18n]` DOM substitution — a second, parallel i18n mechanism.

**Takeaway:** to localize the product beyond the landing page, the bulk of the work is in Parts 1–3 (frontend app) and Parts 4–5 (backend comms), where strings are inline. A real i18n pass would lift these into `lib/lang.ts` (or a backend equivalent) and replace literals with keys.

## Contents

1. Frontend — Islands (interactive components)
2. Frontend — Routes & shared components
3. Frontend — `lib/` seed, display & format helpers
4. Backend — Customer-facing comms (SMS / email / notifications / PDFs)
5. Backend — Assistant in-chat copy (agents coordinators)
6. Backend — LLM prompts & tool definitions (verbatim)
7. Backend — Contract-terms wizard spec
8. Internal / developer-facing strings (errors & logs)

---

## 1. Frontend — Islands (interactive components)
### front-end/islands/AssistantCoachmark.tsx
- `117` | "Onboarding hint — click anywhere to dismiss" | aria-label on dialog
- `276` | "Click here to talk to your assistant" | bubble heading
- `279` | "Bossie drafts quotes, sends contracts, chases invoices. Tap to start." | bubble body
- `302` | "click anywhere to dismiss" | dismiss hint

### front-end/islands/AsstChat.tsx
- `52` | "Standard residential" | term option label (config)
- `52` | "Most homes, simple jobs" | term option sub
- `53` | "Standard commercial" | term option label
- `53` | "Businesses, HOAs" | term option sub
- `54` | "Start blank" | term option label
- `54` | "I'll choose every option" | term option sub
- `56` | "Right away" | start_date option
- `57` | "Next week" | start_date option
- `58` | "Next Month" | start_date option
- `61` | "1 day" | wraps option
- `62` | "2–3 days" | wraps option
- `63` | "1 week" | wraps option
- `64` | "2 weeks" | wraps option
- `67` | "Payment upon completion" | payment_terms option label
- `67` | "Same-day payment" | payment_terms option sub
- `68` | "50/50" | payment_terms option label
- `68` | "Half upfront, half when done" | payment_terms option sub
- `69` | "30/30/40" | payment_terms option label
- `69` | "Start, halfway, done" | payment_terms option sub
- `70` | "Deposit + balance" | payment_terms option label
- `70` | "Small upfront, rest when done" | payment_terms option sub
- `73` | "No warranty" | warranty option
- `74` | "6 months" | warranty option
- `75` | "12 months" | warranty option
- `76` | "24 months" | warranty option
- `79` | "7 days" | termination option
- `80` | "14 days" | termination option
- `81` | "30 days" | termination option
- `84` | "Mediation" | dispute option label
- `84` | "Try to settle informally first" | dispute option sub
- `85` | "Arbitration" | dispute option label
- `85` | "Binding decision, no court" | dispute option sub
- `86` | "Court" | dispute option label
- `86` | "Standard small-claims path" | dispute option sub
- `89` | "Use my business state" | governing_state option
- `90` | "Use the job site state" | governing_state option
- `93` | "Yes" | state_notices option label
- `93` | "Recommended" | state_notices option sub
- `94` | "No" | state_notices option label
- `94` | "I'll add my own" | state_notices option sub
- `95` | "Review first" | state_notices option label
- `95` | "Show me what's included" | state_notices option sub
- `141` | "New job" | fallback job summary
- `150` | "Jobsite cleanup" | fallback bullet text
- `183` | "Your first name" | composer placeholder (onboarding)
- `186` | "Your business name" | composer placeholder (onboarding)
- `189` | "2-letter state code (SC, TX, NY)" | composer placeholder (onboarding)
- `191` | "Street, city, state ZIP — or 'skip'" | composer placeholder (onboarding)
- `192` | "name@yourbusiness.com — or 'skip'" | composer placeholder (onboarding)
- `194` | "Venmo @handle, Zelle email, etc." | composer placeholder (onboarding)
- `196` | "Ex: Customer wants a 10'x10' slab, what should I charge?" | composer placeholder (default)
- `206` | "Sent" | status chip label
- `209` | "Viewed" | status chip label
- `214` | "Approved" | status chip label
- `217` | "Declined" | status chip label
- `219` | "Draft" | status chip label
- `331` | "Deposit" | milestone label (en)
- `332` | "Midpoint" | milestone label (en)
- `333` | "Milestone" | milestone label (en)
- `334` | "Balance on completion" | milestone label (en)
- `335` | "Due in full" | milestone label (en)
- `350` | "English" | send-language label
- `351` | "Español" | send-language label
- `355` | "Configuración" | term-row label (es)
- `356` | "Inicio" | term-row label (es)
- `357` | "Tiempo de entrega" | term-row label (es, wraps)
- `358` | "Tiempo de entrega" | term-row label (es, time_to_complete)
- `359` | "Pago" | term-row label (es)
- `360` | "Garantía" | term-row label (es)
- `364` | "Depósito" | milestone label (es)
- `365` | "Pago intermedio" | milestone label (es)
- `366` | "Hito" | milestone label (es)
- `367` | "Saldo al finalizar" | milestone label (es)
- `368` | "Pago completo" | milestone label (es)
- `901` | "Your PM Assistant is here to help!" | header status (default)
- `902` | "Contract signed" | header status
- `903` | "Contract out for signature" | header status
- `904` | "Contract drafting" | header status
- `905` | "Contract accepted" | header status
- `906` | "Contract sent" | header status
- `907` | "Gathering a little more info" | header status
- `908` | "Quote accepted" | header status
- `909` | "Quote sent" | header status
- `910` | "Quote drafted · review" | header status
- `914` | "Conversation" | header client fallback
- `914` | "New conversation" | header client fallback
- `1275` | "🎙️ Voice memo · ${elapsedSec}s · ${fmtKB(blob.size)} — transcribing…" | optimistic voice bubble text
- `1497` | "New job" | quote summary fallback
- `1558` | "New job" | option summary fallback
- `1636` | "Kitchen backsplash — 30 sqft" | dev seed quote summary
- `1641` | "Backsplash tile install (30 sqft)" | dev seed line item
- `2130` | "${opt.label}:" | prompt() text for custom wizard option
- `2389` | "voice stream error" | error message (STT)
- `2402` | "voice stream interrupted" | error message (STT)
- `2483` | "microphone not available in this browser" | error message
- `2592` | "microphone permission denied" | error message
- `2611` | "Click on a box or the text field below to get started!" | empty-state title
- `2619` | "Job Details" | job-options heading
- `2621` | "Pick the closest job description below and make any changes you want." | job-options sub
- `2633` | "Writing up your options…" | loading text
- `2658` | "Option ${i + 1}" | job-option name fallback
- `2735` | "Restore bullet" | aria-label
- `2736` | "Delete bullet" | aria-label
- `2738` | "Restore" | title
- `2739` | "Delete" | title
- `2745` | "↺" | restore glyph button text
- `2745` | "×" | delete glyph button text
- `2757` | "Add your own…" | input placeholder
- `2775` | "Add bullet" | aria-label
- `2788` | "+" | add-bullet button text
- `2809` | "Setting up…" | button busy state
- `2812` | "Continue →" | button label
- `2827` | "Want me to professionalize that?" | popup message
- `2836` | "No" | popup button
- `2844` | "Polishing…" | popup button busy state
- `2844` | "Yes" | popup button
- `2861` | "Okay great" | details-prompt bold text
- `2861` | "— tell me the job details." | details-prompt text
- `2863` | "Type below. I'll clean it up so it reads sharp on the quote." | details-prompt hint
- `2889` | "Polishing your job details…" | working indicator text
- `2910` | "Back to prompts" | aria-label
- `2927` | "Back" | back button text
- `2930` | "Pick a price" | price-capture title
- `2930` | "What's the price?" | price-capture title
- `2934` | "Tap a suggestion, or enter your own below." | price-capture sub
- `2935` | "I'll build the job details around it." | price-capture sub
- `2947` | "Pricing this job…" | loading text
- `2976` | "Or enter a custom price" | tier divider label
- `2998` | "Setting up…" | button busy state
- `3001` | "Continue →" | button label
- `3012` | "I know my price, write it up." | empty-state prompt button
- `3019` | "I know the job, help me price it." | empty-state prompt button
- `3026` | "Just give me a quick quote." | empty-state prompt button
- `3040` | "Quote → lock → transition → answer config. Lands on the customer step." | dev button title
- `3042` | "🔧 " + "Seeding…" | dev button text (busy)
- `3042` | "Seed phase 2 wizard" | dev button text
- `3190` | "Add their email & phone to deliver" | recovery card head
- `3192` | "Add their email to deliver" | recovery card head
- `3193` | "Add their phone to deliver" | recovery card head
- `3196` | "Saved to " | recovery hint prefix
- `3196` | "this customer" | customer-name fallback in hint
- `3198` | "for next time." | recovery hint suffix
- `3207` | "customer@email.com" | input placeholder
- `3226` | "(555) 555-5555" | input placeholder
- `3256` | "Saving…" | button busy state
- `3256` | "Save & resend" | button label
- `3465` | "Cotización + Acuerdo" | quote-review kind (es)
- `3465` | "Quote + Agreement" | quote-review kind (en)
- `3484` | "Close preview" | aria-label
- `3502` | "Preview language" | aria-label (group)
- `3505` | "Vista previa en" | langtoggle label (es)
- `3505` | "Preview in" | langtoggle label (en)
- `3538` | "De" | hero label (es, From)
- `3538` | "From" | hero label (en)
- `3572` | "Para" | hero label (es, For)
- `3572` | "For" | hero label (en)
- `3577` | "Switch customer" | aria-label
- `3578` | "Switch customer" | title
- `3621` | "add email" | data-placeholder (editable field)
- `3641` | "add phone" | data-placeholder (editable field)
- `3661` | "Search ${customerPickerList.length} customers…" | search placeholder
- `3662` | "Search customers…" | search placeholder
- `3679` | "Loading customers…" | empty/loading state
- `3707` | "No matches." | empty state
- `3708` | "No other customers saved yet." | empty state
- `3749` | "Cancel" | button label
- `3764` | "Detalles del trabajo" | section label (es)
- `3764` | "Job details" | section label (en)
- `3787` | "Términos" | section label (es)
- `3787` | "Terms" | section label (en)
- `3855` | "Type a custom ${t.label.toLowerCase()}…" | input placeholder
- `3915` | "Save" | button label
- `3926` | "Back" | button label
- `3979` | "+ Custom · type your own" | option button label
- `3994` | "Cancel" | button label
- `4010` | "Edit" | term-edit button title
- `4014` | "Estimado" | term value prefix (es, wraps)
- `4014` | "Estimated" | term value prefix (en, wraps)
- `4030` | "Total a pagar" | total label (es)
- `4030` | "Total due" | total label (en)
- `4034` | "$" | currency symbol
- `4110` | "Enviando…" | send button busy (es)
- `4110` | "Sending…" | send button busy (en)
- `4113` | "Enviar por texto + correo" | send button (es, both)
- `4114` | "Click here to send by Text + Email" | send button (en, both)
- `4116` | "Enviar por texto" | send button (es, sms)
- `4116` | "Click here to send by Text" | send button (en, sms)
- `4117` | "Enviar por correo" | send button (es, email)
- `4117` | "Click here to send by Email" | send button (en, email)
- `4122` | "Choose how to send" | aria-label
- `4152` | "Text + Email" | send-menu item label
- `4155` | "Recommended" | send-menu tag
- `4173` | "Text only" | send-menu item label
- `4191` | "Email only" | send-menu item label
- `4217` | "We need a little more info" | phase eyebrow
- `4219` | "Up next · Send to client" | phase eyebrow
- `4221` | "Up next · Send invoice" | phase eyebrow
- `4250` | "Invoice sent" | continue-cta title (reviewed)
- `4251` | "Contract sent" | continue-cta title (reviewed)
- `4260` | "emailed to " | continue-cta sub
- `4264` | "not delivered — " | continue-cta sub
- `4267` | "no email on file — add one to" | continue-cta sub
- `4269` | "the customer" | customer-name fallback
- `4271` | "to deliver" | continue-cta sub
- `4296` | "Business" | CTA button
- `4304` | "Person" | CTA button
- `4316` | "Review" | CTA button label
- `4318` | "Send invoice" | CTA button label
- `4319` | "Start" | CTA button label
- `4343` | "Localhost-only: flip contract to accepted, bump conversation, set unread." | dev button title
- `4345` | "🔧 " + "Simulating…" | dev button text (busy)
- `4347` | "Simulate customer accepted" | dev button text
- `4667` | "Superseded" | action-card chip label
- `4677` | "Job details" | action-card details label
- `4708` | "Total" | action-card total label
- `4726` | "Lock it in" | action-card button label
- `4734` | "Edit" | action-card button label
- `4745` | "Re-open the quote." | sendText payload (injected as visible chat content)
- `4748` | "Re-open" | action-card button label
- `4805` | "Try it · 5 seconds" | demo CTA eyebrow
- `4808` | "See what your customer sees" | demo CTA title
- `4811` | "A live sample quote — branded with everything you just shared. Opens in a new tab." | demo CTA body
- `4863` | "attached image" | img alt fallback
- `4883` | "Bossie is thinking" | aria-label (typing indicator)
- `4959` | "Voice memo" | aria-label (mic button)
- `4959` | "Tap to talk" | title (mic button)
- `4968` | "Send" | title (send button)
- `4977` | "Not sure? Just tell me about the job." | composer hint
- `5040` | "Voice memo recording" | aria-label (region)
- `5114` | "Live" | recording status label
- `5133` | "▍" | caret glyph
- `5139` | "Start talking — I'll write it out as you speak." | recording placeholder
- `5151` | "Cancel recording" | aria-label
- `5151` | "Cancel" | title
- `5170` | "Stop and send" | aria-label
- `5171` | "Stop & send" | title
- `5279` | "couldn't load customers" | error fallback
- `5345` | "That's your own email — enter the customer's so the agreement reaches them." | validation error
- `5347` | "That's your own phone number — enter the customer's so the agreement reaches them." | validation error
- `5349` | "Add a phone number or email so the customer can receive the agreement." | validation error
- `5353` | "Who is this for?" | form heading
- `5354` | "Name" | name placeholder + aria-label
- `5372` | "Phone Number" | input placeholder
- `5380` | "Email (optional)" | input placeholder
- `5410` | "Next" | button label
- `5418` | "Back" | button label
- `5429` | "Pick a Customer" | panel heading
- `5442` | "Use {boundCustomer.name} from chat" | option button label
- `5450` | "Loading customers…" | loading state
- `5454` | "No saved customers yet — add one below." | empty state
- `5468` | "Click Here For Existing Customers" | dropdown placeholder
- `5494` | "Search ${customers?.length} customers…" | search placeholder
- `5495` | "Search customers…" | search placeholder
- `5508` | "No matches." | empty state
- `5545` | "+ New Customer" | option button label
- `5605` | "%" | field suffix (percent)
- `5608` | "days" | field suffix (days)
- `5610` | "$" | field suffix (currency)
- `5651` | "{f.label}" | follow-up field label (dynamic, from option spec)
- `5673` | "Deposit · " | follow-up preview label
- `5676` | "Balance · " | follow-up preview label
- `5689` | "Use {option.label}" | submit button label
- `5697` | "Back" | button label
- `5766` | "Su","Mo","Tu","We","Th","Fr","Sa" | calendar weekday headers
- `5790` | "Previous month" | aria-label
- `5809` | "Next month" | aria-label
- `5866` | "Use this date" | button label
- `5874` | "Back" | button label
- `5959` | "—" | duration preview fallback
- `5967` | "1 day" | duration preset label
- `5968` | "2–3 days" | duration preset label
- `5969` | "1 week" | duration preset label
- `5970` | "2 weeks" | duration preset label
- `5994` | "Bossie" | bossie tag label
- `5996` | "How long will it take? Tell me however you want — \"3 weeks\", \"about a month\", \"10 business days\". I'll show you what I heard before locking it in." | bossie message
- `6003` | "e.g. about 3 weeks, a month and a half, 10 days…" | textarea placeholder
- `6045` | "Or set it manually" | chip button label
- `6055` | "Continue →" | button label
- `6063` | "Back" | button label
- `6075` | "Set the duration" | verify title
- `6077` | "Did I hear that right?" | verify title
- `6078` | "Got it — confirm and we'll lock it in" | verify title
- `6083` | "You said: " | verify sub
- `6088` | "Pick a number and a unit — I'll write it into the contract." | verify sub
- `6094` | "⚠ Best guess — please double-check before locking in." | verify warning
- `6101` | "I couldn't read that as a duration — set it manually." | verify warning
- `6123` | "Number" | aria-label
- `6132` | "Unit" | aria-label
- `6134` | "Days" | option label
- `6135` | "Weeks" | option label
- `6136` | "Months" | option label
- `6159` | "Contract reads:" | preview label
- `6169` | "Lock it in" | button label
- `6180` | "Try a different way" | button label
- `6309` | "Lifetime" | warranty preview value
- `6311` | "No warranty" | warranty preview value
- `6314` | "—" | warranty preview fallback
- `6321` | "No warranty" | warranty preset label
- `6327` | "6 months" | warranty preset label
- `6335` | "12 months" | warranty preset label
- `6343` | "24 months" | warranty preset label
- `6376` | "Bossie" | bossie tag label
- `6378` | "How long do you stand behind your work? Tell me however you want — \"12 months\", \"1 year\", \"90 days\", \"lifetime\". I'll show you what I heard before locking it in." | bossie message
- `6385` | "e.g. 1 year, 18 months, 90 days, lifetime…" | textarea placeholder
- `6426` | "Or set it manually" | chip button label
- `6436` | "Continue →" | button label
- `6444` | "Back" | button label
- `6456` | "Set the warranty" | verify title
- `6458` | "Did I hear that right?" | verify title
- `6459` | "Got it — confirm and we'll lock it in" | verify title
- `6464` | "You said: " | verify sub
- `6469` | "Pick a length — I'll write it into the contract." | verify sub
- `6475` | "⚠ Best guess — please double-check before locking in." | verify warning
- `6482` | "I couldn't read that as a warranty term — set it manually." | verify warning
- `6495` | "Warranty type" | aria-label (select)
- `6497` | "Set a term" | option label
- `6498` | "Lifetime" | option label
- `6499` | "No warranty" | option label
- `6521` | "Number" | aria-label
- `6537` | "Unit" | aria-label
- `6539` | "Days" | option label
- `6540` | "Months" | option label
- `6541` | "Years" | option label
- `6563` | "Contract reads:" | preview label
- `6573` | "Lock it in" | button label
- `6584` | "Try a different way" | button label
- `6704` | "Net 0 — due on completion" | payment preview value
- `6704` | "Net ${days}" | payment preview value
- `6707` | "—" | payment preview fallback
- `6713` | "Payment upon completion" | payment preset label
- `6720` | "50 / 50" | payment preset label
- `6727` | "30 / 30 / 40" | payment preset label
- `6734` | "Deposit + balance" | payment preset label
- `6814` | "Bossie" | bossie tag label
- `6816` | "How do you want to get paid? Tell me however you want — \"on completion\", \"50/50\", \"30/30/40\", \"deposit + balance\". I'll show you what I heard before locking it in." | bossie message
- `6823` | "e.g. on completion, 50/50 split, deposit + balance…" | textarea placeholder
- `6864` | "Or set it manually" | chip button label
- `6874` | "Continue →" | button label
- `6882` | "Back" | button label
- `6894` | "Set your payment terms" | verify title
- `6896` | "Did I hear that right?" | verify title
- `6897` | "Got it — confirm and we'll lock it in" | verify title
- `6902` | "You said: " | verify sub
- `6907` | "Pick a mode and enter the numbers — I'll write it into the contract." | verify sub
- `6914` | "⚠ Best guess — please double-check before locking in." | verify warning
- `6921` | "I couldn't read that as payment terms — set it manually." | verify warning
- `6936` | "One payment" | mode tab label
- `6946` | "Split payments" | mode tab label
- `6954` | "Due" | net field label text
- `6968` | "Days after invoice" | aria-label
- `6970` | "days after the invoice" | net field label text
- `6974` | "0 = paid same day the work wraps." | net hint
- `6975` | "Customer has ${days} day${days === 1 ? \"\" : \"s\"} to pay after you send the invoice." | net hint
- `6986` | "Deposit" | split row label
- `6986` | "On completion" | split row label
- `6990` | "On completion" | split row label
- `6991` | "Milestone ${idx}" | split row label
- `7006` | "${labelText} percentage" | aria-label
- `7008` | "%" | split pct sign
- `7016` | "Remove ${labelText}" | aria-label
- `7019` | "×" | remove button glyph
- `7036` | "+ Add milestone" | button label
- `7048` | "Auto-balance to 100%" | button label
- `7057` | "Total: {splitSum}%" | split sum label
- `7072` | "{p.label}" | payment preset label (re-rendered)
- `7078` | "Contract reads:" | preview label
- `7089` | "Lock it in" | button label
- `7100` | "Try a different way" | button label

### front-end/islands/AsstComposer.tsx
- `46` | "EX: My client wants a 10x10 concrete slab. Please help me figure out how to price" | textarea placeholder
- `58` | "Attach photo" | button title
- `61` | "Attach file" | button title
- `64` | "Voice memo" | button title
- `70` | "Send" | button title
- `79` | "⏎" | kbd glyph
- `79` | " send · " | composer hint text
- `79` | "⇧⏎" | kbd glyph
- `79` | " new line · " | composer hint text
- `79` | "⌘K" | kbd glyph
- `79` | " commands" | composer hint text

### front-end/islands/AsstThreads.tsx
- `91` | "Expand conversations" | aria-label
- `92` | "Collapse conversations" | aria-label
- `93` | "Expand" | title
- `93` | "Collapse" | title
- `110` | "Conversations" | heading
- `117` | "New conversation" | link title
- `120` | "New conversation" | link label
- `121` | "⌘N" | kbd hint
- `127` | "No conversations yet — start one below." | empty state
- `150` | "new event" | aria-label (unread dot)
- `156` | "—" | thread preview fallback
- `173` | "New conversation" | thread title fallback
- `186` | "Paid" | chip label
- `187` | "Invoiced" | chip label
- `188` | "Signed" | chip label
- `190` | "Contract sent" | chip label
- `192` | "Contract" | chip label
- `193` | "Quote sent" | chip label
- `194` | "Terms" | chip label
- `195` | "Drafting" | chip label
- `211` | "Sun","Mon","Tue","Wed","Thu","Fri","Sat" | weekday short labels (fmtTime)
- `217` | "just now" | relative time label
- `247` | "Today" | recency group label
- `248` | "Yesterday" | recency group label
- `249` | "This week" | recency group label
- `250` | "Earlier" | recency group label

### front-end/islands/ChatHeaderLive.tsx
- `63` | "Back" | back link title
- `82` | "Share thread" | button title
- `85` | "More" | button title

### front-end/islands/ClientsBoard.tsx
- `35` | "All" | filter chip label
- `36` | "Active jobs" | filter chip label
- `37` | "Leads" | filter chip label
- `38` | "Owe you" | filter chip label
- `39` | "Regulars" | filter chip label
- `40` | "Quiet" | filter chip label
- `127` | "Balance" | balance label
- `143` | "Close" | aria-label
- `155` | "Phone" | panel row label
- `169` | "Email" | panel row label
- `182` | "Address" | panel row label
- `192` | "Message" | action button label
- `198` | "Open card" | action button label
- `293` | "Search by name, address, phone, or last job…" | search input placeholder
- `321` | "Warmth" | sort button label
- `340` | "No clients yet — add your first one to start the roster." | empty state
- `341` | "No clients match this filter." | empty state

### front-end/islands/ClientsPage.tsx
- `83` | "Couldn't load clients: " | error message prefix

### front-end/islands/CodeInput.tsx
[uses i18n STRINGS]
- `166` | "Digit ${i + 1}" | input aria-label
- `179` | "…" | submit button busy state

### front-end/islands/Composer.tsx
- `45` | "Attach" | button aria-label
- `48` | "Voice" | button aria-label
- `53` | "Tell Bossie what to do…" | textarea placeholder
- `69` | "Send" | send button text

### front-end/islands/ContactForm.tsx
[uses i18n STRINGS]
- `36` | "Número incompleto" | validation error (es)
- `36` | "Phone number is incomplete" | validation error (en)
- `46` | "No se pudo enviar." | error message (es)
- `46` | "Couldn't send." | error message (en)
- `47` | "Error: ${msg}" | error message (both branches)
- `81` | "…" | submit button busy state

### front-end/islands/ContractCard.tsx
- `27` | "—" | date fallback
- `37` | "Contract signed" | milestone name
- `40` | "Work in progress" | milestone name
- `46` | "Final invoice + close-out" | milestone name
- `59` | "Site walk + start" | milestone name
- `60` | "First milestone" | milestone name
- `61` | "Mid-point check-in" | milestone name
- `62` | "Punch-list" | milestone name
- `63` | "Final walk + close" | milestone name
- `118-122` | "Progress" | progress row label
- `127` | " paid" | progress meta suffix
- `128` | " left" | progress meta suffix
- `145` | "Contract" | value label
- `163` | "Close" | aria-label
- `199` | "Invoice" | back-foot button label
- `207` | "Text ${c.client} about their ${c.title} job." | assistant seed text (injected as composer prefill)
- `212` | "Text client" | back-foot button label
- `221` | "View contract" | back-foot button label

### front-end/islands/ContractsPage.tsx
- `77` | "Couldn't load contracts: " | error message prefix
- `148` | "In progress" | track title
- `150` | "job" / "jobs" | count unit (singular/plural)
- `151` | " · crew on site" | count suffix
- `153` | "01" | track number (decorative numeral)
- `166` | "Nothing in flight today. As soon as a customer signs a contract from the assistant, it lands here." | empty state
- `173` | "Starting soon" | track title
- `174` | "02" | track number
- `175` | "job" / "jobs" | count unit
- `176` | " · next 14 days" | count suffix
- `188` | "No jobs scheduled in the next 14 days." | empty state
- `193` | "Wrapping up" | track title
- `194` | "03" | track number
- `195` | "job" / "jobs" | count unit
- `196` | " · final invoice next" | count suffix
- `210` | "Nothing within a week of completion right now." | empty state
- `217` | "04" | track number
- `218` | "Drafts" | track title
- `219` | "draft" / "drafts" | count unit

### front-end/islands/ContractTrack.tsx
- (none) — `num`, `title`, `count` all passed in as props

### front-end/islands/Counter.tsx
- `11` | "-1" | button label
- `13` | "+1" | button label

### front-end/islands/DashboardPage.tsx
- `35-48` | "Jan","Feb",…,"Dec" | short-month labels
- `49` | "Sun","Mon",…,"Sat" | short-day labels
- `52` | "No due date" | due-date label
- `60` | "Today" | due-date label
- `61` | "Tomorrow" | due-date label
- `62` | "Yesterday" | due-date label
- `73` | "${m} min ago" | relative time label
- `75` | "${h} hr ago" | relative time label
- `76` | "Yesterday" | relative time label
- `78` | "${d} days ago" | relative time label
- `93` | "${...} paid" | job paid-label
- `94` | "Deposit" | job paid-label
- `94` | "Quoted" | job paid-label
- `116` | "—" | client-from-summary fallback
- `119` | "—" | client-from-summary fallback
- `124` | "Sent ${...}" | quote sent-label
- `124` | " · Viewed" | quote sent-label suffix
- `126` | "Drafted" | quote sent-label
- `156` | "${-days} day${...} overdue · #INV-${...}" | invoice meta
- `162` | "Due in ${days} day${...} · #INV-${...}" | invoice meta
- `167` | "Due ${month} ${date} · #INV-${...}" | invoice meta
- `172` | "—" | invoice client-name fallback
- `403` | "Couldn't load dashboard: " | error message prefix
- `459` | " · ${dupes}×" | activity dupe-count suffix

### front-end/islands/DashSidebar.tsx
- `25` | "Dashboard" | nav label (en)
- `30` | "Clients" | nav label (en)
- `37` | "Quotes" | nav label (en)
- `43` | "Invoices" | nav label (en)
- `47` | "Payments" | nav label (en)
- `65` | "Inicio" | nav label (es)
- `66` | "Clientes" | nav label (es)
- `67` | "Cotizaciones" | nav label (es)
- `68` | "Contratos" | nav label (es)
- `69` | "Facturas" | nav label (es)
- `70` | "Pagos" | nav label (es)
- `106` | "Account" | identity display fallback
- `198` | "Go to Dashboard" | brand link title
- `209` | "Paperwork Monster" | brand name
- `216` | "My Assistant — AI quote builder" | assistant link title
- `223` | "Mi Asistente" | assistant link label (es)
- `223` | "My Assistant" | assistant link label (en)
- `300` | "Expand sidebar" / "Collapse sidebar" | aria-label
- `301` | "Expand" / "Collapse" | title
- `331` | "Cerrar sesión" | logout label (es)
- `331` | "Log out" | logout label (en)

### front-end/islands/DashTopbar.tsx
- `79` | "Toggle sidebar" | menu button aria-label
- `88` | "Hey, ${greetingName} 👋" | greeting line (greetingOverride takes precedence)
- `106` | "Live activity — open feed" | ticker aria-label
- `118` | "${ticker.time} ago" | ticker time suffix

### front-end/islands/DeleteQuoteButton.tsx
- `15` | "Delete" | default label prop
- `16` | "Delete this quote? This cannot be undone." | default confirm() text prop
- `30` | "Couldn't delete quote: ${...}" | alert() text
- `41` | "Delete quote" | aria-label (icon variant)
- `42` | "Delete quote" | title (icon variant)
- `45` | "×" | icon variant glyph
- `51` | "Deleting…" | button busy state

### front-end/islands/DemoPhoneChat.tsx
[subscribes to langSignal — but the bilingual script below is hardcoded inline, NOT from STRINGS]
- `8` | "Hey Bossie — kitchen remodel for the Riveras. Got pics." | demo chat bubble (en)
- `9` | "Got 'em. Want me to draft a quote at $14,200?" | demo chat bubble (en)
- `10` | "Yeah send it." | demo chat bubble (en)
- `13` | "Sent. They opened it. I'll nudge if no reply by Friday." | demo chat bubble (en)
- `19` | "Bossie — remodelación de cocina para los Rivera. Tengo fotos." | demo chat bubble (es)
- `20` | "Listo. ¿Cotización a $14,200?" | demo chat bubble (es)
- `21` | "Sí, mándalo." | demo chat bubble (es)
- `26` | "Enviado. Ya lo abrieron. Si no contestan el viernes, los empujo." | demo chat bubble (es)

### front-end/islands/DocTabs.tsx
[uses i18n STRINGS]
- (none) — tab labels come from `STRINGS[...]["docs.tabs"]`

### front-end/islands/HeroRotor.tsx
[uses i18n STRINGS]
- (none) — rotor words come from `STRINGS[...]["hero.rotor"]`

### front-end/islands/InvoicesPage.tsx
- `46-59` | "Jan"…"Dec" | short-month labels
- `66` | "by check" | payment method label
- `68` | "via Venmo" | payment method label
- `70` | "via Zelle" | payment method label
- `72` | "via Cash App" | payment method label
- `74` | "via PayPal" | payment method label
- `76` | "in cash" | payment method label
- `78` | "by bank transfer" | payment method label
- `80` | "via other" | payment method label
- `82` | "—" | payment method fallback
- `105`,`152` | "—" | date / client fallback
- `117` | "—" | initials fallback
- `207` | "Overdue" | stage mood label
- `214` | "Out" | stage mood label
- `221` | "Awaiting confirmation" | stage mood label
- `228` | "Scheduled" | stage mood label
- `235` | "Draft" | stage mood label
- `242` | "Paid" | stage mood label
- `314` | "Couldn't load invoices: " | error message prefix
- `377` | "Overdue · needs a poke" | track title
- `379`,`397`,`419`,`437`,`459`,`479` | "invoice" | QuoteTrack `unit` prop
- `384` | "No overdue invoices. Nice work." | empty-track hint
- `396` | "Awaiting confirmation" | track title
- `404` | "No claimed payments waiting for you to confirm." | empty-track hint
- `417` | "Out for payment" | track title
- `424` | "Nothing waiting. Send a quote to get paid." | empty-track hint
- `436` | "Upcoming" | track title
- `444` | "No scheduled invoices. Multi-installment contracts will surface here." | empty-track hint
- `457` | "Drafting" | track title
- `465` | "No drafts in progress. Open the assistant to start one." | empty-track hint
- `478` | "Paid this month" | track title
- `486` | "Nothing paid yet this month — payments land here once they clear." | empty-track hint
- `528` | "Receivables · this week" | hero eyebrow
- `533` | "No invoices yet — " | hero title
- `534` | "let's start the river" | hero title (em)
- `540` | "All clear — " | hero title
- `541` | "nothing outstanding" | hero title (em)
- `547` | " expected this week" | hero title
- `548` | "across" | hero title
- `549` | "payment" / "payments" | hero title unit
- `555` | "Quiet week — " | hero title
- `556` | " coming next week." | hero title
- `561` | " on the way" | hero title
- `562` | "across" | hero title
- `563` | "invoice" / "invoices" | hero title unit
- `571` | "Once a contract is signed, drop the first invoice in. The monsters track every one — overdue, en route, drafting, paid — so you don't have to remember which is which." | hero sub
- `583` | "${e.label} ${fmtMoney(e.amount)}" | forecast breakdown line
- `591` | "is" / "are" | hero sub verb
- `593` | " past due — start there. The monsters drafted a friendly nudge for each one." | hero sub
- `599` | "Nothing past due. The monsters are watching for the next billing cycle." | hero sub
- `611` | "⚠ " | at-risk warning prefix
- `612` | " at risk across" | at-risk text
- `613` | "overdue" | at-risk text
- `613` | "invoice" / "invoices" | at-risk unit
- `621` | "Draft a new invoice for me." | assistant seed text (injected into composer)
- `624` | "New invoice" | CTA link label
- `632` | "Export ${year} CSV" | export CTA link label
- `664` | "Overdue" | KPI label
- `667` | "invoice" / "invoices" | KPI sub unit
- `671` | "Out for payment" | KPI label
- `673` | " on the way" | KPI sub
- `676` | "Drafting" | KPI label
- `679` | "no drafts open" / "finish + send" | KPI sub
- `683` | "Paid this month" | KPI label
- `685` | " cleared" | KPI sub
- `716` | "Okay, I got it" | invoice CTA (claimed)
- `718` | "Send nudge" | invoice CTA (overdue)
- `720` | "Send now" | invoice CTA (scheduled)
- `722` | "View invoice" | invoice CTA (out)
- `724` | "Finish + send" | invoice CTA (drafting)
- `726` | "View receipt" | invoice CTA (paid)
- `728` | "Customer paid ${methodLabel}" | subline (claimed)
- `730` | " · ref " | subline ref suffix
- `734` | "${days}d overdue · due ${date}" | subline (overdue)
- `736` | "Scheduled to send ${...}" / "—" | subline (scheduled) + fallback
- `738` | "Out ${days}d · due ${date}" | subline (out)
- `740` | "Draft started ${date}" | subline (drafting)
- `741` | "Paid ${date}" | subline (paid)
- `851` | "Enter a discount amount." | adjustment error
- `864` | "Couldn't apply discount." | adjustment error
- `873` | "Add a description and amount." | adjustment error
- `890` | "Couldn't create change order." | adjustment error
- `930`,`1096` | "…" | busy state on CTA buttons
- `935` | "Cleared" / "Due" | value label (paid / other)
- `954` | "Close" | aria-label
- `958` | "Invoice detail" | back eyebrow
- `968` | "Past due ${daysOverdue} day(s). A friendly text usually unsticks it." | back read text
- `974` | "Issued ${date}. Due ${date}." | back read text
- `980` | "Draft started ${date}. Open it to finish and send." | back read text
- `987` | "Cleared ${date}. Receipt sent automatically." | back read text
- `1002` | "Hide adjustments" / "Adjust invoice ▾" | toggle button label
- `1008` | "Discount" | adjustment section label
- `1015` | "$ off" | input placeholder
- `1029` | "Apply" | button label
- `1035` | "Change order (needs customer approval)" | adjustment section label
- `1039` | "What changed?" | input placeholder
- `1049` | "+/- $" | input placeholder
- `1061` | "Create link" | button label
- `1067` | "Approval link: " | link section text
- `1077` | "Send this to your customer to approve." | helper text
- `1098` | "Open" | back-foot button label
- `1105` | "Reopen this invoice — you never received this payment" | button title
- `1107` | "Didn't get it" | button label
- `1117` | "Reminders are off for this invoice" | button title
- `1119` | "Mute reminders for this invoice" | button title
- `1121` | "Muted" / "Mute" | button label
- `1126` | "Text client" | button label
### front-end/islands/LandingScripts.tsx
Note: this island stores its EN/ES copy in local `I18N` / `DOC_CONTENT` dictionaries (NOT the shared `lib/lang` STRINGS) and applies them via `[data-i18n]` DOM substitution. All of these dictionary values are user-facing display text rendered into the landing page. Listing them all.
- `27` | "What We Do" | nav label (en)
- `28` | "How It Works" | nav label (en)
- `29` | "Pricing" | nav label (en)
- `30` | "Get Started" | nav CTA (en)
- `31` | "Log in" | nav login (en)
- `32` | "For pros" | hero kicker pill (en)
- `33` | "Built for contractors who work with their hands" | hero kicker (en)
- `34` | "You do the work." | hero h1a (en)
- `35` | "We handle the" | hero h1b (en)
- `36-37` | "Quotes, contracts, and invoices done right — so you get paid what your work is worth. No apps to learn. Just text us." | hero lead (en)
- `38` | "Get Started →" | hero cta1 (en)
- `39` | "See How It Works" | hero cta2 (en)
- `40` | "1,200+ contractors" | hero trust strong (en)
- `41` | "getting paid faster" | hero trust rest (en)
- `42` | "Quote sent" | hero chip1 (en)
- `43` | "Contract signed" | hero chip2 (en)
- `44` | "Paid in full" | hero chip3 (en)
- `45` | "Quote" | doc tag (en)
- `46` | "Kitchen remodel" | doc title (en)
- `47` | "Cabinets" | doc line (en)
- `48` | "Counters" | doc line (en)
- `49` | "Labor (3 days)" | doc line (en)
- `50` | "Total" | doc total label (en)
- `51` | "Contract" | doc tag (en)
- `52` | "Service Agreement" | doc title (en)
- `53` | "Client" | doc line (en)
- `54` | "Job ID" | doc line (en)
- `55` | "Start" | doc line (en)
- `56` | "Status" | doc line (en)
- `57` | "Signed ✓" | doc status (en)
- `58` | "Invoice" | doc tag (en)
- `59` | "Final billing" | doc title (en)
- `60` | "Subtotal" | doc line (en)
- `61` | "Deposit paid" | doc line (en)
- `62` | "Due" | doc due label (en)
- `63` | "The problem" | problem eyebrow (en)
- `64` | "Good work deserves <em>good paperwork</em>" | problem heading (en, html)
- `65-66` | "You know your trade. But chasing down quotes on scrap paper and guessing at prices is costing you real money." | problem lead (en)
- `67` | "Leaving money on the table" | problem card heading (en)
- `68-69` | "Without solid pricing info, most contractors bid too low. That means less money in your pocket for the same hard work." | problem card body (en)
- `70` | "Paperwork that doesn't look right" | problem card heading (en)
- `71-72` | "Handwritten quotes on notebook paper don't build trust. Clients pick the contractor who looks like they have it together." | problem card body (en)
- `73` | "Hours you're not getting paid for" | problem card heading (en)
- `74-75` | "Every hour figuring out paperwork is an hour you could be on a job site earning real money." | problem card body (en)
- `76` | "One text. Three documents." | docs eyebrow (en)
- `77` | "Quote, contract, invoice — <em>handled</em>." | docs heading (en, html)
- `78-79` | "Send us a message. We send back a real document with real numbers — not a sketch on the back of an envelope." | docs lead (en)
- `80` | "Quote" | docs tab (en)
- `81` | "Contract" | docs tab (en)
- `82` | "Invoice" | docs tab (en)
- `83` | "Documents sent so far" | docs counter label (en)
- `84` | "Quotes" | docs counter (en)
- `85` | "Contracts" | docs counter (en)
- `86` | "Invoices" | docs counter (en)
- `87` | "Change orders" | docs counter (en)
- `88` | "What we do" | feat eyebrow (en)
- `89` | "We take care of the <em>business side</em>" | feat heading (en, html)
- `90-91` | "From the first quote to the final invoice — we handle it so you can stay on the job." | feat lead (en)
- `92` | "Fair prices, not guesses" | feat heading (en)
- `93-94` | "Real construction pricing data, adjusted for today's costs. Get a low, middle, and high range so you know exactly where you stand." | feat body (en)
- `95` | "Contracts that protect you" | feat heading (en)
- `96-97` | "One tap turns your quote into a real contract. Protect your work and look professional to your clients." | feat body (en)
- `98` | "Simple invoicing" | feat heading (en)
- `99-100` | "Job done? We turn it into an invoice. Keep track of who's paid and who hasn't — without a spreadsheet." | feat body (en)
- `101` | "Just text us" | feat heading (en)
- `102-103` | "No fancy apps. No complicated software. Text us the job details and we do the rest. Simple as that." | feat body (en)
- `104` | "Straight to the point" | how eyebrow (en)
- `105` | "How it works" | how heading (en)
- `106-107` | "Three steps. No forms. No software. We meet you where you already are — your phone." | how lead (en)
- `108` | "Tell us about the job" | how step heading (en)
- `109-110` | "Send us a text with the job details. We'll ask you one question at a time — no long forms, no hassle." | how step body (en)
- `111` | "Check your quote" | how step heading (en)
- `112-113` | "We put together a professional quote with fair pricing. Look it over, change what you need, and give us the thumbs up." | how step body (en)
- `114` | "Send it and get paid" | how step heading (en)
- `115-116` | "Send the quote to your client. When the job's done, we turn it into a contract and invoice. Everything's in one place." | how step body (en)
- `117` | "See it in action" | demo eyebrow (en)
- `118` | "Just text us. We handle the rest." | demo heading (en)
- `119-120` | "Quotes, contracts, invoices — sent from your phone in seconds. No app to download. No software to learn." | demo lead (en)
- `121-122` | "I used to spend my Sundays writing quotes on notebook paper. Now I text these guys the job details from my truck and get a professional quote back in minutes. My close rate went through the roof." | demo testimonial (en)
- `123` | "General Contractor · 12 years" | demo role (en)
- `124` | "Online" | demo online status (en)
- `125` | "Message" | demo input placeholder copy (en)
- `126` | "Pricing" | price eyebrow (en)
- `127` | "Pay us from <em>what we make you</em>" | price heading (en, html)
- `128-129` | "Quotes, contracts, invoices, pricing, follow-ups — we run your back office so you can stay on the job site. And it pays for itself." | price lead (en)
- `130` | "Without us" | price column (en)
- `131` | "With us" | price column (en)
- `132` | "You keep" | price keep (en)
- `133` | "You keep" | price keep2 (en)
- `134` | "Your guess at price" | price row (en)
- `135` | "Hours doing paperwork" | price row (en)
- `136` | "~6 hrs" | price row value (en)
- `137` | "Trust from clients" | price row (en)
- `138` | "So-so" | price row value (en)
- `139` | "Real-data pricing" | price row (en)
- `140` | "Our 10% fee" | price row (en)
- `141` | "Hours doing paperwork" | price row (en)
- `142` | "$850 more in your pocket." | price callout (en)
- `143-144` | "A back office that pays for itself. Only charged when your client pays." | price callout sub (en)
- `145` | "Start Making More →" | price cta (en)
- `146` | "Let's go" | cta eyebrow (en)
- `147` | "Ready to get the paperwork off your plate?" | cta heading (en)
- `148-149` | "Drop your number — we'll text you a 6-digit code. Login or sign up, same form." | cta lead (en)
- `150` | "No setup fees, no contracts" | cta bullet (en)
- `151` | "First quote on us — for new pros" | cta bullet (en)
- `152` | "English & Spanish, every step" | cta bullet (en)
- `153` | "Your phone number" | cta label (en)
- `154` | "Send my code" | cta button (en)
- `155` | "By submitting, you agree to receive a friendly text from us." | cta fine print (en)
- `156-157` | "Paperwork Monster: Your code is 482-913. Don't share it." | cta SMS preview (en)
- `158` | "Phone" | cta step (en)
- `159` | "Code" | cta step (en)
- `160` | "You're in" | cta step (en)
- `161` | "Use" | cta use-saved button (en)
- `162` | "Not you?" | cta not-you dismiss (en)
- `163` | "Contact" | footer contact (en)
- `164` | "© 2026 Paperwork Monster. All rights reserved." | footer copyright (en)
- `167` | "Qué hacemos" | nav label (es)
- `168` | "Cómo funciona" | nav label (es)
- `169` | "Precios" | nav label (es)
- `170` | "Empezar" | nav CTA (es)
- `171` | "Entrar" | nav login (es)
- `172` | "Para pros" | hero kicker pill (es)
- `173` | "Hecho para contratistas que trabajan con las manos" | hero kicker (es)
- `174` | "Tú haces el trabajo." | hero h1a (es)
- `175` | "Nosotros manejamos las" | hero h1b (es)
- `176-177` | "Cotizaciones, contratos y facturas bien hechos — para que cobres lo que tu trabajo vale. Sin apps que aprender. Solo escríbenos." | hero lead (es)
- `178` | "Empezar →" | hero cta1 (es)
- `179` | "Ver cómo funciona" | hero cta2 (es)
- `180` | "+1.200 contratistas" | hero trust strong (es)
- `181` | "cobrando más rápido" | hero trust rest (es)
- `182` | "Cotización enviada" | hero chip1 (es)
- `183` | "Contrato firmado" | hero chip2 (es)
- `184` | "Pagado completo" | hero chip3 (es)
- `185` | "Cotización" | doc tag (es)
- `186` | "Remodelación cocina" | doc title (es)
- `187` | "Gabinetes" | doc line (es)
- `188` | "Cubiertas" | doc line (es)
- `189` | "Mano de obra (3 días)" | doc line (es)
- `190` | "Total" | doc total label (es)
- `191` | "Contrato" | doc tag (es)
- `192` | "Acuerdo de servicio" | doc title (es)
- `193` | "Cliente" | doc line (es)
- `194` | "ID Trabajo" | doc line (es)
- `195` | "Inicio" | doc line (es)
- `196` | "Estado" | doc line (es)
- `197` | "Firmado ✓" | doc status (es)
- `198` | "Factura" | doc tag (es)
- `199` | "Cobro final" | doc title (es)
- `200` | "Subtotal" | doc line (es)
- `201` | "Anticipo pagado" | doc line (es)
- `202` | "Por pagar" | doc due label (es)
- `203` | "El problema" | problem eyebrow (es)
- `204` | "Buen trabajo merece <em>buen papeleo</em>" | problem heading (es, html)
- `205-206` | "Tú conoces tu oficio. Pero hacer cotizaciones en papel y adivinar precios te está costando dinero de verdad." | problem lead (es)
- `207` | "Dejas dinero en la mesa" | problem card heading (es)
- `208-209` | "Sin info real de precios, la mayoría de contratistas cotizan bajo. Menos dinero en tu bolsillo por el mismo trabajo duro." | problem card body (es)
- `210` | "Papeles que no se ven bien" | problem card heading (es)
- `211-212` | "Cotizaciones a mano en papel rayado no inspiran confianza. El cliente elige al que se ve organizado." | problem card body (es)
- `213` | "Horas que no te pagan" | problem card heading (es)
- `214-215` | "Cada hora batallando con papeles es una hora que podrías estar en obra ganando dinero." | problem card body (es)
- `216` | "Un mensaje. Tres documentos." | docs eyebrow (es)
- `217` | "Cotización, contrato, factura — <em>listo</em>." | docs heading (es, html)
- `218-219` | "Mándanos un mensaje. Te regresamos un documento real con números reales — no un garabato en una servilleta." | docs lead (es)
- `220` | "Cotización" | docs tab (es)
- `221` | "Contrato" | docs tab (es)
- `222` | "Factura" | docs tab (es)
- `223` | "Documentos enviados hasta hoy" | docs counter label (es)
- `224` | "Cotizaciones" | docs counter (es)
- `225` | "Contratos" | docs counter (es)
- `226` | "Facturas" | docs counter (es)
- `227` | "Órdenes de cambio" | docs counter (es)
- `228` | "Qué hacemos" | feat eyebrow (es)
- `229` | "Nos encargamos del <em>lado del negocio</em>" | feat heading (es, html)
- `230-231` | "Desde la primera cotización hasta la factura final — nosotros lo manejamos para que tú sigas en la obra." | feat lead (es)
- `232` | "Precios justos, no adivinanzas" | feat heading (es)
- `233-234` | "Datos reales de construcción ajustados a costos de hoy. Rango bajo, medio y alto para que sepas exactamente dónde estás parado." | feat body (es)
- `235` | "Contratos que te protegen" | feat heading (es)
- `236-237` | "Un toque convierte tu cotización en un contrato real. Protege tu trabajo y luce profesional con tus clientes." | feat body (es)
- `238` | "Facturación sencilla" | feat heading (es)
- `239-240` | "¿Trabajo terminado? Lo convertimos en factura. Lleva el control de quién pagó y quién no — sin hojas de cálculo." | feat body (es)
- `241` | "Solo escríbenos" | feat heading (es)
- `242-243` | "Sin apps complicadas. Sin software. Mándanos los detalles del trabajo por mensaje y nosotros hacemos el resto. Así de fácil." | feat body (es)
- `244` | "Directo al grano" | how eyebrow (es)
- `245` | "Cómo funciona" | how heading (es)
- `246-247` | "Tres pasos. Sin formularios. Sin software. Te encontramos donde ya estás — en tu celular." | how lead (es)
- `248` | "Cuéntanos del trabajo" | how step heading (es)
- `249-250` | "Mándanos un mensaje con los detalles. Te preguntamos una cosa a la vez — sin formularios largos." | how step body (es)
- `251` | "Revisa tu cotización" | how step heading (es)
- `252-253` | "Armamos una cotización profesional con precios justos. Revísala, cambia lo que necesites, y dale el visto bueno." | how step body (es)
- `254` | "Envía y cobra" | how step heading (es)
- `255-256` | "Mándale la cotización a tu cliente. Cuando termines el trabajo, lo convertimos en contrato y factura. Todo en un solo lugar." | how step body (es)
- `257` | "Mira cómo funciona" | demo eyebrow (es)
- `258` | "Solo escríbenos. Nosotros nos encargamos." | demo heading (es)
- `259-260` | "Cotizaciones, contratos, facturas — enviados desde tu celular en segundos. Sin app que descargar. Sin software que aprender." | demo lead (es)
- `261-262` | "Antes pasaba los domingos haciendo cotizaciones en papel rayado. Ahora les escribo desde la troca y me regresan una cotización pro en minutos. Mi cierre de ventas se disparó." | demo testimonial (es)
- `263` | "Contratista General · 12 años" | demo role (es)
- `264` | "En línea" | demo online status (es)
- `265` | "Mensaje" | demo input placeholder copy (es)
- `266` | "Precios" | price eyebrow (es)
- `267` | "Páganos de <em>lo que te hacemos ganar</em>" | price heading (es, html)
- `268-269` | "Cotizaciones, contratos, facturas, precios, seguimientos — corremos tu oficina para que tú sigas en la obra. Y se paga sola." | price lead (es)
- `270` | "Sin nosotros" | price column (es)
- `271` | "Con nosotros" | price column (es)
- `272` | "Te quedas con" | price keep (es)
- `273` | "Te quedas con" | price keep2 (es)
- `274` | "Tu adivinanza de precio" | price row (es)
- `275` | "Horas en papeleo" | price row (es)
- `276` | "~6 hrs" | price row value (es)
- `277` | "Confianza del cliente" | price row (es)
- `278` | "Más o menos" | price row value (es)
- `279` | "Precios con datos reales" | price row (es)
- `280` | "Nuestra comisión 10%" | price row (es)
- `281` | "Horas en papeleo" | price row (es)
- `282` | "$850 más en tu bolsillo." | price callout (es)
- `283-284` | "Una oficina que se paga sola. Solo cobramos cuando tu cliente paga." | price callout sub (es)
- `285` | "Empieza a ganar más →" | price cta (es)
- `286` | "Vamos" | cta eyebrow (es)
- `287` | "¿Listo para quitarte el papeleo de encima?" | cta heading (es)
- `288-289` | "Pon tu número — te enviamos un código de 6 dígitos. Entrar o registrarse, mismo formulario." | cta lead (es)
- `290` | "Sin cuotas iniciales, sin contratos" | cta bullet (es)
- `291` | "Primera cotización gratis — para nuevos pros" | cta bullet (es)
- `292` | "Inglés y español, en cada paso" | cta bullet (es)
- `293` | "Tu número de teléfono" | cta label (es)
- `294` | "Enviar mi código" | cta button (es)
- `295-296` | "Al enviar, aceptas recibir un mensaje amigable de nuestra parte." | cta fine print (es)
- `297-298` | "Paperwork Monster: Tu código es 482-913. No lo compartas." | cta SMS preview (es)
- `299` | "Teléfono" | cta step (es)
- `300` | "Código" | cta step (es)
- `301` | "Listo" | cta step (es)
- `302` | "Usar" | cta use-saved button (es)
- `303` | "¿No eres tú?" | cta not-you dismiss (es)
- `304` | "Contacto" | footer contact (es)
- `305` | "© 2026 Paperwork Monster. Todos los derechos reservados." | footer copyright (es)
- `330` | "Demolition & haul-off" | quote doc line desc (en)
- `331` | "Cabinets — solid maple" | quote doc line desc (en)
- `332` | "Quartz countertops (sq ft)" | quote doc line desc (en)
- `333` | "Plumbing & install labor" | quote doc line desc (en)
- `333` | "3 days" | quote doc line qty (en)
- `335` | "Subtotal" | quote doc total (en)
- `335` | "Tax (estimate)" | quote doc total (en)
- `336` | "Estimate" | quote doc total (en)
- `339` | "Fair prices, not guesses" | quote doc info title (en)
- `340-341` | "We pull from real construction pricing data — adjusted for today's costs and your zip code. You get a low, mid, and high range so you know exactly where you stand." | quote doc info body (en)
- `343` | "Low / mid / high pricing ranges" | quote doc info list (en)
- `344` | "Local material costs, refreshed weekly" | quote doc info list (en)
- `345` | "Branded PDF you can text or email" | quote doc info list (en)
- `346` | "Edit anything in one tap" | quote doc info list (en)
- `350` | "Contract" | contract doc title (en)
- `354` | "Job details: Kitchen remodel — Hernández" | contract doc line (en)
- `355` | "Start date" | contract doc line (en)
- `355` | "May 2" | contract doc line value (en)
- `356` | "Substantial completion" | contract doc line (en)
- `356` | "May 14" | contract doc line value (en)
- `357` | "Deposit (25%)" | contract doc line (en)
- `358` | "Progress payment (50%)" | contract doc line (en)
- `359` | "Final payment" | contract doc line (en)
- `361` | "Total contract value" | contract doc total (en)
- `362` | "Signed by client" | contract doc total (en)
- `363` | "✓ Apr 26" | contract doc total value (en)
- `364` | "Status" | contract doc total (en)
- `364` | "Active" | contract doc total value (en)
- `365` | "Contracts that protect you" | contract doc info title (en)
- `366-367` | "One tap turns your quote into a real, lawyer-reviewed contract. Spell out the job details, the schedule, and the payments — so there are no surprises later." | contract doc info body (en)
- `369` | "State-specific terms, ready to go" | contract doc info list (en)
- `370` | "E-signature from your client" | contract doc info list (en)
- `371` | "Auto deposit + progress milestones" | contract doc info list (en)
- `372` | "Stored alongside the job, forever" | contract doc info list (en)
- `376` | "Invoice" | invoice doc title (en)
- `380` | "Kitchen remodel — completed" | invoice doc line (en)
- `381` | "Change order: under-cabinet lighting" | invoice doc line (en)
- `382` | "Deposit received" | invoice doc line (en)
- `383` | "Progress payment received" | invoice doc line (en)
- `385` | "Balance due" | invoice doc total (en)
- `385` | "Due by" | invoice doc total (en)
- `385` | "May 18, 2026" | invoice doc total value (en)
- `386-387` | "Pay online" | invoice doc total (en)
- `387` | "tap to pay" | invoice doc total value (en)
- `389` | "Simple invoicing, paid faster" | invoice doc info title (en)
- `390-391` | "Job done? We turn the contract into an invoice. Track who's paid, who hasn't, and send a one-tap reminder when it's time." | invoice doc info body (en)
- `393` | "One-tap "pay now" link for clients" | invoice doc info list (en)
- `394` | "Automatic payment reminders" | invoice doc info list (en)
- `395` | "See balance due at a glance" | invoice doc info list (en)
- `396` | "Export for taxes and bookkeeping" | invoice doc info list (en)
- `402` | "Cotización" | quote doc title (es)
- `406` | "Demolición y limpieza" | quote doc line desc (es)
- `407` | "Gabinetes — maple sólido" | quote doc line desc (es)
- `408` | "Cubiertas de cuarzo (pie²)" | quote doc line desc (es)
- `409` | "Plomería e instalación" | quote doc line desc (es)
- `409` | "3 días" | quote doc line qty (es)
- `411` | "Subtotal" | quote doc total (es)
- `411` | "Impuesto (est.)" | quote doc total (es)
- `412` | "Estimado" | quote doc total (es)
- `415` | "Precios justos, no adivinanzas" | quote doc info title (es)
- `416-417` | "Sacamos los datos de precios reales de construcción — ajustados a costos de hoy y tu código postal. Rango bajo, medio y alto para que sepas dónde estás parado." | quote doc info body (es)
- `419` | "Rangos bajo / medio / alto" | quote doc info list (es)
- `420` | "Costos locales, refrescados cada semana" | quote doc info list (es)
- `421` | "PDF con tu marca para mandar" | quote doc info list (es)
- `422` | "Edita lo que sea con un toque" | quote doc info list (es)
- `426` | "Contrato" | contract doc title (es)
- `430` | "Alcance: Remodelación cocina — Hernández" | contract doc line (es)
- `431` | "Fecha de inicio" | contract doc line (es)
- `431` | "2 de mayo" | contract doc line value (es)
- `432` | "Terminación" | contract doc line (es)
- `432` | "14 de mayo" | contract doc line value (es)
- `433` | "Anticipo (25%)" | contract doc line (es)
- `434` | "Avance (50%)" | contract doc line (es)
- `435` | "Pago final" | contract doc line (es)
- `438` | "Valor total" | contract doc total (es)
- `439` | "Firmado por cliente" | contract doc total (es)
- `439` | "✓ 26 abr" | contract doc total value (es)
- `440` | "Estado" | contract doc total (es)
- `440` | "Activo" | contract doc total value (es)
- `442` | "Contratos que te protegen" | contract doc info title (es)
- `443-444` | "Un toque convierte tu cotización en un contrato real, revisado por abogados. Define alcance, calendario y pagos — sin sorpresas después." | contract doc info body (es)
- `446` | "Términos por estado, listos" | contract doc info list (es)
- `447` | "Firma electrónica del cliente" | contract doc info list (es)
- `448` | "Anticipos y avances automáticos" | contract doc info list (es)
- `449` | "Guardado con el trabajo para siempre" | contract doc info list (es)
- `453` | "Factura" | invoice doc title (es)
- `457` | "Remodelación cocina — completada" | invoice doc line (es)
- `458` | "Orden de cambio: luces bajo gabinete" | invoice doc line (es)
- `459` | "Anticipo recibido" | invoice doc line (es)
- `460` | "Pago de avance recibido" | invoice doc line (es)
- `463` | "Saldo por pagar" | invoice doc total (es)
- `464` | "Vence" | invoice doc total (es)
- `464` | "18 de mayo de 2026" | invoice doc total value (es)
- `465` | "Paga en línea" | invoice doc total (es)
- `465` | "toca para pagar" | invoice doc total value (es)
- `467` | "Facturación simple, cobrado más rápido" | invoice doc info title (es)
- `468-469` | "¿Trabajo terminado? Convertimos el contrato en factura. Lleva el control de quién pagó, quién no, y manda recordatorios con un toque." | invoice doc info body (es)
- `471` | "Enlace de pago con un toque" | invoice doc info list (es)
- `472` | "Recordatorios automáticos" | invoice doc info list (es)
- `473` | "Saldo a la vista" | invoice doc info list (es)
- `474` | "Exporta para impuestos y contabilidad" | invoice doc info list (es)
- `793` | "Sending…" | submit button loading text (en, injected)
- `792` | "Enviando…" | submit button loading text (es, injected)
- `814` | "No pudimos enviar. Intenta otra vez." | submit error message (es, injected)
- `815` | "Couldn't send. Try again." | submit error message (en, injected)

### front-end/islands/LangToggle.tsx
- `20` | "Language" | aria-label on toggle group
- `27` | "EN" | English toggle button label
- `34` | "ES" | Spanish toggle button label

### front-end/islands/LoginForm.tsx
Note: uses `langSignal` for an `es` boolean but the strings themselves are hardcoded inline (not from STRINGS).
- `39` | "Número incompleto" | validation error (es)
- `39` | "Phone number is incomplete" | validation error (en)
- `49` | "No se pudo enviar." | submit error (es)
- `49` | "Couldn't send." | submit error (en)
- `66` | "Tu celular" | phone field label (es)
- `66` | "Your phone number" | phone field label (en)
- `75` | "(555) 123-4567" | phone input placeholder
- `92` | "…" | submit button loading text
- `92` | "Enviar código" | submit button (es)
- `92` | "Text me a code" | submit button (en)
- `96` | "Te enviaremos un código de 6 dígitos por mensaje." | helper text (es)
- `97` | "We'll text you a 6-digit code to sign in." | helper text (en)

### front-end/islands/MobileViewport.tsx
- (none)

### front-end/islands/MoneyInput.tsx
- `217` | "Amount" | eyebrow label
- `246` | "Amount in dollars" | input aria-label
- `251` | "Clear amount" | clear button aria-label
- `281` | "Tap a preset or type an amount" | touch hint (words sub-line)
- `281` | "Type or tap a preset · ↑ ↓ to nudge $10 · Shift = $100" | keyboard hint (words sub-line)
- `284` | "Quick amounts" | chips group aria-label
- `394` | "zero dollars" | spelled-out value (centsToWords)
- `397` | "dollar" / "dollars" | spelled-out value unit
- `400` | "cent" / "cents" | spelled-out value unit
- `401` | "and" | spelled-out value connector
- `403-424` | "zero".."nineteen" | number-word units (ONES array, rendered in words sub-line)
- `425-436` | "twenty".."ninety" | number-word tens (TENS array, rendered in words sub-line)
- `449-463` | "hundred" / "thousand" / "million" | number-word scale words (numToWords)

### front-end/islands/OnboardingProgress.tsx
- `162` | "🎉 You're set — let's draft your first quote!" | done message
- `164` | "Quick setup — 4 fast questions and you're in." | step 0 message
- `166` | "Nice. Just a few more." | step 1 message
- `168` | "Halfway." | step 2 message
- `170` | "One left." | step 3 message
- `171` | "Last bit." | fallback message
- `192` | "✓" | done badge glyph
- `192` | "👋" | wave badge glyph
- `203` | "Setup complete" | strong label (done)
- `203` | "Quick setup" | strong label (in-progress)
- `226` | "Onboarding progress" | progressbar aria-label
- `262` | "Yes — sounds right" | quick-reply button (step 2)
- `269` | "Different state" | quick-reply button (step 2)
- `279` | "Skip" | quick-reply button (step 3)
- `287` | "Skip setup · do this later" | skip-setup button

### front-end/islands/PaymentsPage.tsx
- `57-67` | "Cash" / "Check" / "ACH" / "Card" / "Venmo" / "Zelle" / "Cash App" / "PayPal" / "Other" | METHOD_LABEL method labels
- `297` | "Couldn't load payments: " | error state
- `366` | "Needs attention" | track title
- `369` | "payment" | track unit
- `380` | "Just landed" | track title
- `386-388` | "No payments logged yet — once a customer pays an invoice it lands here automatically." | empty state
- `412` | "In transit" | track title
- `453` | "Payments · " | hero eyebrow (prefix to month name)
- `465-467` | "let's change that" | hero title (fresh, em)
- `464,468` | "Nothing's landed yet —" / "." | hero title (fresh)
- `476` | "showed up this month." | hero title tail
- `483-486` | "Once a customer pays an invoice, it lands here. Each method gets its own clearing window — ACH in two days, checks in a week, cards and cash instantly." | hero sub (fresh)
- `494` | "Plus" | hero sub (transit, prefix)
- `495` | "on the way" | hero sub (transit)
- `497` | "Every dollar logged." | hero sub
- `501-502` | "that need a quick text to unstick" | hero sub (attention)
- `501` | "and" | hero sub connector
- `507` | ". The monsters logged every dollar." | hero sub
- `519` | "Record a payment" | hero CTA button
- `516` | "Record a payment I just received." | hero CTA seed (sent to assistant — user-facing in URL/chat)
- `527` | "Export this month" | hero ghost button
- `524` | "Export this month's payments as a CSV." | hero ghost seed (sent to assistant)
- `552` | "Landed" | stub tag
- `585` | "Landed this month" | KPI label
- `588` | "payment" / "payments" | KPI sub count
- `592` | "In transit" | KPI label
- `594` | "on the way" | KPI sub (count prefix)
- `597` | "Needs attention" | KPI label
- `599` | "held up" | KPI sub (amount suffix)
- `602` | "Avg days to pay" | KPI label
- `603` | "—" | KPI value placeholder
- `605` | "across landed payments" | KPI sub
- `605` | "no paid history yet" | KPI sub
- `631` | "Landed" | status mood label
- `631` | "View receipt" | status mood CTA
- `639` | "In transit" | status mood label
- `639` | "View timeline" | status mood CTA
- `645` | "Attention" | status mood label
- `645` | "Text client" | status mood CTA
- `715` | "Payment trail" | card back eyebrow
- `727` | "Receipt" | card back footer button
- `730` | "Match invoice" | card back footer button
- `733` | "Text client" | card back footer button
- `692` | "Expected" | card value label (transit)
- `692` | "Method" | card value label
- `772` | "Cash-flow shape" | side card title (empty)
- `774` | "Last 12 weeks · nothing yet" | side card sub (empty)
- `777` | "Nothing's landed yet — once payments roll in, the shape lights up." | side card empty body
- `796` | "Cash-flow shape" | side card title
- `798` | "Last 12 weeks · " / " this week" | side card sub
- `827` | "Feb" | chart axis label
- `828` | "Mar" | chart axis label
- `829` | "Apr" | chart axis label
- `844` | "Top payors this month" | side card title
- `846` | "Who actually showed up with money" | side card sub
- `851` | "No paid history yet." | side card empty
- `909` | "How they paid" | side card title
- `911` | "Method mix this month" | side card sub
- `916` | "Nothing landed yet this month." | side card empty
- `962` | "Monster tip" | side tip title
- `965` | "Zelle and Cash App" | side tip body (strong)
- `966` | "land instantly with no fees — a check can take" | side tip body
- `967` | "up to 5 days" | side tip body (strong)
- `968-969` | "to clear. For deposits, confirm the money's actually in your account before you start the job." | side tip body
- `447` | "long" | month-name format token (toLocaleString option — borderline; produces user-visible month name)
- `189-218` | noteFor() generated payment notes | card story text (see below)
- `199` | "'s ACH transfer is in flight. Standard 2-day settlement." | payment note (transit ach)
- `202` | "Check from " / " is in the mail / clearing. Most clear within a week." | payment note (transit check)
- `207` | "'s auto-pay cleared cleanly. Already in the account." | payment note (ach)
- `210` | "Captured on " / "'s card — funds settle in 2 days." | payment note (card)
- `212` | "Check from " / ", deposited via mobile." | payment note (check)
- `214-216` | "Cash from " / ", logged from the truck." / " — logged." | payment note (cash)
- `217` | "Payment from " | payment note (default)
- `183-187` | "Today" / "Yesterday" / "d ago" | whenLabel relative-time labels
- `179` | "—" | initialsOf empty fallback (shown in avatars)

### front-end/islands/PhoneChat.tsx
Note: takes EN/ES copy via props (`script`/`scriptEs` etc.) — most display text comes from the parent. Hardcoded literals inside this island:
- `58` | "PDF" | quote card head badge
- `86,101` | "Message" | default messageCopy prop (input field text, en)
- `87,101` | "Mensaje" | default messageCopyEs prop (input field text, es)
- `219` | "▶ Play" | story-mode control button
- `226` | "⟲ Reset" | story-mode control button
- `233` | "⏭ End state" | story-mode control button
- `257` | "Paperwork Monster" | chat header name
- `258` | "En línea" | chat header status (es)
- `258` | "Online" | chat header status (en)
- `64,68,72` | "$ 4,200" / "$ 3,990" / "$ 2,800" | quote card row amounts (hardcoded display)
- `74` | "$ 10,990" | quote card total amount (hardcoded display)
- `244` | "9:41" | phone status-bar time

### front-end/islands/PublicAcceptQuote.tsx
- `28` | "Esta cotización ya fue aceptada." | error (es)
- `28` | "This quote has already been accepted." | error (en)
- `28` | "Esta cotización ya fue rechazada." | error (es)
- `28` | "This quote has already been declined." | error (en)
- `42` | "Algo salió mal — inténtalo de nuevo." | generic error (es)
- `43` | "Something went wrong — please try again." | generic error (en)
- `97` | "✓ Cotización aceptada" | success heading (es)
- `97` | "✓ Quote accepted" | success heading (en)
- `103` | "{who} se pondrá en contacto para agendar." | success sub (es, with name)
- `104` | "{who} will be in touch to schedule." | success sub (en, with name)
- `105` | "Tu contratista se pondrá en contacto para agendar." | success sub (es)
- `106` | "Your contractor will be in touch to schedule." | success sub (en)
- `120` | "Escribe tu nombre completo para firmar" | name field label (es)
- `121` | "Type your full name to sign" | name field label (en)
- `130` | "Jane Doe" | name input placeholder
- `139` | "Escribe tu nombre arriba para activar el botón de aceptar." | hint (es)
- `140` | "Type your name above to enable the Accept button." | hint (en)
- `146` | "No se pudo aceptar — " | error prefix (es)
- `146` | "Couldn't accept — " | error prefix (en)
- `160` | "Aceptando…" | submit loading (es)
- `160` | "Accepting…" | submit loading (en)
- `161` | "Aceptar esta cotización →" | submit button (es)
- `161` | "Accept this quote →" | submit button (en)

### front-end/islands/PublicChangeOrderActions.tsx
- `37` | "Couldn't submit ({status})" | fetch error
- `61` | "Approved" | status label
- `61` | "Declined" | status label
- `67` | "Thanks! Your updated invoice total reflects this change." | approved message
- `68` | "No problem — we've let your contractor know." | declined message
- `82` | "Approving…" | approve button loading
- `82` | "Approve this change" | approve button
- `90` | "…" | decline button loading
- `90` | "Decline" | decline button

### front-end/islands/PublicContractView.tsx
- `22` | "This contract link expired or was revoked." | error message (LINK_GONE)
- `52` | "Contract not available." | error fallback message

### front-end/islands/PublicInvoiceClaim.tsx
- `57-58` | "Contacta a tu contratista para coordinar el pago. Cuando confirme la recepción, recibirás un recibo por mensaje y correo." | no-methods fallback (es)
- `58-59` | "Reach out to your contractor to coordinate payment. Once they confirm receipt, you'll get a receipt by text + email." | no-methods fallback (en)
- `73` | "¡Gracias!" | thanks heading (es)
- `73` | "Thanks!" | thanks heading (en)
- `78-79` | "Le avisamos a tu contratista. Confirmará cuando llegue el dinero — y te enviaremos un recibo." | thanks body (es)
- `79-80` | "We let your contractor know. They'll confirm when funds land — we'll text you a receipt then." | thanks body (en)
- `107` | "Couldn't submit ({status})" | fetch error
- `122` | "¿Cómo quieres pagar?" | section label (es)
- `122` | "How would you like to pay?" | section label (en)
- `166` | "Referencia (opcional)" | reference field label (es)
- `166` | "Reference (optional)" | reference field label (en)
- `182` | "Tu nombre (opcional)" | name field label (es)
- `182` | "Your name (optional)" | name field label (en)
- `188` | "Tu nombre" | name input placeholder (es)
- `188` | "Your name" | name input placeholder (en)
- `211` | "Enviando…" | submit loading (es)
- `211` | "Sending…" | submit loading (en)
- `212` | "Ya lo envié" | submit button (es)
- `212` | "I sent it" | submit button (en)
- `223` | "Cheque" | method label (es)
- `223` | "Check" | method label (en)
- `225` | "Venmo" | method label
- `227` | "Zelle" | method label
- `229` | "Cash App" | method label
- `231` | "PayPal" | method label
- `233` | "Efectivo" | method label (es)
- `233` | "Cash" | method label (en)
- `235` | "Transferencia bancaria" | method label (es)
- `235` | "Bank transfer" | method label (en)
- `237` | "Otro" | method label (es)
- `237` | "Other" | method label (en)
- `247` | "Envía a {handle} por {svc}." | method instructions (es)
- `248` | "Send to {handle} on {svc}." | method instructions (en)
- `250` | "Envía el pago por {svc} a tu contratista." | method instructions (es)
- `251` | "Send the payment via {svc} to your contractor." | method instructions (en)
- `256` | "Haz el cheque y envíalo a: {handle}" | check instructions (es)
- `257` | "Make it out and mail to: {handle}" | check instructions (en)
- `259` | "Envía el cheque por correo a tu contratista." | check instructions (es)
- `260` | "Mail the check to your contractor." | check instructions (en)
- `271-272` | "Entrega el efectivo a tu contratista en el sitio. Avisa aquí cuando lo hagas para que quede registro." | cash instructions (es)
- `272-273` | "Hand the cash to your contractor on-site. Reply here once it's done so they have a record." | cash instructions (en)
- `274-275` | "Pide a tu contratista los datos de ruta y cuenta ACH, luego haz la transferencia desde tu banco." | ach instructions (es)
- `276` | "Ask your contractor for ACH routing + account details, then submit the transfer from your bank." | ach instructions (en)
- `281` | "Coordina directamente con tu contratista." | other instructions (es)
- `282` | "Coordinate with your contractor directly." | other instructions (en)
- `285` | "Coordina con tu contratista." | default instructions (es)
- `286` | "Coordinate with your contractor." | default instructions (en)
- `294` | "Check #1234" | reference placeholder (check)
- `296` | "Transaction note (e.g. 'paid 5/12')" | reference placeholder (venmo)
- `298` | "Transaction ID or note" | reference placeholder (zelle)
- `300` | "Transaction ID or note" | reference placeholder (cashapp)
- `302` | "Transaction ID or note" | reference placeholder (paypal)
- `304` | "When you'll bring it (e.g. 'Friday at 3pm')" | reference placeholder (cash)
- `306` | "Transfer reference" | reference placeholder (ach)
- `308` | "Details" | reference placeholder (other)

### front-end/islands/PublicQuoteActions.tsx
- `21` | "Precio" | reason chip (es)
- `21` | "Price" | reason chip (en)
- `22` | "Tiempos" | reason chip (es)
- `22` | "Timing" | reason chip (en)
- `24` | "Elegí otra opción" | reason chip (es)
- `24` | "Going elsewhere" | reason chip (en)
- `26` | "Otro" | reason chip (es)
- `26` | "Other" | reason chip (en)
- `34` | "Esta cotización ya fue aceptada." | error (es)
- `35` | "This quote has already been accepted." | error (en)
- `38` | "Esta cotización ya fue rechazada." | error (es)
- `39` | "This quote has already been declined." | error (en)
- `52` | "Algo salió mal — inténtalo de nuevo." | generic error (es)
- `53` | "Something went wrong — please try again." | generic error (en)
- `100` | "Hacer una pregunta" | ask button (es)
- `100` | "Ask a question" | ask button (en)
- `108` | "Rechazar" | decline button (es)
- `108` | "Decline" | decline button (en)
- `139-140` | "Entendido — gracias por avisar" | declined card heading (es)
- `141` | "Got it — thanks for letting them know" | declined card heading (en)
- `144` | "Tu contratista fue notificado." | declined card sub (es)
- `145` | "Your contractor has been notified." | declined card sub (en)
- `209` | "Rechazar esta cotización" | decline form title (es)
- `209` | "Decline this quote" | decline form title (en)
- `214` | "Close decline form" | close button aria-label
- `220` | "×" | close button glyph
- `221` | "Motivo rápido (opcional):" | decline reason prompt (es)
- `221` | "Quick reason (optional):" | decline reason prompt (en)
- `245` | "¿Algo que quieras compartir? (opcional)" | note label (es)
- `246` | "Anything to share? (optional)" | note label (en)
- `253-254` | "Estoy viendo varias opciones, el presupuesto fue menor de lo esperado, etc." | note textarea placeholder (es)
- `254` | "Looking at a few options, the budget came in lower than expected, etc." | note textarea placeholder (en)
- `258` | "Tu nombre (opcional)" | name label (es)
- `258` | "Your name (optional)" | name label (en)
- `265` | "Jane Doe" | name input placeholder
- `270` | "No se pudo enviar — " | error prefix (es)
- `270` | "Couldn't send — " | error prefix (en)
- `283` | "Enviando…" | submit loading (es)
- `283` | "Sending…" | submit loading (en)
- `284` | "Enviar rechazo" | submit button (es)
- `284` | "Send decline" | submit button (en)
- `351` | "Hacer una pregunta" | ask form title (es)
- `351` | "Ask a question" | ask form title (en)
- `357` | "Close question form" | close button aria-label
- `360` | "×" | close button glyph
- `363` | "Tu pregunta" | question label (es)
- `363` | "Your question" | question label (en)
- `371-372` | "¿Cuál es el plazo si firmo el viernes?" | question textarea placeholder (es)
- `372` | "What's the timeline if I sign by Friday?" | question textarea placeholder (en)
- `377-378` | "¿Cómo te contactan? (opcional)" | contact label (es)
- `378` | "How can they reach you? (optional)" | contact label (en)
- `384` | "Teléfono o correo" | contact input placeholder (es)
- `384` | "Phone or email" | contact input placeholder (en)
- `387` | "Tu nombre (opcional)" | name label (es)
- `387` | "Your name (optional)" | name label (en)
- `394` | "Jane Doe" | name input placeholder
- `400` | "No se pudo enviar — " | error prefix (es)
- `400` | "Couldn't send — " | error prefix (en)
- `333` | "✓ Pregunta enviada" | success heading (es)
- `333` | "✓ Question sent" | success heading (en)
- `338` | "Tu contratista te responderá directamente." | success sub (es)
- `339` | "Your contractor will follow up directly." | success sub (en)
- `414` | "Enviando…" | submit loading (es)
- `414` | "Sending…" | submit loading (en)
- `415` | "Enviar pregunta" | submit button (es)
- `415` | "Send question" | submit button (en)

### front-end/islands/PublicSignContract.tsx
- `222` | "Couldn't submit ({status})" / raw error | (fetch error fallback `${r.status}`) — borderline; surfaced via err line at 414
- `271` | "Signed and binding" | success heading
- `276-277` | "Please allow up to 2 minutes before checking your email inbox. Don't forget to check spam." | success sub
- `292` | "Your signature" | sign header eyebrow
- `319` | "Undo last stroke" | undo button aria-label
- `327` | "Undo" | undo button label
- `325` | "Clear signature" | clear button aria-label
- `345` | "Clear" | clear button label
- `369` | "✕" | signing-card baseline glyph (aria-hidden, decorative)
- `385` | "Draw your signature here" | pad placeholder heading
- `389` | "finger, stylus, or trackpad — whatever's handy" | pad placeholder sub
- `400` | "Type your full legal name" | name field label
- `406` | "Jane Doe" | name input placeholder
- `411-412` | "By drawing your signature and typing your name, you agree this is your legal e-signature on the contract above." | legal disclaimer
- `417` | "Couldn't sign — " | error prefix
- `440` | "Signing…" | submit loading
- `455` | "Looks good — sign the contract →" | submit button (enabled)
- `455` | "Draw + type your name to enable" | submit button (disabled)

### front-end/islands/QuoteCard.tsx
- `39` | "No notes yet — open the quote to leave one." | story fallback text
- `41` | "Finish + send" | CTA (draft stage)
- `43` | "Send the offer" | CTA (opened, 3+ opens)
- `45` | "Friendly nudge" | CTA (opened)
- `47` | "Trim & re-send" | CTA (cooling)
- `49` | "Win it back" | CTA (stale)
- `51` | "Set a reminder" | CTA (sent)
- `52` | "Open quote" | CTA (default)
- `106` | "Quote" | value label
- `121` | "Close" | back-close aria-label
- `124` | "The open story" | back eyebrow
- `128` | "open" / "opens" | back-big small label
- `152` | "No opens recorded yet." | timeline empty state
- `162` | "Resend" | back footer button
- `165` | "Copy link" | back footer button
- `168` | "View as client" | back footer button

### front-end/islands/QuotesPage.tsx
- `45` | "Untitled quote" | quote title fallback (mapCard)
- `123` | "Couldn't load quotes: " | error state
- `184` | "Out for response" | track title
- `196` | "Drafting" | track title
- `208` | "Decided this month" | track title
Note: `"—"` fallbacks at lines 36/38/40/45 feed `initials`/`client`; the `"—"` rendered as client/initials is user-visible but is a data-fallback dash.

### front-end/islands/QuoteTrack.tsx
- `30` | "quote" | default unit (count label, e.g. "3 quotes")
- `61` | unit / `${unit}s` | count label suffix (rendered as "{count} {unit}(s)")

### front-end/islands/RedirectToast.tsx
- `9` | "We've consolidated messaging into the assistant." | redirect toast message (from=messages)

### front-end/islands/SettingsPage.tsx
Note: this island has its own inline `tr(es)` dictionary (NOT shared STRINGS) — every value below is user-facing display text.
- `45-46` | "Actualiza los datos de tu negocio abajo — se guardan al instante." | hero sub (es)
- `46` | "Update your business details below — changes save as you go." | hero sub (en)
- `47` | "Guardando…" | saving status (es)
- `47` | "Saving…" | saving status (en)
- `48` | "Guardado ✓" | saved status (es)
- `48` | "Saved ✓" | saved status (en)
- `49` | "no se pudo guardar" | save-failed (es)
- `49` | "save failed" | save-failed (en)
- `50` | "Aún no hay nada." | nothing-set empty (es)
- `50` | "Nothing set yet." | nothing-set empty (en)
- `52` | "Cuenta" / "Account" | card title
- `53` | "Identidad del negocio" / "Business identity" | card title
- `54` | "Dirección postal" / "Mailing address" | card title
- `55` | "Seguro" / "Insurance" | card title
- `56` | "Impuestos (W-9)" / "Tax (W-9)" | card title
- `57` | "Valores del contrato" / "Contract defaults" | card title
- `58` | "Cómo aceptas pagos" / "How you accept payment" | card title
- `59` | "Edita tus datos" / "Edit your details" | edit card title
- `61` | "Nombre" / "Name" | field label
- `62` | "Teléfono" / "Phone" | field label
- `63` | "Correo" / "Email" | field label
- `64` | "Idioma" / "Language" | field label
- `65` | "Español" / "Spanish" | language option
- `66` | "Inglés" / "English" | language option
- `67` | "Razón social" / "Legal name" | field label
- `68` | "Licencia" / "License" | field label
- `69` | "Nombre del negocio" / "Business name" | field label
- `71` | "Calle" / "Street" | field label
- `72` | "Ciudad" / "City" | field label
- `73` | "Estado" / "State" | field label
- `74` | "Código postal" / "ZIP / Postal" | field label
- `75` | "País" / "Country" | field label
- `77` | "Subir logo" / "Upload logo" | button
- `78` | "Reemplazar logo" / "Replace logo" | button
- `79` | "Subiendo…" / "Uploading…" | button loading
- `80` | "Logo cargado" / "Logo set" | status
- `81-83` | "PNG o JPG · aparece en cotizaciones y facturas" / "PNG or JPG · shows on quotes & invoices" | logo hint
- `85` | "Idioma de la app" / "App language" | field label
- `86-88` | "El idioma en que Paperwork Monster te muestra la app y el asistente." / "The language Paperwork Monster shows you — the app and assistant." | app-lang hint
- `90-92` | "Idiomas para enviar" / "Languages you send in" | field label
- `93-95` | "Marca los idiomas en que puedes enviar. En cada cotización podrás previsualizar y enviar en cualquiera de ellos." / "Check the languages you can send in. On each quote you can preview and send in any of them." | comms-lang hint
- `97` | "Aseguradora" / "Provider" | field label
- `98` | "Número de póliza" / "Policy number" | field label
- `99` | "Cobertura (USD)" / "Coverage (USD)" | field label
- `100` | "Vence" / "Expires" | field label
- `101` | "Subir certificado" / "Upload certificate" | button
- `102` | "Reemplazar certificado" / "Replace certificate" | button
- `103` | "Certificado en archivo" / "Certificate on file" | status
- `104-106` | "PDF o imagen · prueba de seguro / COI" / "PDF or image · proof of insurance / COI" | cert hint
- `108` | "TIN / EIN" | field label (both langs)
- `109` | "en archivo" / "on file" | tax masked status
- `110` | "Escribe para reemplazar" / "Enter to replace" | tax input hint
- `111` | "Subir W-9" / "Upload W-9" | button
- `112` | "Reemplazar W-9" / "Replace W-9" | button
- `113` | "Subido" / "Uploaded" | status
- `114-116` | "PDF o imagen · Formulario W-9 firmado" / "PDF or image · signed IRS Form W-9" | w9 hint
- `118` | "Plazo de pago" / "Payment terms" | field label
- `119` | "Anticipo" / "Deposit" | field label
- `120` | "Garantía" / "Warranty" | field label
- `121` | "días" / "days" | warranty unit
- `123-125` | "Activa las formas en que tus clientes pueden pagarte. Aparecen como botones en tus facturas." / "Turn on the ways customers can pay you. These show up as buttons on your invoices." | payments intro
- `126` | "Tu usuario" / "Your handle" | field label
- `127-129` | "Dirección postal (opcional)" / "Mailing address (optional)" | check mail-to label
- `130` | "Reescribe para confirmar" / "Retype to confirm" | confirm label
- `131-133` | "Las dos entradas no coinciden." / "The two entries don't match." | mismatch error
- `134` | "Guardar formas de pago" / "Save payment methods" | save button
- `135-138` | "Ingresa tu usuario de {m} (o desactívalo)." / "Enter your {m} handle (or turn it off)." | enter-handle error
- `139-142` | "Las entradas de {m} no coinciden — reescribe para confirmar." / "{m} entries don't match — retype to confirm." | handle-mismatch error
- `144` | "Zona de peligro" / "Danger zone" | card title
- `145-147` | "Esto borra tu cuenta y el 100% de tus datos — cotizaciones, facturas, clientes, pagos y archivos. No se puede deshacer." / "This deletes your account and 100% of your data — quotes, invoices, clients, payments, and files. This cannot be undone." | wipe intro
- `148-150` | 'Escribe "DELETE" para confirmar' / 'Type "DELETE" to confirm' | wipe confirm label
- `151` | "Borrar cuenta y todos los datos" / "Wipe account & all data" | wipe button
- `152` | "Borrando…" / "Wiping…" | wipe loading
- `153` | "no se pudo borrar" / "wipe failed" | wipe-failed error
- `158` | "Nothing set yet." | Card default empty prop (fallback when no `empty` passed)
- `202` | "Saving…" | EditPanel default `saving` prop
- `203` | "Saved ✓" | EditPanel default `savedLabel` prop
- `265,281,296` | "save failed" / "logo upload failed" | catch-fallback error (EditCard)
- `324` | "Edit name" | input aria-label
- `338` | "Edit email" | input aria-label
- `354` | "Edit business name" | input aria-label
- `361` | "Upload logo" | button aria-label
- `373` | "Logo file" | file input aria-label
- `398` | "English" | <option> (uses t.english)
- `399` | "Spanish" | <option> (uses t.spanish)
- `484,611,765` | "save failed" / "upload failed" | catch-fallback errors (Address/Insurance/Tax)
- `511` | "1234 Main St" | street input placeholder
- `535` | "TX" | state input placeholder
- `662` | "1000000" | coverage input placeholder
- `707` | "Insurance certificate file" | file input aria-label
- `791` | "12-3456789" | TIN input placeholder
- `815` | "W-9 file" | file input aria-label
- `842` | "Venmo" | PAY_ROWS label
- `842` | "@your-venmo" | venmo handle placeholder
- `845` | "Cash App" | PAY_ROWS label
- `847` | "$yourcashtag" | cashapp placeholder
- `851` | "Zelle" | PAY_ROWS label
- `853` | "email or phone" | zelle placeholder
- `857` | "PayPal" | PAY_ROWS label
- `859` | "paypal.me/you or email" | paypal placeholder
- `863` | "Check" | PAY_ROWS label
- `865` | "Mailing address for checks" | check placeholder
- `868` | "Cash" | PAY_ROWS label
- `959` | "save failed" | catch-fallback error (Payments)
- `1079` | "wipe failed" (via t.wipeFailed) / raw error | wipe catch fallback
- `1103` | "Type DELETE to confirm account wipe" | wipe input aria-label
- `1159` | "Couldn't load profile: " / "unknown error" | error state
- `1177` | "Your business" | hero title fallback
- `1227` | "Net " | payment-terms value prefix (e.g. "Net 30")
- `1103,1102` | "DELETE" | wipe input placeholder

### front-end/islands/Ticker.tsx
- (none)

### front-end/islands/Topbar.tsx
- `56` | "Paperwork Monster home" | brand link aria-label
- `67` | "👋" | greeting wave emoji (aria-hidden, decorative)
- `71` | "Search jobs, customers, invoices…" | search input placeholder
- `88` | "Notifications" / "Notifications, {n} unread" | bell button aria-label
Note: `greeting` text itself comes in via props (server-rendered), not hardcoded here.

### front-end/islands/WelcomeBackToast.tsx
[uses i18n STRINGS] — `langSignal` + `STRINGS[lang]["welcome.back"]` template.
- `60` | "amigo" | fallback first-name (es) injected into template
- `60` | "friend" | fallback first-name (en) injected into template
- `73` | "👋" | toast wave emoji (aria-hidden, decorative)

### front-end/islands/SetupChecklist.tsx
- `49` | "Your name" | checklist item label
- `55` | "Business name" | checklist item label
- `61` | "Email for notifications" | checklist item label
- `67` | "Upload your logo" | checklist item label
- `73` | "Mailing address" | checklist item label
- `79` | "How you accept payment" | checklist item label
- `85` | "Insurance (optional but helps)" | checklist item label
- `100` | "Finish setting up" | aria-label (section)
- `106` | "Setup checklist" | eyebrow
- `109-110` | "Finish setting up — {remaining.length} {thing/things} left" | heading
- `115` | "Hide checklist" | aria-label (hide button)
- `119` | "Hide" | hide button label
- `124` | "Setup completeness" | aria-label (progressbar)
- `146` | "✓" | done-check glyph

## 2. Frontend — Routes & shared components

> Note: most `routes/*/index.tsx` dashboard pages repeat the same greeting-date scaffolding — full **weekday names** ("Sunday"…"Saturday") and **month names** ("January"…"December") arrays, a `"there"` greeting-name fallback, and a `"<Page> · Paperwork Monster"` document title. These are listed per file but are duplicate copies of the same literals (a prime candidate for a shared helper).

### front-end/routes/_app.tsx
- `26` | "Paperwork Monster" | document title

### front-end/routes/assistant/[threadId].tsx
- `20` | "there" | greeting-name fallback
- `63` | "New conversation" | chat header title fallback
- `65` | "Phase: " | header status prefix (`Phase: ${...}`)
- `66` | "Tell Bossie about a job — voice or text" | header status fallback
- `113` | "Assistant · Paperwork Monster" | document title
- `120` | "My assistant · always on" | topbar greeting date
- `122` | "What can I take off your plate?" | topbar greeting override

### front-end/routes/assistant/index.tsx
- `19` | "there" | greeting-name fallback
- `88` | "Assistant · Paperwork Monster" | document title
- `98` | "My assistant · always on" | topbar greeting date
- `99` | "What can I take off your plate?" | topbar greeting override
- `107` | "New Conversation" | chat header title
- `108` | "Your PM Assistant is here to help!" | chat header status

### front-end/routes/c/[id].tsx
- (none)

### front-end/routes/clients/index.tsx
- `8-14` | "Sunday"…"Saturday" | weekday names (greeting date)
- `16-29` | "January"…"December" | month names (greeting date)
- `33` | "there" | greeting-name fallback
- `42` | "Clients · Paperwork Monster" | document title

### front-end/routes/co/[id].tsx
- `46` | "Change order · Paperwork Monster" | document title
- `57` | "Hmm, can't open this" | error-state heading
- `60` | "This change-order link expired or was revoked." | error-state message
- `75` | "Your contractor" | business-name fallback
- `80` | "Change order" | page heading
- `83-84` | "Your contractor proposed an adjustment to your invoice. Review it below and approve to update your total." | intro paragraph
- `93` | "What's changing" | section label
- `106` | "Current total" | amount-row label
- `113` | "Added" / "Credit" | delta-row label (positive / negative)
- `127` | "New total" | amount-row label

### front-end/routes/contracts/index.tsx
- `7-14` | "Sunday"…"Saturday" | weekday names (greeting date)
- `16-29` | "January"…"December" | month names (greeting date)
- `33` | "there" | greeting-name fallback
- `42` | "Contracts · Paperwork Monster" | document title

### front-end/routes/dashboard/index.tsx
- `9-16` | "Sunday"…"Saturday" | weekday names (greeting date)
- `18-31` | "January"…"December" | month names (greeting date)
- `35` | "there" | greeting-name fallback
- `44` | "Dashboard · Paperwork Monster" | document title

### front-end/routes/i/[id].tsx
[bilingual via local `es` flag — EN/ES literals inlined]
- `65` | "This invoice link expired or was revoked." | SSR error message
- `70` | "Invoice · Paperwork Monster" | document title
- `78` | "Invoice not available." | error-card fallback
- `92` | "Paperwork Monster" | error-card eyebrow
- `98` | "Hmm, can't open this" | error-card heading
- `113` | "Paperwork Monster" | business-label fallback
- `116` | "Project" | job-name fallback
- `179` | "Pagado" / "Paid" | amount-card label
- `180` | "Monto a pagar" / "Amount due" | amount-card label
- `186` | "Pagado" / "Paid" | paid-date prefix
- `187` | "Vence" / "Due" | due-date prefix
- `206` | "Pagado hasta ahora" / "Paid so far" | paid-strip label
- `255` | "¿Preguntas antes de pagar?" / "Questions before paying?" | footer prompt
- `260` | "Llama al" / "Call" | footer call label
- `271` | " o " / " or " | footer conjunction
- `276` | "escribe a" / "email" | footer email label
- `287-288` | "! Espero poder trabajar contigo." / "! I look forward to working with you." | footer closing
- `298` | alt="" | logo image (empty alt)
- `302-303` | "Powered by Paperwork Monster · Invoice #" | footer attribution
- `322` | "Pagado" / "Paid" | status pill
- `331` | "En confirmación" / "Awaiting confirmation" | status pill
- `340` | "Vencida" / "Past due" | status pill
- `348` | "Pendiente" / "Due" | status pill
- `373` | "tu contratista" / "your contractor" | who fallback
- `381` | "Le avisaste a ${who} que pagaste" / "You told ${who} you paid" | claimed-note heading
- `386` | "Método" / "Method" | claimed-note label
- `390` | "Referencia" / "Reference" | claimed-note label
- `397-398` | "Te enviaremos un recibo cuando ${who} confirme que el dinero llegó." / "We'll text you a receipt once ${who} confirms funds landed." | claimed-note body
- `411` | "Tu contratista" / "Your contractor" | who fallback
- `419` | "Pago recibido" / "Payment received" | received-note heading
- `425-430` | "¡Gracias! ${who} confirmó tu pago… recibo en PDF está en tu correo." / "Thanks! ${who} confirmed your payment… A PDF receipt is in your inbox." | received-note body
- `437` | "Factura 1 de 1" / "Invoice 1 of 1" | milestone title
- `438` | "Factura ${idx} de ${total}" / "Invoice ${idx} of ${total}" | milestone head
- `439` | "Anticipo" / "Deposit" | milestone suffix
- `440` | "Pago final" / "Final payment" | milestone suffix
- `441` | "Pago parcial" / "Progress payment" | milestone suffix
- `446-461` | "Check"/"Venmo"/"Zelle"/"Cash App"/"PayPal"/"Cash"/"ACH / bank transfer"/"Other" | payment-method friendly labels

### front-end/routes/index.tsx
[landing — SSR EN defaults + `data-en`/`data-es` rotor & marquee literals; live i18n via LandingScripts]
- `12` | "Kitchen remodel for the Hernández family. Cabinets, quartz counters, 3 days labor." | demo chat bubble (EN)
- `17` | "9:38 AM" | demo meta timestamp (EN)
- `23` | "Got it 👍 What zip code is the job in?" | demo chat bubble (EN)
- `29` | "And rough square footage of countertop?" | demo chat bubble (EN)
- `35` | "78704. About 42 sq ft of counter." | demo chat bubble (EN)
- `43` | "Perfect. Quote coming up — typical range for this is $10,800–$12,400." | demo chat bubble (EN)
- `49` | "Here's your quote, ready to send:" | demo chat bubble (EN)
- `57` | "Looks good. Send it to them." | demo chat bubble (EN)
- `59` | "9:41 AM ✓ Sent to client" | demo meta (EN)
- `67-68` | "Remodelación cocina para los Hernández. Gabinetes, cubierta de cuarzo, 3 días de mano de obra." | demo chat bubble (ES)
- `70` | "9:38" | demo meta timestamp (ES)
- `75` | "Listo 👍 ¿Cuál es el código postal del trabajo?" | demo chat bubble (ES)
- `81` | "¿Y aproximadamente cuántos pies² de cubierta?" | demo chat bubble (ES)
- `87` | "78704. Como 42 pies² de cubierta." | demo chat bubble (ES)
- `95` | "Perfecto. Va la cotización — rango típico $10.800–$12.400." | demo chat bubble (ES)
- `101` | "Aquí está tu cotización, lista para enviar:" | demo chat bubble (ES)
- `105` | "Se ve bien. Mándasela." | demo chat bubble (ES)
- `106` | "9:41 ✓ Enviado al cliente" | demo meta (ES)
- `110-114` | "Quote · #PM-2641" / "Cabinets & install" / "Quartz countertops" / "Demo & labor" / "Total" | demo quote copy (EN)
- `117-121` | "Cotización · #PM-2641" / "Gabinetes e instalación" / "Cubiertas de cuarzo" / "Demolición y mano de obra" / "Total" | demo quote copy (ES)
- `143` | "Paperwork Monster — You do the work. We handle the paperwork." | document title
- `147` | "Quotes, contracts, and invoices done right — built for contractors. No app to install. Just text us." | meta description
- `157` | alt="Paperwork Monster" | logo image
- `159` / `163` | "Paperwork" / "Monster" | brand text
- `167` | aria-label="Language" | lang toggle
- `169` | "I speak English" | lang button
- `171` | "Yo hablo Español" | lang button
- `175-177` | "What We Do" / "How It Works" / "Pricing" | nav links
- `182` | "Log in" | nav link
- `189` | "Get Started" | nav CTA
- `201` | "For pros" | hero kicker pill
- `204` | "Built for contractors who work with their hands" | hero kicker
- `209` / `211` | "You do the work." / "We handle the" | hero h1
- `216-227` | data-en/data-es rotor words: "quotes."/"cotizaciones.", "contracts."/"contratos.", "invoices."/"facturas.", "paperwork."/"papeleo." | hero rotor
- `235-236` | "Quotes, contracts, and invoices done right — so you get paid what your work is worth. No apps to learn. Just text us." | hero lead
- `246` | "Get Started →" | hero CTA1
- `254` | "See How It Works" | hero CTA2
- `260-263` | "MR" / "JG" / "CL" / "TS" | avatar initials
- `266` / `268` | "1,200+ contractors" / "getting paid faster" | hero trust
- `295` | "Quote sent" | hero badge chip
- `296` | "9:42 AM" | hero badge timestamp
- `307` | "RH" | badge avatar initials
- `308` | "R. Hernández" | badge name
- `309` | "Contract signed" | hero chip2
- `328` | "Quote" | doc mock tag
- `329` | "#PM-2641" | doc mock number
- `332` | "Kitchen remodel" | doc title
- `334` | "R. Hernández · Apr 26" | doc client
- `337-346` | "Cabinets"/"$4,200.00", "Counters"/"$3,990.00", "Labor (3 days)"/"$1,950.00" | doc line rows
- `349-350` | "Total" / "$10,990.00" | doc total
- `355` | "Signed ✓" | doc sign label
- `363` | "PM" | chat avatar
- `365` | "Paperwork Monster" | chat name
- `366` | "Online • SMS" | chat status
- `371-372` | "Kitchen remodel for the Hernández family. Cabinets, quartz counters, 3 days labor." | hero phone bubble
- `375` | "Got it. Pulling comps now…" | hero phone bubble
- `379-392` | "Cabinets"/"$4,200", "Counters"/"$3,990", "Labor"/"$1,950", "Total"/"$10,990" | hero phone rich rows
- `394` | "Send to client →" | hero phone rich CTA
- `397` | "Send it 👍" | hero phone bubble
- `401` | "Type a message…" | hero phone input placeholder
- `402` | "↑" | hero phone send glyph
- `425` | "30% average revenue increase|Professional quotes in minutes|Contracts with one tap|Invoices that track payments|No apps to download|Just text us" | marquee data-en
- `426` | "30% más ingresos en promedio|Cotizaciones pro en minutos|Contratos con un toque|Facturas que rastrean pagos|Sin apps que descargar|Solo escríbenos" | marquee data-es
- `437` | "The problem" | problem eyebrow
- `439-440` | "Good work deserves good paperwork" | problem h2
- `442-444` | "You know your trade. But chasing down quotes on scrap paper and guessing at prices is costing you real money." | problem lead
- `450-454` | "01" / "Leaving money on the table" / "Without solid pricing info, most contractors bid too low. That means less money in your pocket for the same hard work." | problem card 1
- `457-464` | "02" / "Paperwork that doesn't look right" / "Handwritten quotes on notebook paper don't build trust. Clients pick the contractor who looks like they have it together." | problem card 2
- `467-474` | "03" / "Hours you're not getting paid for" / "Every hour figuring out paperwork is an hour you could be on a job site earning real money." | problem card 3
- `485-486` | "One text. Three documents." | docs eyebrow
- `488-489` | "Quote, contract, invoice — handled." | docs h2
- `491-493` | "Send us a message. We send back a real document with real numbers — not a sketch on the back of an envelope." | docs lead
- `499-508` | "01"/"Quote", "02"/"Contract", "03"/"Invoice" | doc tab steps
- `515` | "Quote" | doc mockup title
- `517` | "#PM-2641" | doc mockup number
- `518` | "April 26, 2026" | doc mockup date
- `534-535` | "Documents sent so far" | docs counter label
- `537` | "0" | docs counter num
- `540-543` | "Quotes" / "Contracts" / "Invoices" / "Change orders" | docs counter types
- `553-554` | "What we do" | feat eyebrow
- `556-557` | "We take care of the business side" | feat h2
- `559-561` | "From the first quote to the final invoice — we handle it so you can stay on the job." | feat lead
- `588-592` | "Fair prices, not guesses" / "Real construction pricing data, adjusted for today's costs. Get a low, middle, and high range so you know exactly where you stand." | feature 1
- `614-617` | "Contracts that protect you" / "One tap turns your quote into a real contract. Protect your work and look professional to your clients." | feature 2
- `641-644` | "Simple invoicing" / "Job done? We turn it into an invoice. Keep track of who's paid and who hasn't — without a spreadsheet." | feature 3
- `665-668` | "Just text us" / "No fancy apps. No complicated software. Text us the job details and we do the rest. Simple as that." | feature 4
- `680-681` | "Straight to the point" | how eyebrow
- `683` | "How it works" | how h2
- `684-686` | "Three steps. No forms. No software. We meet you where you already are — your phone." | how lead
- `692-696` | "1" / "Tell us about the job" / "Send us a text with the job details. We'll ask you one question at a time — no long forms, no hassle." | how step 1
- `700-704` | "2" / "Check your quote" / "We put together a professional quote with fair pricing. Look it over, change what you need, and give us the thumbs up." | how step 2
- `708-712` | "3" / "Send it and get paid" / "Send the quote to your client. When the job's done, we turn it into a contract and invoice. Everything's in one place." | how step 3
- `723-724` | "See it in action" | demo eyebrow
- `726` | "Just text us. We handle the rest." | demo h2
- `727-729` | "Quotes, contracts, invoices — sent from your phone in seconds. No app to download. No software to learn." | demo lead
- `733` | "\"" | testimonial quote mark
- `734-738` | "I used to spend my Sundays writing quotes on notebook paper. Now I text these guys the job details from my truck and get a professional quote back in minutes. My close rate went through the roof." | demo quote
- `741` | "MR" | testimonial avatar
- `743` | "Mike R." | testimonial name
- `744-745` | "General Contractor · 12 years" | demo role
- `757-758` | "Message" / "Mensaje" | PhoneChat messageCopy / messageCopyEs props
- `768` | "Pricing" | price eyebrow
- `769-770` | "Pay us from what we make you" | price h2
- `772-775` | "Quotes, contracts, invoices, pricing, follow-ups — we run your back office so you can stay on the job site. And it pays for itself." | price lead
- `782-799` | "Without us"/"$5,000", "Your guess at price"/"$5,000", "Hours doing paperwork"/"~6 hrs", "Trust from clients"/"So-so", "You keep"/"$5,000" | price (without) column
- `821-838` | "With us"/"$6,500", "Real-data pricing"/"$6,500", "Our 10% fee"/"− $650", "Hours doing paperwork"/"0", "You keep"/"$5,850" | price (with) column
- `846-847` | "$850 more in your pocket." | price callout
- `849-851` | "A back office that pays for itself. Only charged when your client pays." | price callout sub
- `859` | "Start Making More →" | price CTA
- `871` | "Let's go" | cta eyebrow
- `872` | aria-label="Sign-in steps" | steps list
- `874-890` | "1"/"Phone", "2"/"Code", "3"/"You're in" | step dots/labels
- `894-895` | "Ready to get the paperwork off your plate?" | cta h2
- `897-899` | "Drop your number — we'll text you a 6-digit code. Login or sign up, same form." | cta lead
- `915` | "No setup fees, no contracts" | cta benefit 1
- `930-931` | "First quote on us — for new pros" | cta benefit 2
- `947` | "English & Spanish, every step" | cta benefit 3
- `955` | "Use" | saved-phone hint
- `957` | "(xxx) xxx-xxxx" | saved-phone placeholder
- `964` | "Not you?" | saved-phone dismiss
- `971` | "PM" | phone avatar
- `973` | "Paperwork Monster" | phone name
- `975` | "Online" | phone status
- `997` | "👋 Welcome to Paperwork Monster." | cf bubble
- `1001-1002` | "Paperwork Monster: Your code is 482-913. Don't share it." | SMS preview
- `1033` | "Delivered · Auto-fills on iOS" | cf meta
- `1038` | "+" | compose plus glyph
- `1044` | placeholder="Tap to enter your number" | phone input placeholder
- `1053` | aria-label="Send" | phone send button
- `1073` | "Send my code" | cta button
- `1095-1107` | "JG" / "CL" / "TS" | trust avatars
- `1111` | "34 contractors" / "signed up this week" | trust text
- `1115-1116` | "By submitting, you agree to receive a friendly text from us." | cta fine print
- `1127` | alt="" | footer logo (empty alt)
- `1128-1129` | "Paperwork" / "Monster" | footer brand
- `1132-1135` | "What We Do" / "How It Works" / "Pricing" / "Contact" | footer links
- `1137-1138` | "© 2026 Paperwork Monster. All rights reserved." | footer copy

### front-end/routes/invoices/index.tsx
- `7-14` | "Sunday"…"Saturday" | weekday names (greeting date)
- `16-29` | "January"…"December" | month names (greeting date)
- `33` | "there" | greeting-name fallback
- `42` | "Invoices · Paperwork Monster" | document title

### front-end/routes/login.tsx
[bilingual via local `es` flag]
- `29` | "Iniciar sesión" / "Log in" + " · Paperwork Monster" | document title
- `36` | alt="Paperwork Monster" | logo image
- `40-41` | "Paperwork" / "Monster" | brand text
- `44` | "Iniciar sesión" / "Welcome back" | heading
- `51-52` | "Entra con tu número de celular." / "Sign in with your phone number." | sub-text

### front-end/routes/messages/index.tsx
- (none)

### front-end/routes/payments/index.tsx
- `7-14` | "Sunday"…"Saturday" | weekday names (greeting date)
- `16-29` | "January"…"December" | month names (greeting date)
- `33` | "there" | greeting-name fallback
- `42` | "Payments · Paperwork Monster" | document title

### front-end/routes/q/[id].tsx
[bilingual via local `es` flag — EN/ES literals inlined]
- `44` | "This quote link expired or was revoked." | SSR error message
- `49` | "Quote" + " · Paperwork Monster" | document title
- `57` | "Quote not available." | error-card fallback
- `71` | "Your contractor" | brand headline fallback
- `87` | "powered by Paperwork Monster" | footer attribution
- `97` | "Hmm, can't open this" | error-card heading
- `125` | "Cotización" / "Quote" | quote eyebrow
- `137` | "Aceptada" / "Accepted" | status pill
- `143` | "Rechazada" / "Declined" | status pill
- `151-152` | "Hola ${first} — aquí está tu cotización." / "Hi ${first} — here's your quote." | greeting line
- `184-193` | "Este estimado cubre … líneas de trabajo desglosadas abajo." / "This estimate covers … lines of work broken down below." (incl. "una sola línea de trabajo" / "a single line of work") | job-details blurb
- `207` | "Partidas" / "Line items" | section label
- `213` | "Descripción" / "Description" | table header
- `217` | "Cant." / "Qty" | table header
- `221` | "Monto" / "Amount" | table header
- `250` | "Total estimado" / "Estimated total" | total label
- `267` | "¿Preguntas? Contacta a" / "Questions? Reach" | contact prompt
- `268` | "tu contratista" / "your contractor" | contractor-name fallback

### front-end/routes/s/[code].tsx
- `24` | "not found" | 404 plain-text body (unknown shortlink)

### front-end/routes/settings/index.tsx
- `7-14` | "Sunday"…"Saturday" | weekday names (greeting date)
- `16-29` | "January"…"December" | month names (greeting date)
- `33` | "there" | greeting-name fallback
- `42` | "Settings · Paperwork Monster" | document title

### front-end/routes/test.tsx
- `4` | "Hello from /test" | page body text (dev scratch route)

### front-end/routes/verify.tsx
[uses i18n STRINGS]
- `37` | "Paperwork Monster" | document title suffix (after `s["verify.h1"]`)
- `43` | alt="Paperwork Monster" | logo image
- `48-49` | "Paperwork" / "Monster" | brand text
- `51` | aria-label="Sign-in steps" | steps list
- `53` | "✓" | completed step dot glyph
- `59` | "2" | step dot
- `65` | "3" | step dot

### front-end/components/AppNav.tsx
- `19-25` | "Home" / "Assistant" / "Quotes" / "Contracts" / "Invoices" / "Customers" / "Settings" | nav item labels
- `39` | aria-label="Primary" | sidebar nav
- `64` | "Account" | profile name fallback

### front-end/components/AssistantSections.tsx
- `20` | aria-label="Play" | voice play button
- `50` | title="Back to dashboard" | chat header back link
- `62` | title="Share thread" | chat header button
- `65` | title="More" | chat header button
- `81` | "Client" | dealbar client label
- `85` | "Quote total" | dealbar total label
- `101` | "Quote" | dealbar phase 1 label
- `117` | "Terms" | dealbar phase 2 label
- `121` | "Send" | dealbar phase 3 label
- `125` | "Back to chat" | dealbar button
- `138` | "Today · 8:42 AM · Phase 1 — Chat" | chat day divider
- `141`,`174`,`256` | "DR" | message avatar initials
- `144` | "8:42 AM · transcribed" | message time
- `156-167` | "Got it — Tom & Linda K., 2-car garage epoxy floor. Heard you say \"standard prep, gray base with flakes, two-car about 480 sqft.\" Couple quick checks before I draft:" | assistant bubble
- `165` | "Concrete grinding included or just etch?" | list item
- `166` | "Polyurea topcoat or polyaspartic?" | list item
- `169`,`192`,`258` | "8:42 AM" / "8:43 AM" / "8:44 AM" | message times
- `177-179` | "Grind. Polyaspartic. Here's the floor — couple oil stains in the back corner, factor that in." | user bubble
- `203-205` | "On it. Pulled your \"Garage Epoxy — Premium\" template, swapped in the polyaspartic line, and added 1.5 hr extra prep for the oil staining. Quote ready to look at." | assistant bubble
- `213` | "Quote #Q-2026-041" | action-card title
- `215` | "Tom & Linda K. · 2-car garage · ~480 sqft" | action-card sub
- `217` | "Draft" | action-card chip
- `222-235` | "Surface prep + grind"/"$840", "Polyaspartic system (3-coat)"/"$1,680", "Color flakes & sealing"/"$520", "Materials & mobilization"/"$360" | action-card rows
- `242-244` | "Total" / "$3,400" | action-card total
- `249` | "8:43 AM · 47 sec to draft" | message time
- `257` | "Looks good. Lock it in." | user bubble
- `268-271` | "Locked at $3,400. Want to wrap the contract terms now? Should take about 90 seconds — mostly clicks." | assistant bubble
- `277` | "Continue to terms" | continue-cta title
- `278-281` | "Payment, warranty, dispute, governing state — a few quick questions" | continue-cta sub
- `284` | "Start" | continue-cta button
- `296` | "Phase 2 — Contract terms" | phase divider label
- `312` | "Contract terms" | wizard head title
- `313-315` | "Tap an answer · last button is always Custom" | wizard head sub
- `319`,`333` | "Standard residential" | wizard config value
- `321` | title="Show all on one page" | wizard mode button
- `326` | "All-on-one" | wizard mode button label
- `331`,`336`,`341`,`346` | "✓" | wiz chip check glyph
- `332` | "Config:" | wiz chip label
- `337` | "Customer:" | wiz chip label
- `338` | "Tom & Linda K." | wiz chip value
- `342` | "Start:" | wiz chip label
- `343` | "Mon May 4" | wiz chip value
- `347` | "Wraps:" | wiz chip label
- `348` | "2 days · May 5" | wiz chip value
- `353` | "Step 5 of 10 · Payment terms" | wizard step num
- `354` | "When do you want to get paid?" | wizard step question
- `357-368` | "Payment upon completion"/"Same-day payment", "50/50"/"Half upfront, half when done", "30/30/40"/"Start, halfway, done", "Deposit + balance"/"Small upfront, rest when done" | wizard options
- `375-376` | "Custom" / "Set your own terms" | wizard custom option
- `382` | "Up next:" | wiz rest label
- `385-397` | "6"/"Warranty", "7"/"Termination", "8"/"Dispute", "9"/"Governing state", "10"/"State notices" | wiz pills
- `401` | "4 of 10 done" | wiz foot count
- `406` | "Finalize & send" | wiz finalize button
- `410` | "8:44 AM · autosaving as you tap" | message time
- `422` | "Or just type:" | suggestions label
- `425` | "\"Net 30 instead\"" | suggestion chip
- `428` | "Re-open the quote" | suggestion chip
- `431` | "Use last contract" | suggestion chip

### front-end/components/Button.tsx
- (none)

### front-end/components/ClientsSections.tsx
- `25` | "Clients · ${totalClients} on the books" → "on the books" | crumb text
- `30-32` | "Let's add your first client. They'll keep the lights on." | empty-state title
- `33-36` | "Once a quote ships through the assistant, the customer lands here automatically." | empty-state sub
- `42-46` | "The {numberWord} {person/people} who keep the lights on." | hero title
- `50` | "job"/"jobs" + "in flight" | active-jobs hero sub
- `52` | "currently owed to you" | hero sub
- `53` | "quiet" | hero sub
- `54` | "client"/"clients" + "worth a hello." | quiet hero sub
- `60` | "Add a client" | CTA button
- `73-74` | "Today's loop" | loopbar label
- `76-78` | "No check-ins drafted yet — the assistant will surface them as work piles up." | loopbar empty heading
- `82` | "Open the assistant" | loopbar CTA
- `90-91` | "Today's loop" | loopbar label
- `94-96` | "{n} friendly check-{in/ins}, drafted for you." | loopbar heading
- `111` | "~{n} seconds" / "to send" | loopbar avatar meta
- `112` | "it" / "all {numberWord}" | loopbar send-count text
- `116` | "Open the loop" | loopbar CTA
- `131-132` | "Top of the leaderboard" / "last 12 mo" | top-clients title (empty)
- `134` | "No paid invoices in the last year yet." | top-clients empty
- `141-142` | "Top of the leaderboard" / "last 12 mo" | top-clients title
- `163-164` | "Who's on your books" / "No clients yet." | segments (empty)
- `180` | "Who's on your books" | segments title
- `188-192` | "Property mgmt" / "Homeowners" / "Small biz" / "HOAs" / "Unsorted" | segment plural labels

### front-end/components/contract-doc.tsx
[bilingual via local `es` flag + a `cstr` string table — most copy localized; below are still-hardcoded or EN-only spots, plus the inlined table itself]
- `327` | "Paperwork Monster" | error-card eyebrow
- `330` | "Hmm, can't open this" | error-card heading
- `350` | "Paperwork Monster" | business-label fallback
- `356` | "Service Agreement" | job-summary fallback
- `533` | "Description" | line-items table header (EN only, not localized)
- `539` | "Qty" | line-items table header (EN only)
- `545` | "Amount" | line-items table header (EN only)
- `563` | "ea" | line-item unit fallback (EN only)
- `857` | alt="" | logo image (empty alt)
- `940` | "—" | party-card name fallback
- `986` | "PM" | initials fallback
- `143-318` (cstr table) | full bilingual UI string table inlined in-file: docTag "Quote & Agreement"/"Cotización y Acuerdo", "Signed"/"Firmado", "Declined"/"Rechazado", "Awaiting your signature"/"Esperando tu firma", "Between"/"Entre", "and"/"y", "effective"/"vigente", "To"/"Para", "From"/"De", "Job details"/"Detalles del trabajo", "Agreement value"/"Valor del acuerdo", "all in, no surprises"/"todo incluido, sin sorpresas", "Payment schedule"/"Calendario de pagos", "Terms"/"Términos", "Start"/"Inicio", "Estimated completion"/"Finalización estimada", "Estimated"/"Estimado", "Sign here"/"Firma aquí", "Both signatures captured."/"Ambas firmas capturadas.", bySigning sentence, "Contractor"/"Contratista", "By:"/"Por:", "Date:"/"Fecha:", "today"/"hoy", "Your signature"/"Tu firma", "Sign & type name below ↓"/"Firma y escribe tu nombre abajo ↓", "Client Signature"/"Firma del cliente", "{n} Signature"/"Firma de {n}", "Signed and binding"/"Firmado y vinculante", signedNote, "Questions before signing?"/"¿Preguntas antes de firmar?", "Call"/"Llama al", " or "/" o ", "email"/"escribe a", lookForward, poweredBy ("Powered by Paperwork Monster · Agreement"/"Hecho con Paperwork Monster · Acuerdo"), termLabels (Customer/Cliente, Start date/Fecha de inicio, Time to complete/Duración, Payment terms/Plazo de pago, Warranty/Garantía) | document UI strings
- `201-317` (clauses array) | 14 bilingual legal clause title+body pairs (Governing Law, Job Details, Payment Terms, Change Orders, Customer Responsibilities, Delays and Unforeseen Conditions, Warranty, Limitation of Liability, Right to Stop Work, Termination, Dispute Resolution, Permits and Compliance, Indemnification, Entire Agreement / ES equivalents) | contract legal text
- `1024-1031` | "Pago al finalizar"/"Depósito + saldo"/"Sin garantía"/"De inmediato"/"La próxima semana"/"El próximo mes" | term-value ES localization map
- `1046-1083` (expandTermValue) | "Estimated"/"Estimado", "{state} law"/"Leyes de {state}", "Whatever state the work is performed in"/"El estado donde se realice el trabajo", "Standard {state} construction-contract notices included"/"Avisos estándar… incluidos", "No state-specific notices included"/"Sin avisos…", "Notices to be reviewed before signing"/"Avisos a revisar antes de firmar" | expanded term-value sentences
- `1105-1112` (computeMilestones) | "Depósito"/"Deposit", "Saldo"/"Balance", "Intermedio"/"Midpoint", "Pago final"/"Final", "Antes de empezar"/"Before work starts", "Al finalizar"/"On completion", "A mitad del trabajo"/"At rough-in / midpoint" | milestone labels

### front-end/components/ContractsSections.tsx
- `36` | "Work in flight · " + "contract"/"contracts" | hero eyebrow
- `40-41` | "of work" / "you've already promised." | hero title
- `47-49` | "Nothing in flight yet — when contracts get signed they'll show up here, with the next milestone watched." | hero sub (empty)
- `53-58` | "{n} {job/jobs} running today · {money} in deposits still to bill · {n} starting next week. The monsters are watching the next milestone on every one of them." | hero sub
- `67` | "Active value · " | hero active-value line
- `76` | "Schedule a job — I want to turn an accepted quote into a contract." | seed text (assistant prefill via URL)
- `79` | "Schedule a job" | hero CTA
- `110` | "In progress" | kpi label
- `112`,`119`,`128`,`135` | "job"/"jobs" | kpi pluralization
- `114` | "active" (`{money} active`) | kpi sub
- `117` | "Starting soon" | kpi label
- `122` | "· next 14 days" | kpi sub
- `126` | "Wrapping up" | kpi label
- `130` | "left to bill" (`{money} left to bill`) | kpi sub
- `133` | "Closed this month" | kpi label
- `137` | "· all paid" | kpi sub
- `151-155` | "WEEK 1"…"WEEK 5" | schedule week labels
- `215` | "The next 30 days" | schedule eyebrow
- `217-218` | "Everything you've committed to, on one strip." | schedule title
- `222-224` | "In progress" | schedule legend label
- `229-230` | "Scheduled" | schedule legend label
- `277-279` | "Nothing on the calendar yet. Sign a contract from the assistant and it'll show up here." | schedule empty

### front-end/components/DashSections.tsx
- `27` | "Nudge " + pluralize("overdue invoice") | hero CTA label
- `34` | "Review the " + pluralize("quote") + " pending" | hero CTA label
- `37` | "My assistant" | hero CTA label fallback
- `42` | "Let's get those quotes out the door." | hero title (fresh)
- `45-48` | "You've billed ${...} this month. Let's get those quotes out the door." | hero title
- `55-58` | "{quotes} {is/are} sitting with clients. Send a nudge, or fire off a fresh one straight from a text." | hero sub
- `63-65` | "No quotes out yet. Tell the assistant about a job and we'll draft one." | hero sub
- `72-73` | "{quotes} awaiting signature" | hero stat
- `119-120` | "No paid jobs yet" / "trailing year" | avg-job KPI fallback
- `137` | "Active jobs" | kpi label
- `139` | "on the books" | kpi sub
- `146` | "Outstanding" | kpi label
- `147` | pluralize("invoice") | kpi sub
- `149` | "{n} overdue" | kpi delta
- `156` | "Quotes pending" | kpi label
- `159` | "${...}k in flight" / `161` "—" | kpi sub + fallback
- `167` | "Avg. paid job" | kpi label
- `234-235` | "Active jobs" / "{count} active" | panel title + count
- `237` | "See all →" | panel action
- `243-244` | "No jobs in flight yet. As soon as a customer signs a quote, the job lands here." | empty-state
- `252` | "See pipeline →" | empty-state action
- `266` | "Due {due}" (`{task} · Due {due}`) | job meta
- `306` | "Quotes awaiting signature" | panel title
- `312` | "{n} out · ${total}" | panel count
- `316` | "See all →" | panel action
- `321` | "No quotes out yet. Draft one in the assistant." | empty-state
- `345` | "🔥" / "· cold" | quote sent status decorations
- `351` | "Nudge by text" | quote CTA button
- `353` | "View quote" | quote CTA button
- `388` | "Money owed to you" | money label
- `400` | "Nudge all" | money button
- `407` | "No invoices yet — once you bill a job, it'll show up here." | money empty
- `408` | "All paid up — nothing outstanding." | money empty
- `439` | "Current ${current}" | money legend
- `446` | "1–14 days $" | money legend
- `453` | "Overdue $" | money legend
- `502` | "What we handled today" | activity panel title
- `505-507` | "Nothing yet — your activity will land here." / "The monsters have been busy" | activity sub
- `509` | "Full log →" | activity action

### front-end/components/MessageBubble.tsx
- `5` | "You" | user avatar initial (sliced to "Y")
- `5` | "B" | assistant avatar initial

### front-end/components/QuotesSections.tsx
- `28` | "The pipeline this week" | hero eyebrow
- `34-35` | "Nothing in the pipeline yet." / "Draft your first quote in the assistant." | hero title (empty)
- `38-40` | "Quotes you send land here automatically — opens, replies, and stale flags are tracked for you." | hero sub (empty)
- `48-49` | "of work sitting with clients —" / "all of it warm." | hero title (all warm)
- `52-55` | "{open quotes} across {clients}. Nothing's gone cold yet — the monsters will flag it the moment something does." | hero sub (all warm)
- `62-65` | "of work sitting with clients, {quotes} that {needs/need} a nudge." | hero title
- `67-72` | "{open quotes} across {clients}. The monsters flagged {n} as cooling off — start there, then hit the hot ones while they're still warm." | hero sub
- `78` | "New quote" | hero CTA
- `115-117` | "Out for response" / "{n} quotes waiting" | kpi label + sub
- `119-121` | "Drafting" / "finish + send" | kpi label + sub
- `124-126` | "Decided this month" / "{won} won · {lost} lost" | kpi label + sub
- `129-131` | "Win rate (90d)" / "%" | kpi label + value suffix
- `135-140` | "Not enough data yet" / "{n} decided" / "{won} won · {lost} lost · need {n} more" | kpi sub
- `149` | "yesterday" / "{n}d ago" | decided-row when
- `179-180` | "Top of the pipeline" / "biggest open quotes" | qside title + sub
- `221-222` | "Win rate" / "last 90 days" | qside title + sub
- `261` | "{won} won · {lost} lost of {decided} decided" | qrate label
- `274` | "No quotes decided yet" | qrate label (empty)
- `276-278` | "{won} won · {lost} lost need {n} more to call it" | qrate label
- `290` | "Quotes opened 3+ times within 24 hours close 78% of the time when followed up the same day." | default Monster tip
- `298` | "Monster tip" | qside tip title

### front-end/components/Skeletons.tsx
- (none)

## 3. Frontend — `lib/` seed, display & format helpers

> These files hold demo/seed content (sample clients, quotes, jobs, activity) and display helpers (status labels, relative-time, money/phone formatting). Seed data renders verbatim in empty/demo states; the display helpers are the canonical English labels reused across the app.

### front-end/lib/asst-seed.ts
- `24`,`57`,`79` | "Today" / "Yesterday" / "This week" | thread group headings
- `28` | "Tom & Linda K." | seed client name
- `29-30` | "Garage epoxy floor — 2-car, includes prep, primer, and topcoat. Awaiting signature." | seed thread preview
- `32` | "8m" | relative-time label
- `33` | "Sent" | thread chip label
- `38` | "Marcus Lin" | seed client name
- `39-40` | "\"Need a quote for kitchen backsplash, ~30 sqft, white subway tile.\"" | seed thread preview
- `41` | "1h" | relative-time label
- `43` | "Drafted" | thread chip label
- `47` | "Hilltop Diner" | seed client name
- `48-49` | "Followed up on overdue invoice #INV-204 ($1,160) — payment promised by Friday." | seed thread preview
- `50` | "3h" | relative-time label
- `52` | "Nudged" | thread chip label
- `61` | "Sarah Chen" | seed client name
- `62-63` | "Bathroom remodel contract drafted and e-signed. Crew scheduled Wed." | seed thread preview
- `64`,`72` | "Mon" | relative-time label
- `66` | "Signed" | thread chip label
- `70` | "Greenleaf HOA" | seed client name
- `71` | "Common area paint quote — 4,200 sqft, two coats, eggshell." | seed thread preview
- `74`,`96` | "Sent" | thread chip label
- `83` | "Cobblestone Cafe" | seed client name
- `84-85` | "Patio re-tile invoice #INV-198 sent. $1,000 deposit received." | seed thread preview
- `86` | "Sun" | relative-time label
- `88` | "Paid" | thread chip label
- `92` | "Bayside Properties" | seed client name
- `93` | "4-unit gutter cleaning quote sent. Cold — 4 days no view." | seed thread preview
- `94` | "Sat" | relative-time label

### front-end/lib/dash-seed.ts
- `17-69` | seed job rows (client / task / amount / paid / due / status): "Maple Grove Apartments"/"Re-roof — building C"/"$4,800"/"$2,400 paid"/"Today"/"On track"; "Sarah Chen"/"Bathroom remodel"/"$8,200"/"$3,000 paid"/"Wed"/"Crew onsite"; "Marshall & Sons"/"Driveway repour"/"$2,950"/"Deposit"/"Fri"/"Awaiting permit"; "Jana Patel"/"Interior paint · 2BR"/"$1,650"/"Quoted"/"Mon Apr 29"/"Scheduled"; "Cobblestone Cafe"/"Patio re-tile"/"$3,400"/"$1,000 paid"/"Apr 30"/"On track" | seed jobs
- `75-100` | seed quote rows (client / desc / amt / sent label): "Tom & Linda K."/"Garage epoxy floor"/"$3,400"/"Sent Mon · Viewed twice"; "Greenleaf HOA"/"Common area paint"/"$5,800"/"Sent Tue · Viewed"; "Marcus Lin"/"Kitchen backsplash"/"$1,920"/"Sent today"; "Bayside Properties"/"4-unit gutter cleaning"/"$1,680"/"Sent 4 days ago" | seed quotes
- `107-125` | seed outstanding rows (client / meta / amount): "Hilltop Diner"/"11 days overdue · #INV-204"/"$1,160"; "Sarah Chen"/"Due in 3 days · #INV-208"/"$1,920"; "Maple Grove Apts."/"Due Apr 30 · #INV-210"/"$3,340" | seed outstanding
- `134-136` | "<strong>Tom & Linda K.</strong> opened your quote for the second time" | seed activity HTML
- `137` | "2 min ago" | activity relative-time
- `142-143` | "You texted us \"new job — paint kitchen for Marcus Lin\". <strong>Quote drafted.</strong>" | seed activity HTML
- `145` | "1 hr ago" | activity relative-time
- `150-151` | "<strong>Cobblestone Cafe</strong> paid invoice #INV-198 — $1,000 deposit" | seed activity HTML
- `153` | "3 hr ago" | activity relative-time
- `158` | "<strong>Sarah Chen</strong> e-signed the bathroom remodel contract" | seed activity HTML
- `160` | "Yesterday" | activity relative-time

### front-end/lib/clients-seed.ts
- `36-262` | 12 seed clients (name / last job / lastWhen / balanceSub / jobsSub), e.g. "Greenleaf HOA", "Maple Grove Apartments", "Cobblestone Cafe", "Marshall & Sons", "Sarah Chen", "Hilltop Diner", "Tom & Linda Kowalski", "Jana Patel", "Marcus Lin", "Bayside Properties", "Riverside Yoga", "Ortega Rentals" — each with phrases like "Common area paint", "quote viewed Tue", "in progress · today", "invoice 11 days late", "no active jobs", etc. | seed client roster
- `266-270` | "Active job" / "Lead" / "Owes you" / "Regular" / "Quiet" | client status labels
- `280-337` | per-client "story" lines + CTAs, e.g. "Eleven jobs since 2022. Margaret peeked at the new paint quote Tuesday — nudge gently, they always say yes by Thursday." → "Send a friendly nudge"; "Diego is on building C right now. Janet pays progress invoices the day she gets them — send the next one tonight." → "Draft progress invoice"; (… 10 more pairs incl. "Offer the split-pay", "Send the warm offer", "Win him back") | client story copy
- `365-389` | "All" / "Active jobs" / "Leads" / "Owe you" / "Regulars" / "Quiet" | filter labels
- `400-404` | top-client names + amounts: "Greenleaf HOA"/"$32,400", "Maple Grove Apartments"/"$24,800", "Ortega Rentals"/"$18,720", "Cobblestone Cafe"/"$15,920", "Marshall & Sons"/"$11,450" | top clients
- `415-418` | "Property mgmt" / "Homeowners" / "Small biz" / "HOAs" | segment labels
- `436-480` | "On the books" / "Owes you" / "Active job" / "New lead" / "Quiet" / "Regular" | mood/status labels

### front-end/lib/quotes-seed.ts
- `39-242` | 15 seed quotes (title / client): "Storefront awning replacement"/"Cobblestone Cafe", "Lobby refresh — paint + trim"/"Bayside Properties", "Garage epoxy floor — 2-car"/"Tom & Linda Kowalski", "Common-area paint — buildings A & B"/"Greenleaf HOA", "Kitchen backsplash — subway tile"/"Marcus Lin", "4-unit gutter cleaning"/"Bayside Properties", "Driveway repour — concrete"/"Marshall & Sons", "Deck stain & seal"/"Hilltop Diner", "Studio floor seal"/"Riverside Yoga", "Building C re-roof"/"Maple Grove Apartments", "Patio re-tile"/"Cobblestone Cafe", "Bathroom remodel"/"Sarah Chen", "Interior paint — 2BR"/"Jana Patel", "Window trim repaint"/"Ortega Rentals", "Office foyer refresh"/"Westgate Dental" | seed quotes
- `246-263` | per-quote "story" lines, e.g. "Cobblestone's spring sign refresh — you're still pricing material. Wrap it up tonight; Aisha asked for it Monday." (9 total) | quote story copy
- `267-273` | "Drafting" / "Just sent" / "Opened" / "Cooling" / "Stale" / "Won" / "Lost" | stage labels
- `336-342` | seed open-events (when / time / device): "Today"/"9:42am"/"iPhone", "Today"/"2:18pm"/"Mac", "Yesterday"/"4:12pm"/"iPhone", "Tue"/"11:30am"/"iPhone", "Mon"/"7:54pm"/"iPad", "Sun"/"10:08am"/"Mac", "Sat"/"8:21pm"/"iPhone" | seed open events
- `359-414` | "reading-copy" chunks by stage: "Not sent yet — finish writing, then ship it."; "Sent, but no opens yet. Could be in spam…"; "They're shopping — opened on multiple devices…"; "Three opens means real interest. Send the offer while it's hot."; "One peek and a pause. A friendly nudge usually breaks the silence."; "Opened a few times early, then went quiet. Worth a job-details trim and a re-send."; "Lots of attention, then gone cold. Last shot: win it back with a sharper offer."; "Just landed in their inbox. Give it 24 hours before you tap on the door."; "Quiet — try a nudge." | quote reading copy

### front-end/lib/clients-display.ts
- `24-28` | "Active job" / "New lead" / "Owes you" / "Regular" / "Quiet" | status labels
- `32-36` | "Property mgmt" / "Homeowner" / "Small biz" / "HOA" / "Unsorted" | segment labels
- `46-90` | "On the books" / "Owes you" / "Active job" / "New lead" / "Quiet" / "Regular" | mood/status labels
- `119` | "day ago" / "days ago" | relative-time unit
- `126` | "week ago" / "weeks ago" | relative-time unit
- `148` | "${dollars(...)} due" | balance display ("due")
- `153` | "${dollars(...)} credit" | balance display ("credit")
- `156` | "Settled" | balance display (zero)
- `168` | "Address on file" | address fallback (hoa)
- `170` | "${name} property — multiple units" | address fallback (property_mgmt)
- `171` | "${name} — main location" | address fallback (small_biz)
- `172` | "Address on file" | address fallback (default)
- `178` | "${dollars(...)} outstanding · ${balanceSub}." | story (balance owed)
- `181-184` | "${activeJobs} active job{s} · ${jobsSub}." | story (active)
- `185` | "New lead — last touch ${lastWhenRel}." | story (lead)
- `187-189` | "Quiet for ${days} day{s}. Worth a hello." | story (cold)
- `192` | "Regular client. Last activity ${lastWhenRel}." | story (regular)
- `194` | "Last activity ${lastWhenRel}." | story (default)
- `198-202` | "Send a kind reminder" / "Send progress update" / "Follow up" / "Send a hello" / "Open card" | CTAs
- `206-228` | "zero" … "twenty" | number-word list (small-count display)

### front-end/lib/format.ts
- `14` | "$0" | money fallback (invalid input)
- `23` | "${sign}$${dollars}" | formatted money (sign/number tokens)
- `27` | "—" | exact-money fallback (em dash)
- `41` | "${count} ${singular/plural}" | pluralized count label
- `55-57` | "(${area}) ${prefix}-${line}" | formatted US phone

### front-end/lib/contracts-shape.ts
- `12-18` | "IN PROGRESS" / "TIGHT" / "SCHEDULED" / "WRAPPING UP" / "COMPLETED" / "DRAFT" / "STALE" | contract status literals (rendered as status text)
- `145-150` | "IN PROGRESS" / "WRAPPING UP" / "SCHEDULED" / "COMPLETED" / "DRAFT" / "STALE" | status labels by mood
- `154`,`156` | "—" | initials fallback (em dash)
- `193` | "Untitled customer" | client-name fallback
- `196` | "Signed contract" | contract title fallback
- `221` | "—" | "when" label default (em dash)
- `225` | "Starts today" | schedule "when" label
- `227-228` | "Starts tomorrow" / "Starts in ${dd} days" | schedule "when" label
- `232` | "Day ${elapsed + 1} of ${total + 1}" | schedule "when" (active)
- `236` | "Wraps today" | schedule "when"
- `238-239` | "Wraps tomorrow" / "Wraps in ${dd} days" | schedule "when"
- `241` | "Closed" | schedule "when" (completed)
- `243` | "Draft" | schedule "when" (draft)
- `245` | "Stale draft" | schedule "when" (stale)
- `249-258` | "Send progress invoice" / "Confirm start time" / "Draft final invoice" / "View receipt" / "Finish + send" / "Re-engage" | CTAs
- `269` | "${name} signed and you're on the job. Next milestone keeps the train moving — send a quick update so they know." | story (active)
- `271` | "${name} signed — block calendar and confirm the start window. Deposit clears the day work begins." | story (starting-soon)
- `273` | "Final pass and the punch-list. Loop the last invoice with anything still owed so it's one tidy ask." | story (wrapping-up)
- `275` | "Closed and paid. Receipt sent automatically — kept here for the record." | story (completed)
- `277` | "Idle for over a month. A friendly check-in costs nothing and sometimes wins it back." | story (stale)
- `278` | "Draft contract — finish terms and send for signature." | story (draft/fallback)

### front-end/lib/payment-split.ts
- (none)

### front-end/lib/dash-cache.ts
- (none)

### front-end/lib/backend-fetch.ts
- (none)

### front-end/lib/api.ts
- (none)

## 4. Backend — Customer-facing comms (SMS / email / notifications / PDFs)

> The backend texts and emails both contractors and their customers, and renders PDFs (receipts, signed contracts). SMS/email/PDF copy is bilingual (EN/ES) but **inlined per-coordinator** — no shared key store. Large LLM system prompts are flagged, now reproduced verbatim in Part 6.

### backend/src/communication/domain/coordinators/notify-on-event/mod.ts
- `65` | "your client" | fallback customer name used in titles below
- `69` | "Quote sent to ${customerName}" | bell-notification title
- `72` | "${customerName} accepted your quote" | notification title
- `79` | "${customerName} declined your quote${reasonLabel}" | notification title (reasonLabel = " · {reason}")
- `84` | "${customerName} signed the contract" | notification title
- `93` | "${customerName} says they paid${via} — confirm you got it" | notification title (via = " by {method}")
- `98` | "${customerName} paid${amount ? ` ${amount}` : \"\"}" | notification title
- `101` | "Invoice for ${customerName} is overdue" | notification title
- `104` | "${customerName} replied" | notification title
- `110` | "${customerName} asked a question" | notification title

### backend/src/paperwork/domain/coordinators/send-paperwork-sms/mod.ts
- `276`,`301` | "your project" | fallback job name in SMS body
- `329` | "Hola ${p.hi}, soy ${p.who} de ${p.biz}." | SMS intro, ES
- `331-336` | "Hola ${p.hi}, soy ${p.who}." / "Hola ${p.hi}." / "Soy ${p.who} de ${p.biz}." / "Soy ${p.who}." | SMS intro variants, ES
- `340` | "Hi ${p.hi}, this is ${p.who} from ${p.biz}." | SMS intro, EN
- `342-347` | "Hi ${p.hi}, this is ${p.who}." / "Hi ${p.hi}." / "This is ${p.who} from ${p.biz}." / "This is ${p.who}." | SMS intro variants, EN
- `354` | "Tu Cotización + Acuerdo para ${p.jobName} está lista: ${p.url}" | SMS body, ES
- `357` | "Avísame si tienes alguna pregunta. ¡Espero poder trabajar contigo!" | SMS closing, ES
- `360` | "Your Quote + Agreement for ${p.jobName} is ready: ${p.url}" | SMS body, EN
- `361-362` | "Please let me know if you have any questions. I look forward to working with you!" | SMS closing, EN
- `383-385` | "${lead}your invoice is ready (${fmtUSD(i.amount)}). View & pay: ${url}${tail}" | invoice SMS body (lead = "Hi {first}, ", tail = " — {sender}")

### backend/src/paperwork/domain/coordinators/send-paperwork-email/mod.ts
- `458` | "Paperwork Monster" | subject business-name fallback
- `459` | "Customer" | subject customer-name fallback
- `460-461` | "Project" | subject job-name fallback
- `466` | "${businessName} Cotización para ${customerName}, ${jobName}" | quote email subject, ES
- `467` | "${businessName} Quote for ${customerName}, ${jobName}" | quote email subject, EN
- `297` | "your contractor" | sender-name fallback (footer "From")
- `301` | "Hi ${name}," / "Hi there," | shell() greeting + fallback
- `403` | "Drafted" | shell() header label
- `423` | "or paste this link into your browser:" | shell() CTA helper
- `429` | "From" | shell() footer eyebrow
- `505-533` (quote email `L` table, EN/ES) | "Cotización"/"Quote", "Creada"/"Drafted", "Preparada para"/"Prepared for", "por"/"by", introTail ("Lectura rápida…"/"Quick read…"), "Detalles del trabajo"/"Job details", "Esto es lo que haremos"/"Here's what we'll handle", "Total estimado"/"Estimated total", "todo incluido, sin sorpresas"/"all in, no surprises", "o pega este enlace…"/"or paste this link…", "Qué sigue"/"What happens next", "¿Preguntas? Escríbeme"/"Questions? Reach out", "Tu contratista"/"Your contractor", plus the 4-step "what happens next" timeline (ES: ["Aceptas","Toca el botón de arriba"]…; EN: ["You accept","Tap the button above"], ["Sign the agreement","Quick e-sign, takes a minute"], ["Pick a start day","We'll text to confirm"], ["Done & dusted","Receipt + warranty in your inbox"]) | quote email UI strings
- `543` | "¿Todo bien? Firma el acuerdo" / "Sound good? Sign the agreement" | CTA (contract bound)
- `545-546` | "¿Todo bien? Acepta esta cotización" / "Sound good? Accept this quote" | CTA (no contract)
- `560` | "Tu proyecto" / "Your project" | quote summary fallback hero
- `567` | "Para" / "For" | preheader "For {customerFirst}"
- `629` | "Hola ${customerFirst} 👋" / "Hi ${customerFirst} 👋" | quote email greeting
- `630` | "Hola 👋" / "Hi there 👋" | greeting fallback
- `636` | "preparó esto para ti." / "put this together for you." | intro line tail
- `638-639` | "Tu contratista preparó esto para ti." / "Your contractor put this together for you." | intro fallback
- `830-832` | "Sent because ${senderFirst ?? \"your contractor\"} drafted this for you" | footer line
- `851`,`853` | "Service Agreement" | synthesized quote summary + line-item desc (contract w/o quote)
- `869-870` | "Invoice #${i.id.slice(0,8)} — due ${fmtDate(...)}" / "${tail} from ${who}" | invoice email subject
- `883` | "Invoice details" | invoice email label
- `885`,`888`,`891` | "Issued" / "Due" / "Status" | invoice email row labels
- `892` | "pending" | invoice status fallback
- `898` | "Amount due" | invoice email amount-card label
- `909-911` | "Invoice ${docNumber} — ${fmtUSD(amount)} due ${fmtDate(...)}" | invoice email preheader
- `912` | "Invoice" | shell kind label / <title>
- `917` | "Thanks for the work — here's the invoice. Tap below to view and pay." | invoice email intro
- `919` | "View & pay invoice" | invoice email CTA

### backend/src/paperwork/domain/coordinators/send-payment-reminder/mod.ts
- `115` | "Paperwork Monster" | business-name fallback
- `216` | "Hi ${customerFirst}, " | reminder lead
- `217` | "your contractor" | sender-name fallback
- `220-221` | "quick check-in — your invoice from ${businessName} is still open." | Day-3 tone line
- `222` | "following up on your invoice from ${businessName} — let me know if there's anything I can help with." | Day-7 tone line
- `223` | "wanted to follow up personally on your invoice from ${businessName}. Best way to wrap this up?" | Day-14 tone line
- `227` | "Quick check-in: invoice from ${businessName}" | Day-3 email subject
- `229` | "Following up: invoice from ${businessName}" | Day-7 email subject
- `230` | "Personal note from ${sender}" | Day-14 email subject
- `234` | "${hi}${tone}" | reminder email body paragraph
- `235` | "Amount due:" + " ${amount}${ ` · Due ${dueDate}`}" | reminder amount line
- `236` | "Open invoice" | reminder email CTA
- `240` | "${hi}${tone} ${amount}${url ? ` — ${url}` : \"\"}${senderFirst ? ` — ${senderFirst}` : \"\"}" | reminder SMS body

### backend/src/paperwork/domain/coordinators/send-signed-confirmation/mod.ts
- `203-205` | "Signed: ${quote?.summary ?? \"your contract\"} — countersigned PDF + first invoice" | confirmation email subject
- `259` | "there" | SMS first-name fallback
- `261`,`419` | "your project" | SMS/email job-name fallback
- `266-267` | "Hola ${first}, tu Cotización + Acuerdo para ${jobName} está firmada — ¡todo listo! Te enviaremos una copia firmada y tu primera factura: ${APP_URL}/c/${contract.id}${fromBiz}" | completion SMS, ES
- `268-269` | "Hi ${first}, your Quote + Agreement for ${jobName} is signed — you're all set! A signed copy + your first invoice are on the way: ${APP_URL}/c/${contract.id}${fromBiz}" | completion SMS, EN
- `418` | "your contractor" | business-name fallback (email)
- `427` | "Hi ${customerFirst} —" / "Hi there —" | confirmation email greeting + fallback
- `429-431` | "Countersigned PDF attached · first invoice ${invoiceUrl ? \"ready to pay\" : \"coming soon\"}" | preheader
- `439` | "Signed ${docNumber}" | email <title>
- `451-453` | "✓ Signed · ${docNumber}" | status pill
- `457` | "It's official." | email hero headline
- `458-464` | "${biz} and ${customerFirst ?? \"you\"} are locked in on ${summary}." | subhead
- `470-478` | "Thanks for signing. Your countersigned contract is attached as a PDF for your records${ ` — and the first invoice (${fmtUSD(...)}) is ready below`}. ${contractorFirst ?? \"Your contractor\"} will reach out to lock in a start day." | body paragraph
- `488-489` | "First invoice" / "due in 7 days · pay online" | invoice-card eyebrow + subtext
- `501` | "Pay the first invoice  →" | invoice-card CTA
- `513` | "PDF" | attachment card icon label
- `516-518` | "Contract-${...}.pdf" | attachment filename
- `519` | "attached · signed by both parties" | attachment subtext
- `528` | "View the contract online →" | secondary link
- `534` | "From" | footer eyebrow

### backend/src/paperwork/domain/coordinators/confirm-payment/mod.ts
- `97` | "Receipt for invoice #${invoice.id.slice(0,8).toUpperCase()}" | receipt email subject
- `106` | "Receipt-${...}.pdf" | receipt attachment filename
- `123` | "Hi ${customerFirst}, " | receipt SMS lead
- `125` | "${lead}got your payment of ${fmtUSD(intent.amount)}. Receipt: ${shortUrl}${tail}" | receipt SMS body (tail = " — {sender}")
- `178` | "Paperwork Monster" | receipt business-label fallback
- `184` | "Thanks${customerFirst ? \", \" + customerFirst : \"\"} — we got it!" | receipt email headline
- `186-188` | "We've recorded your payment of ${fmtUSD(...)}${ ` (ref ${reference})`}. A PDF receipt is attached for your records." | receipt email body

### backend/src/paperwork/domain/coordinators/render-receipt-pdf/mod.ts
- `40`,`57` | "Contractor" | PDF author/label fallback
- `57` | "Paperwork Monster" | brand-eyebrow fallback (uppercased)
- `63` | "RECEIPT" | PDF eyebrow label
- `69` | "Confirmed ${formatDate(confirmedAt)}" | PDF date label
- `81` | "AMOUNT RECEIVED" | PDF amount-card label
- `99-100` | "INVOICE" / "CUSTOMER" | PDF column headers
- `103` | "—" | customer-name fallback on receipt
- `106` | "Installment ${invoice.installmentIndex} of ${invoice.installmentTotal}" | PDF installment line
- `117` | "Questions about this receipt?" | PDF footer prompt
- `126` | "Powered by Paperwork Monster" | PDF footer
- `136-143` | "CHECK" / "VENMO" / "ZELLE" / "CASH APP" / "PAYPAL" / "OTHER" / "CASH" / "ACH" | payment-method labels on receipt PDF

### backend/src/paperwork/domain/coordinators/render-contract-pdf/mod.ts
*(Customer-facing signed-contract PDF — bilingual EN/ES, high priority.)*
- `99` | "COTIZACIÓN Y ACUERDO" / "QUOTE & AGREEMENT" | doc tag (w/ #id)
- `104` | "FIRMADO" / "SIGNED" | signed status (w/ date)
- `117` | "Service Agreement" | hero-title fallback
- `126-137` | "Entre ${biz} (\"Contratista\") y ${cust ?? \"Cliente\"} (\"Cliente\")${ ` · vigente ${date}`}" / "Between ${biz} (\"Contractor\") and ${cust ?? \"Client\"} (\"Client\")${ ` · effective ${date}`}" | recital line
- `146` | "PARA" / "TO" | contact-block label
- `153` | "DE" / "FROM" | contact-block label
- `200` | "Detalles del trabajo" / "Job details" | section 01 header
- `208` | "DESCRIPCIÓN" / "DESCRIPTION" | line-item header
- `215` | "MONTO" / "AMOUNT" | line-item header
- `270` | "VALOR DEL ACUERDO" / "AGREEMENT VALUE" | total-card label
- `278` | "todo incluido, sin sorpresas" / "all in, no surprises" | total-card subtext
- `308` | "Calendario de pagos" / "Payment schedule" | section 02 header
- `360` | "Calendario" / "Schedule" | section 03 header
- `367` | "Inicio" / "Start" | schedule row label
- `384` | "Finalización estimada" / "Estimated completion" | schedule row label
- `415` | "Términos" / "Terms" | section 04 header
- `441-444` | "FECHA DE INICIO" / "DURACIÓN" / "PLAZO DE PAGO" / "GARANTÍA" | ES term labels
- `458` | "Estimado" / "Estimated" | term value prefix for "wraps"
- `479` | "Letra chica, en lenguaje claro" / "Fine print, in plain English" | section 05 header
- `488-542` | 13 ES legal clauses (titles + full paragraphs): "Ley Aplicable." / "Detalles del Trabajo." / "Condiciones de Pago." / "Órdenes de Cambio." / "Responsabilidades del Cliente." / "Retrasos y Condiciones Imprevistas." / "Garantía." / "Límite de Responsabilidad." / "Derecho a Detener el Trabajo." / "Terminación." / "Resolución de Disputas." / "Permisos y Cumplimiento." / "Indemnización." / "Acuerdo Completo." | contract fine print, ES
- `546-599` | 14 EN legal clauses (titles + full paragraphs): "Governing Law." / "Job Details." / "Payment Terms." / "Change Orders." / "Customer Responsibilities." / "Delays and Unforeseen Conditions." / "Warranty." / "Limitation of Liability." / "Right to Stop Work." / "Termination." / "Dispute Resolution." / "Permits and Compliance." / "Indemnification." / "Entire Agreement." | contract fine print, EN
- `649` | "Firmas" / "Signatures" | section 06 header
- `668` | "CONTRATISTA" / "CONTRACTOR" | signature-box label
- `690` | "Por" / "By" + ": ${contractor.name}" | signature byline
- `699` | "Fecha" / "Date" + ": ${date}" | signature date label
- `721` | "CLIENTE FIRMÓ" / "CLIENT SIGNED" | customer signature-box label
- `781-785` | "Contrato" / "Contract" + " #${id} · " + "Generado" / "Generated" + " ${date}" | PDF footer
- `952-964` | localizeTermValue ES map: "Pago al finalizar" / "Depósito + saldo" / "Sin garantía" / "De inmediato" / "La próxima semana" / "El próximo mes" + duration localizations (months→meses, week→semana, day→día) | term values, ES
- `976-982` | milestone labels: "Depósito"/"Deposit", "Saldo"/"Balance", "Intermedio"/"Midpoint", "Pago final"/"Final", "Antes de empezar"/"Before work starts", "Al finalizar"/"On completion", "A mitad del trabajo"/"At rough-in / midpoint" | payment-schedule milestones

### backend/src/users/domain/coordinators/send-otp/mod.ts
- `62` | "Tu código de Paperwork Monster: ${code}" | OTP SMS body, ES
- `63` | "Your Paperwork Monster code: ${code}" | OTP SMS body, EN

### backend/src/users/domain/data/sms/mod.ts
- (none) — Twilio wrapper; only dev logs + internal status/reason codes

### backend/src/users/domain/coordinators/verify-otp/mod.ts
- (none) — internal codes only ("invalid_code", "expired", "rate_limited"); "Dev User"/"Dev Business" are dev-seed values

### backend/src/communication/domain/data/email-service/mod.ts
- (none) — Postmark wrapper; only dev logs + internal reason codes

### backend/src/agents/domain/business/onboarding/mod.ts
*(Bossie onboarding chat copy shown to the contractor — defined here, emitted by the coordinators in §5.)*
- `135-136` | "Hey 👋 quick one before we start — what should I call you? (And what's your business name, if it's different?)" | ONBOARDING_ASK_TEXT
- `141-142` | "Hey there 👋 I'm Bossie — your assistant. What should I call you?" | ONBOARD_ASK_NAME
- `143-144` | "Nice to meet you, ${firstName}! And what's your business called?" | ONBOARD_ASK_BUSINESS
- `145-146` | "Almost there. Which state are you in, ${firstName}? (e.g. CA, TX, NY — used on your contracts)" | ONBOARD_ASK_STATE
- `147-148` | "Last one, ${firstName} — what's your business address? Paste it on one line: street, city, state zip (e.g. \"123 Main St, Austin, TX 78701\"). Solo / no office? Just say \"skip\"." | ONBOARD_ASK_ADDRESS
- `149-150` | "Awesome — we're set, ${firstName}. Okay, can we start with your first quote? Tell me anything — for example: \"I have a full bathroom remodel down to the studs, I would like to rebuild the bathroom.\"" | ONBOARD_HANDOFF
- `155-156` | "One more thing, ${firstName} — what's your email, and how would you like to get paid? (Venmo, Zelle, Cash App, ACH, or check. Just type something like \"venmo @rafa, rafa@x.com\" — or \"skip\".)" | ONBOARD_ASK_PAYOUT
- `371` | "Almost there. Looks like you're in ${stateName} (${code} area code) — sound right, ${firstName}? Or tell me the right state." | onboardAskStateWithGuess
- `192-205` | US_STATES full-state-name map — surfaces on contracts (reference data, not a sentence)
- `460-469` | [large LLM prompt — ADDRESS_LLM_PROMPT, now reproduced verbatim in Part 6]

### backend/src/agents/domain/business/conversation-title/mod.ts
- `14` | "New conversation" | empty-thread title fallback (sidebar)

### backend/src/agents/domain/business/llm-prompts/mod.ts
- [large LLM system prompts — SYSTEM_PROMPT_QUOTE (L11), SYSTEM_PROMPT_TERMS (L149); now reproduced verbatim in Part 6]

### backend/src/agents/domain/business/openai-tools/mod.ts
- [large LLM tool definitions — 3 tools / 11 `description:` fields; now reproduced verbatim in Part 6]

## 5. Backend — Assistant in-chat copy (agents coordinators)

> Messages Bossie (or the system) writes into the chat thread: acks, clarifications, phase dividers, continue-CTA cards, and conversation-preview/sidebar status strings. The onboarding "ask" strings are emitted here but *defined* in `agents/domain/business/onboarding/mod.ts` (see §4) — a single source of truth already exists for those.

### backend/src/agents/domain/coordinators/handle-chat-message/mod.ts
- `297` | "Sorry, didn't quite catch that — what should I call you? (just your first name is fine)" | name re-prompt
- `350` | "What's the business called? (e.g. \"Riley Roofing Co.\" — solo is fine too)" | business-name re-prompt
- `419` | "Hmm, didn't recognize that — try the 2-letter code (CA, TX, NY) or the full state name." | state re-prompt
- `509` | "Hmm, couldn't quite parse that. Try \"123 Main St, Austin, TX 78701\" — or just say \"skip\"." | address re-prompt
- `618` | "Locking the quote." | synthetic lock fast-path text (usually suppressed)
- `739` | "On it." | generic ack on tool-only turn
- `741` | "Got it — what would you like me to do with that?" | fallback when no text/action
- `885` | "Quote sent" | action_card content fallback (`locked.summary ?? "Quote sent"`)
- `900`,`930` | "We've locked the quote down! Is this for a business or a person?" | continue_cta content (→ terms)
- (emits the ONBOARD_ASK_* constants from §4 onboarding module at L251/277/312/332/362/391/407/431/456/497/521/572/584)

### backend/src/agents/domain/coordinators/send-contract/mod.ts
- `169` | "Contract emailed to ${emailedTo}" | phase_divider — email success
- `170` | "Contract email failed — ${emailFailureReason}" | phase_divider — email failure
- `171` | "Contract drafted — no email on file for this customer. Add one to deliver." | phase_divider — no email
- `175` | "Contract texted to ${textedTo}" | phase_divider — sms success
- `176` | "Contract text failed — ${smsFailureReason}" | phase_divider — sms failure
- `177` | "Contract drafted — no phone on file for this customer. Add one to deliver." | phase_divider — no phone
- `181` | "Contract emailed to ${emailedTo} and texted to ${textedTo}" | phase_divider — both ok
- `182` | "Contract emailed to ${emailedTo} — text failed (${smsFailureReason ?? \"no recipient\"})" | phase_divider — email ok, sms fail
- `183` | "Contract texted to ${textedTo} — email failed (${emailFailureReason ?? \"no recipient\"})" | phase_divider — sms ok, email fail
- `184` | "Contract not delivered — email: ${emailFailureReason ?? \"no recipient\"}; text: ${smsFailureReason ?? \"no recipient\"}" | phase_divider — both fail

### backend/src/agents/domain/coordinators/send-invoice/mod.ts
- `115` | "Invoice · due ${fresh.dueDate} · sent to ${emailedTo}" | action_card content — sent
- `116` | "Invoice · due ${fresh.dueDate} · no email on file" | action_card content — no recipient
- `124` | "Job total (contract ${contract.id.slice(0, 8)})" | action_card line-item description
- `137` | "Invoice sent · due ${fresh.dueDate}" | conversation preview (sidebar)

### backend/src/agents/domain/coordinators/lock-quote/mod.ts
- `104` | "Quote locked" | action_card content fallback (`fresh.summary ?? "Quote locked"`)
- `120` | "We've locked the quote down! Is this for a business or a person?" | continue_cta content (→ terms)
- `130` | "Quote sent: ${fresh.summary ?? fresh.id}" | conversation preview (sidebar)

### backend/src/agents/domain/coordinators/accept-contract/mod.ts
- `71`,`73` | "Contract accepted by client" | phase_divider content + payload label
- `85` | "Continue to invoice" | continue_cta content (CTA label)
- `89` | "Customer signed — bill the job and send the invoice." | continue_cta payload summary
- `96` | "✓ Contract accepted by client" | conversation preview (sidebar)

### backend/src/agents/domain/coordinators/handle-wizard-answer/mod.ts
- `121` | "Custom" | fallback pick value (renders in "${label}: ${pickValue}" bubble)
- `127` | "${stepDef.label}: ${pickValue}" | user-pick chat bubble (transcript echo)
- `139` | "${stepDef.label}: ${pickValue}" | conversation preview (sidebar)
- `161` | "Ready to send" | continue_cta content (wizard complete)
- `164` | "All terms answered. Review and send to your client." | continue_cta payload summary
- *(wizard step questions/option labels come from CONTRACT_TERMS_WIZARD_V1 spec — see note below)*

### backend/src/agents/domain/coordinators/transition-to-terms/mod.ts
- `50` | "All terms answered." | wizard message content fallback (`step?.question ?? …`)
- `68`,`69` | "A little more info" | phase_divider content + payload label (Phase 2 divider)

### backend/src/agents/domain/coordinators/ensure-sample-quote/mod.ts
- `39` | "This is a SAMPLE quote so you can see what your customers receive. Real quotes will use the details you give the assistant." | sample quote description
- `42` | "Paver patio install (materials)" / "Paver patio install (labor)" | sample line-item descriptions
- *(also "Paver Patio Installation" as jobName/summary; SAMPLE_TAG "onboarding-sample-v1" is internal — excluded)*

### backend/src/agents/domain/coordinators/suggest-prices/mod.ts
- `94`,`141`,`148`,`155` | "Basic" / "Standard" / "Premium" | fallback price-tier labels (price picker)
- `144` | "Core scope, essentials only" | fallback tier rationale
- `150` | "Full scope, typical materials" | fallback tier rationale
- `156` | "Premium materials, extra finish" | fallback tier rationale
- `31-48` | [LLM system prompt — now in Part 6]

### backend/src/agents/domain/coordinators/generate-job-options/mod.ts
- `214` | "New job" | fallback job summary (clampSummary default)
- `231` | "Jobsite cleanup" | fallback option's appended scope bullet
- `34-55` | [LLM system prompt — now in Part 6]

### backend/src/agents/domain/coordinators/start-onboarding-conversation/mod.ts
- `56-59` | seeds ONBOARD_ASK_NAME / ONBOARD_ASK_BUSINESS / onboardAskStateWithGuess / ONBOARD_ASK_ADDRESS (constants from §4) into the first assistant turn | seeded onboarding chat
- `65` | "Welcome" | conversation title (sidebar); the seeded ask also doubles as the preview

### backend/src/agents/domain/coordinators/polish-job-details/mod.ts
- `163` | "New job" | fallback summary when raw first line is empty (saved onto quote)
- `32-46` | [LLM system prompt — now in Part 6]

### backend/src/agents/domain/coordinators/professionalize-bullet/mod.ts
- (none — LLM system prompt at L15-27 — now in Part 6; output is model-generated)

### Other agents coordinators (start-conversation, bind-conversation-customer, load-conversation, rewind-wizard)
- (none)

---

### Notes & follow-ups

- **Wizard prose not inline here:** the Phase-2 contract-terms wizard step questions and option labels are defined in `backend/src/agents/domain/business/contract-terms-wizard-spec/mod.ts` (`CONTRACT_TERMS_WIZARD_V1`) — that's the file to localize for wizard copy, plus its mirror in `front-end/islands/AsstChat.tsx`.
- **Excluded deliberately:** `console.*` logs; DTO/validator `Error("invalid …")` messages and required-field errors (technical, not shown to users); `voice-stream-controller` protocol/error codes; KV keys; env-var names; internal status enums.
- **Duplication worth consolidating:** payment-method labels ("Venmo", "Zelle", "Cash App"…) appear independently in at least 5 places (`InvoicesPage.tsx`, `routes/i/[id].tsx`, `render-receipt-pdf`, plus EN/ES variants). Status labels ("Draft", "Sent", "Paid", "Overdue"…), milestone labels ("Deposit"/"Depósito", "Balance"/"Saldo"…), and the weekday/month-name arrays are likewise re-declared across many files. A shared label module would shrink this list substantially.

## 6. Backend — LLM prompts & tool definitions (verbatim)

> These are model-facing instruction strings — content, not load-bearing code (editing them changes Bossie's behavior but won't break the build). Reproduced verbatim from source. `${...}` placeholders are runtime interpolation. Phase-1/2 chat prompts and tool descriptions drive the assistant; the rest are single-purpose extraction/formatting prompts.

### Chat system prompts — `backend/src/agents/domain/business/llm-prompts/mod.ts`

#### `SYSTEM_PROMPT_QUOTE` — Phase 1, quote building (lines 11–147)
~~~text
You are Bossie. Phase 1: quote building. The contractor is on a job site, on their phone. Friction = lost deal — move fast.

DECIDE FIRST — is the user describing a job that needs a quote?
  YES — anything with a trade verb + a noun: paint, tile, install, repair, replace,
        remove, build, demo, mow, cut, trim, clean, pressure-wash, patch, reroof,
        regrade, refinish, sweep, haul, seal, etc. Customer names ('Quote for the
        Hendersons') and dollar amounts ('$1,200') in the message are SIGNALS that
        it's a quote request, not reasons to skip drafting.
        → IMMEDIATELY call `create_quote` with line items. No clarifying questions,
          no greeting prose, no 'would you like me to'.
  NO  — pure greetings ('hello', 'hey'), tests ('are you there'), meta-questions
        about Bossie ('what can you do'), or off-topic chat with no job details at all.
        → Reply in ONE short sentence. Do NOT call any tool.

CONFIRMATION TURNS — there is already a draft quote in the conversation history.
  These short messages mean LOCK THE QUOTE — call `lock_quote` (any quoteId; the
  coordinator picks the active one server-side). DO NOT respond with prose alone.
    'lock it in' / 'lock it' / 'lock'
    'send it' / 'send' / 'ship it' / 'fire it off' / 'fire it'
    'looks good' / 'looks great' / 'looks right' / 'perfect' / 'nice'
    'yes' / 'yep' / 'yup' / 'yeah' / 'do it' / 'go ahead' / 'go for it' / 'sounds good'
  These short messages mean ADVANCE TO TERMS — call `request_terms_transition`.
  Only after a lock has happened earlier in the conversation:
    'set up the contract' / 'do terms' / 'next step' / 'continue' / 'yeah contract'
  Correction ('bump labor to $2,100', 'drop the discount', 'add baseboards $350')
    → call `create_quote` again with the updated line items. Keep the original
      summary. Do not lock — wait for explicit confirmation.

EXAMPLES — confirmation. The conversation history already shows a drafted quote;
  the user replies in one of these short phrases. Each fires `lock_quote`:
    user: 'send it'              → call lock_quote(quoteId='active')
    user: 'lock it in'           → call lock_quote(quoteId='active')
    user: 'looks good — send it' → call lock_quote(quoteId='active')
    user: 'yep'                  → call lock_quote(quoteId='active')
    user: 'go ahead'             → call lock_quote(quoteId='active')
  NEVER reply 'Got it, what next?' to these. Always fire the tool.

LINE ITEM DESCRIPTIONS — what the customer reads on the PDF. Echo the user's words.
  'install a bathtub'        → 'Bathtub installation'
  'tile the bathroom floor'  → 'Bathroom floor tile install'
  'kitchen remodel - cabinets, counters' → two lines, one per job.

PRICES (CRITICAL — amountCents is in CENTS, not dollars):
  User gave dollars → multiply by 100. '$1,200' → 120000. '$249.99' → 24999. '$80' → 8000.
  User didn't give a price → estimate from US contractor pricing for the trade.
  Discount line → use a NEGATIVE amountCents (e.g. '10% off $1,200' → -12000).

DEFAULTS — use these without asking, the user will correct if wrong:
  Sqft when unstated:  bathroom 80 · kitchen backsplash 30 · garage 480 · driveway 600 · roof 2000 · interior repaint 1500
  Materials: mid-tier (porcelain over ceramic, semi-gloss over flat, polyaspartic over single-coat).
  Setting: residential. Crew: 2 people, 1–2 day job for sub-500 sqft work.

RECURRING / SUBSCRIPTION SERVICES — when the user gives a flat $X/month or $X/visit
  total, that's the BILLED AMOUNT, not the sum of sub-tasks. Use ONE line item with
  the user-stated total. Don't break 'biweekly mowing, edging, blowing $850/month'
  into 3 separate lines that sum to $2,550 — the customer is being billed $850/month.
  Right: { description: 'Monthly lawn maintenance — biweekly mow, edge, blow', amountCents: 85000 }
  Wrong: 3 separate lines totalling 255000.

NEW QUOTE WITHIN THE SAME CONVERSATION — when the user starts a fresh job for a
  different customer ('Now one for the Park family — gutter guards $640.', 'Next:
  for Alvarez — window cleaning $180.', 'Quote for Mendez:' after a Park quote
  exists), call `create_quote` with COMPLETELY FRESH line items for the new job.
  Do NOT reuse the previous customer's amounts or job details. The coordinator will replace
  the active draft. Treat this as 'new draft', not 'edit prior draft'.

FORBIDDEN — these are violations, not preferences:
  - Asking 'what size?' / 'what material?' / 'do you need permits?' once you've decided YES.
  - 'Would you like me to…' / 'Should I include…' — never. Include it and fire.
  - Naming the tools in your reply text. NEVER write 'create_quote', 'lock_quote',
    'request_terms_transition', or 'Firing X now' in user-visible prose. The action
    card speaks for itself; your text is a one-line acknowledgement at most.
  - Greeting prose before the tool call ('Sure, I can help with that!').
  - Listing 2-3 options for the user to pick — pick the middle one yourself and fire.
  - Asking before drafting on turn 1, 2, or ever. The only legal time to ask is when
    the user has rejected a draft AND said specifically what's missing.

FOLLOW-UP PROSE AFTER `create_quote` — IMPORTANT: you ALWAYS fire create_quote FIRST.
  Your text reply is in addition to the tool call, never instead of it.
  CUSTOMER NAME RULES:
  - If the user named a customer ('Quote for Bryant', 'Patel residence', 'the Hendersons',
    'Acme Property Group'), include the name in the summary.
  - If the user did NOT name a customer ('Tile bathroom 80 sqft', 'Need an epoxy floor',
    'i need to tile a kitchen'), STILL fire create_quote with a name-less summary like
    'Bathroom tile install' or 'Kitchen tile install'. The tool call is REQUIRED in BOTH
    cases — never skip it just because no name was mentioned.
  TEXT REPLY: keep it short — always 'Drafting a quote.' (or an equally brief ack).
  Do NOT ask who the customer is — they are collected AFTER the user clicks 'Lock it in'.
  Asking 'who's this for?' / 'whose place is this?' duplicates that flow and is forbidden.
  Never reply with prose alone when work is described.

EXAMPLES — YES path. Each input fires `create_quote`. amountCents shown for clarity.
  Pay attention to the `text:` lines — they show whether to ask for a name or not.

  Input: 'I need to quote a lawn mowing job for the Patel residence. $80.'
    summary: 'Lawn mowing — Patel residence'
    lineItems: [{ description: 'Lawn mowing', amountCents: 8000 }]
    text: 'Drafting a quote.'   // name (Patel) was given

  Input: 'Quote for Bryant: gutter cleaning $220.'
    summary: 'Gutter cleaning — Bryant'
    lineItems: [{ description: 'Gutter cleaning', amountCents: 22000 }]
    text: 'Drafting a quote.'   // name (Bryant) was given

  Input: 'Kitchen remodel for the Hendersons. Demo cabinets $1,200, shaker cabinets installed $6,500, quartz $3,800, electrical $600.'
    summary: 'Kitchen remodel — Henderson'
    lineItems: 4 items with amountCents 120000, 650000, 380000, 60000.
    text: 'Drafting a quote.'   // name (Hendersons) was given

  Input: 'Tile bathroom 80 sqft.'
    summary: 'Bathroom tile install'
    lineItems: [{ description: 'Bathroom tile install (80 sqft, porcelain)', amountCents: 120000 }]
    text: 'Drafting a quote.'

  Input: 'Need a quote for an epoxy floor, 480 sqft polyaspartic.'
    summary: 'Garage epoxy floor'
    lineItems: [{ description: 'Garage floor epoxy install (480 sqft, polyaspartic)', amountCents: 144000 }]
    text: 'Drafting a quote.'

  Input: 'Roof needs patching at the Hernandez place.'
    summary: 'Roof patching — Hernandez'
    lineItems: [{ description: 'Roof patching (2000 sqft)', amountCents: 200000 }]  // estimate
    text: 'Drafting a quote.'
  Input: 'Emergency call — burst pipe at the Reilly house. Saturday rate. Repair $475, weekend rush surcharge $150.'
    summary: 'Emergency burst pipe repair — Reilly'
    lineItems: [{ 'Burst pipe repair', 47500 }, { 'Weekend rush surcharge', 15000 }]
  Input: 'qte for delgado - plumbg leak fix undr sink 250 + new shutoff valve 65'
    summary: 'Plumbing repair — Delgado'
    lineItems: [{ 'Leak fix under sink', 25000 }, { 'New shutoff valve', 6500 }]

EXAMPLES — NO path. One short sentence reply. No tool call:
  Input: 'hello' / 'hey'
    Reply: 'Hey! Tell me about the job — paint, tile, plumbing, anything. I draft quotes in seconds.'
  Input: 'what can you actually do?'
    Reply: "I draft quotes from a quick description, lock them in to email the customer, then walk you through contract terms. What's the job?"
~~~

#### `SYSTEM_PROMPT_TERMS` — Phase 2, contract terms (lines 149–160)
~~~text
You operate this contractor's business in PHASE 2 — contract terms.

The wizard is driving the conversation. You only respond to:
  - Free-text 'Custom…' answers (paraphrase the picked value cleanly).
  - Quick clarifying questions about a specific term ('what does mediation mean?').

Do NOT introduce new line items, prices, or job-details changes — phase 1 is locked.
If the user wants to revisit pricing, say: 'Tap "Re-open the quote" to go back to phase 1.'

Never name internal tools or function names in your replies.
~~~

**Language override** — appended to whichever base prompt above when the contractor's language is `es` (`handle-chat-message/mod.ts:695-697`), as `` `${base}\n\nIMPORTANT: ...` ``:

> `IMPORTANT: The contractor's language is Spanish. Write ALL of your replies to them in neutral Latin-American Spanish.`

**Business-context system message** — a second `system` message pushed before history when `businessContext` is non-empty (`data/openai/mod.ts:54`):

> `Business context (refreshed each turn):\n${req.businessContext}`

### Function-tool definitions (model-facing `description` text) — `backend/src/agents/domain/business/openai-tools/mod.ts:13-76`
~~~text
### tool: create_quote
  description: Draft a quote for the user to review. Fire immediately when work is described — don't ask for confirmation, sizes, materials, or anything else first.
  param `summary`: One-line headline like 'Quote: 2-Car Garage Epoxy Floor'.
  param `lineItems`: Quote line items. CRITICAL: amountCents is in CENTS — always multiply your dollar estimate by 100. A $1,200 job is amountCents: 120000, NOT 1200. A $16 job is 1600. If the line item should look like $X.YZ in the UI, send X*100 + YZ.
  param `lineItems[].description`: Plain-English line, e.g. 'Bathroom tile install (80 sqft, porcelain)'.
  param `lineItems[].amountCents`: Total dollars × 100. $1,200 → 120000. $850 → 85000. NEVER pass dollars directly.

### tool: lock_quote
  description: Lock the active quote so it can't be edited. Fire when the user confirms (e.g. 'lock it in', 'send it', 'yes').
  param `quoteId`: The id of the quote to lock — typically the most recently drafted quote in this conversation.

### tool: request_terms_transition
  description: Offer to advance from phase 1 (quote) to phase 2 (contract terms wizard). Fire AFTER lock_quote in the same response.
  param `quoteId`: The locked quote that the contract will be drafted against.
~~~

### Address parser — `backend/src/agents/domain/business/onboarding/mod.ts` (`ADDRESS_LLM_PROMPT`, lines 460–469)

System prompt (the user message is the raw address text, no wrapper — `onboarding/mod.ts:481`):
~~~text
You parse US business addresses from free-form text.
Reply with EXACTLY one JSON object on a single line, no markdown, no prose, no code fences.
Schema: {"street":"...","city":"...","state":"XX","postal":"..."}
Rules:
- "state" must be a 2-letter US state code (UPPERCASE) — or empty string if unknown.
- "postal" is a 5-digit zip — or empty string if not present in the text. NEVER invent a zip.
- "street" includes the house number plus street name (e.g. "219 Delano Way"). Empty if not present.
- "city" is the city/town name only (e.g. "Myrtle Beach"). Empty if not present.
- Title-case street and city; uppercase state.
- If the text is clearly NOT an address, reply: {"street":"","city":"","state":"","postal":""}
~~~

### Pricing tiers — `backend/src/agents/domain/coordinators/suggest-prices/mod.ts` (`SYSTEM_PROMPT`, lines 31–48)
~~~text
You are a pricing assistant for a contractor. Given a raw job description,
propose THREE price options the contractor can choose between.

OUTPUT — JSON only, no prose, no code fences:
  { "options": [
    { "tier": "basic",    "label": "Basic",    "priceCents": <int>, "rationale": "<≤10 words>" },
    { "tier": "standard", "label": "Standard", "priceCents": <int>, "rationale": "<≤10 words>" },
    { "tier": "premium",  "label": "Premium",  "priceCents": <int>, "rationale": "<≤10 words>" }
  ] }

RULES:
- Exactly 3 options, ascending price: basic < standard < premium.
- priceCents is an integer number of cents (e.g. $850.00 → 85000).
- Base the numbers on typical US small-contractor pricing for the described
  work. If the description is vague, give a reasonable mid-market range.
- rationale is ≤10 words, plain, no hype, no emojis.
- Return JSON only.
~~~

User message (line 75): `` `Raw job description:\n${raw}${langLine}` `` · `langLine` (appended only when `lang === "es"`, lines 65-67): `"\n\nWrite each label and rationale in neutral Latin-American Spanish."`

### Job options — `backend/src/agents/domain/coordinators/generate-job-options/mod.ts` (`SYSTEM_PROMPT`, lines 34–55)
~~~text
You turn a contractor's raw job description into THREE distinct, customer-ready scope-of-work options.

OUTPUT — return JSON only, no prose, no code fences:
  { "options": [
    { "jobName": "<3 words or less, Title Case>", "summary": "<short title, max 8 words, title case>", "bullets": ["<scope line>", "<scope line>", "<scope line>"] },
    { ... },
    { ... }
  ] }

RULES:
- Return exactly 3 options. Each option has 3 or 4 bullets — no more, no fewer.
- The three options are different phrasings / groupings of the SAME job, ranging from concise to detailed. They are alternatives the contractor picks between, not three separate jobs.
- Each bullet is one short scope-of-work line (≈3–7 words): "Interior demolition", "Haul away debris", "Jobsite cleanup". No sentences, no trailing periods.
- jobName is a noun-phrase label like "Kitchen Remodel" or "Junk Removal" — three words or fewer, Title Case, no punctuation.
- Each option MUST have a UNIQUE jobName — do not repeat the same jobName across the three options.
- Use only facts the contractor stated. Do NOT invent materials, scope, square footage, brands, durations, or warranties.
- No first-person ("I'll", "we'll"). Write as the contractor describing what the job covers.
- No emojis, no exclamation marks, no marketing hype.
- Fix obvious typos and expand unambiguous shorthand (e.g. "BR" → "bathroom").
- If the raw text is vague, keep the bullets general rather than padding with assumptions.
~~~

User message (line 94): `` `Raw job description:\n${raw}${priceLine}${langLine}` `` · `priceLine` (when `priceCents > 0`): `"\n\nQuoted price for this job: $<amount>. Keep each option's scope within that range."` · `langLine` (when `commsLanguage === "es"`): `"\n\nWrite jobName, summary, and every bullet in neutral Latin-American Spanish."`

### Polish job details — `backend/src/agents/domain/coordinators/polish-job-details/mod.ts` (`SYSTEM_PROMPT`, lines 32–46)
~~~text
You polish a contractor's raw job description into clean, professional copy a customer will read on a quote.

OUTPUT — return JSON only, no prose, no code fences:
  { "jobName": "<3 words or less, Title Case>", "summary": "<short title, max 8 words, title case>", "description": "<1-3 sentences, professional, third-person>" }

RULES:
- jobName is a noun-phrase label like "Backyard Junk Removal" or "Kitchen Remodel" — three words or fewer, Title Case, no punctuation.
- Use only facts the contractor stated. Do NOT invent materials, scope, square footage, brands, durations, or warranties.
- No filler hype ("we'll do an amazing job"). Keep it concrete and calm.
- No first-person ("I'll …"). Write as the contractor describing what the job covers.
- No emojis, no exclamation marks, no marketing language.
- Fix obvious typos and grammar. Expand shorthand (e.g. "BR" → "bathroom") only when the meaning is unambiguous.
- If the raw text is too vague to polish meaningfully, mirror it back cleaned-up rather than padding with assumptions.
~~~

User message (line 84): `` `Raw job description:\n${raw}${priceLine}${langLine}` `` · `priceLine` (when `priceCents > 0`): `"\n\nQuoted price for this job: $<amount>. Scope your description to fit that range."` · `langLine` (when `commsLanguage === "es"`): `"\n\nWrite jobName, summary, and description in neutral Latin-American Spanish."`

### Professionalize bullet — `backend/src/agents/domain/coordinators/professionalize-bullet/mod.ts` (`SYSTEM_PROMPT`, lines 15–27)
~~~text
You rewrite a contractor's rough scope-of-work bullet into ONE clean, professional line a customer reads on a quote.

OUTPUT — return JSON only, no prose, no code fences:
  { "text": "<one clean scope line>" }

RULES:
- One short line, roughly 3–8 words. No sentences, no trailing period.
- Third-person scope language ("Remove flooring, drywall & cabinets"), never first-person ("I'll rip out…").
- Use only what the contractor wrote. Do NOT invent materials, scope, square footage, or warranties.
- Fix typos and expand unambiguous shorthand. No emojis, no hype, no marketing language.
- If the input is already clean, return it essentially unchanged.
~~~

User message (line 47): `` `Rough bullet:\n${text}` ``

> Not LLM prompts: the Whisper transcription client sends no `prompt` field; `conversation-title/mod.ts` is pure string logic (no model call).

## 7. Backend — Contract-terms wizard spec

> `CONTRACT_TERMS_WIZARD_V1` drives the Phase-2 wizard shown in chat. Step **questions** and option **labels/sublabels** are editable content; the step `id`/option `value` keys (used in logic) are load-bearing and excluded. The live spec has **5 steps** — the termination / dispute / governing-state / state-notices steps seen in the UI demo (`AssistantSections.tsx`, `AsstChat.tsx`) are hardcoded mockups, not in this spec.

### backend/src/agents/domain/business/contract-terms-wizard-spec/mod.ts
**step: customer**
- `23` | "Customer" | step label
- `24-25` | "We've locked the quote down! Is this for a business or a person?" | step question
- `27` | "Use the customer from chat" | option label (use_active)
- `28` | "Pick an existing customer" | option label (pick_existing)
- `31` | "Add a new business or person" | option label (create_new)

**step: start_date**
- `38` | "Start" | step label
- `39` | "When does the job start?" | step question
- `41` | "Right away" | option label (asap)
- `42` | "Next week" | option label (next_week)
- `43` | "Next Month" | option label (next_month)
- `44` | "Pick a date" | option label (custom)

**step: wraps**
- `49` | "Time to complete" | step label
- `50` | "How long will the job take?" | step question
- `52` | "1 day" | option label (1_day)
- `53` | "2–3 days" | option label (2_3_days)
- `54` | "1 week" | option label (1_week)
- `55` | "2 weeks" | option label (2_weeks)
- `56` | "Custom" | option label (custom)

**step: payment_terms**
- `61` | "Payment" | step label
- `62` | "When do you want to get paid?" | step question
- `66` | "Payment upon completion" | option label (net_15)
- `67` | "Same-day payment" | option sublabel (net_15)
- `69` | "50/50" | option label (50_50) — value == label
- `69` | "Half upfront, half when done" | option sublabel (50_50)
- `70` | "30/30/40" | option label (30_30_40) — value == label
- `70` | "Start, halfway, done" | option sublabel (30_30_40)
- `73` | "Deposit + balance" | option label (deposit_bal)
- `74` | "Small upfront, rest when done" | option sublabel (deposit_bal)
- `78` | "Custom" | option label (custom)
- `79` | "Set your own terms" | option sublabel (custom)

**step: warranty**
- `86` | "warranty" | step label
- `87` | "How long do you stand behind your work?" | step question
- `89` | "No warranty" | option label (none)
- `90` | "6 months" | option label (6_months)
- `91` | "12 months" | option label (12_months)
- `92` | "24 months" | option label (24_months)
- `93` | "Custom" | option label (custom_months)

## 8. Internal / developer-facing strings (errors & logs)

> Error and log message **text** — editable content that won't break the app if reworded. Items tagged **`[load-bearing code]`** are status/error codes (e.g. `"forbidden"`, `UnauthorizedError`, `"invalid_code"`) that other code matches on, or `NotFoundError(PREFIX, id)` keyed by a constant — **do not edit these**; they're listed only for completeness. `${...}` = interpolation. DTO validators throw `"invalid <thing>: ${JSON.stringify(errors)}"` consistently across the codebase. Object/JSON keys, KV key prefixes, enum values, env-var names, and type literals are excluded (load-bearing, per scope).

### backend/src/agents — errors
- `business/contract-terms-wizard-spec/mod.ts:102` | "unknown wizard spec: ${specId}"
- `business/derive-phase/mod.ts:35` | "invalid phase transition: ${conv.currentPhase} → ${to}"
- `business/wizard-progress/mod.ts:51` | "wizard already complete (step ${idx} of ${spec.steps.length})"
- `business/wizard-progress/mod.ts:53` | "expected answer for \"${active.id}\", got \"${input.stepId}\""
- `business/wizard-progress/mod.ts:56` | "unknown option \"${input.optionId}\" for step \"${active.id}\""
- `business/wizard-progress/mod.ts:58` | "option \"${input.optionId}\" requires a customValue"
- `coordinators/accept-contract/mod.ts:49` | "forbidden" `[load-bearing code]`
- `coordinators/accept-contract/mod.ts:51` | "contractId does not match this conversation's contract"
- `coordinators/bind-conversation-customer/mod.ts:39` | "forbidden" `[load-bearing code]`
- `coordinators/generate-job-options/mod.ts:70` | "raw is required"
- `coordinators/handle-chat-message/mod.ts:155` | "forbidden" `[load-bearing code]`
- `coordinators/handle-wizard-answer/mod.ts:75` | "forbidden" `[load-bearing code]`
- `coordinators/handle-wizard-answer/mod.ts:77` | "conversation is not in 'terms' phase"
- `coordinators/handle-wizard-answer/mod.ts:84` | "wizard state missing — call transition-to-terms first"
- `coordinators/handle-wizard-answer/mod.ts:217` | "create_new requires customer.create.name (or customValue)"
- `coordinators/handle-wizard-answer/mod.ts:241` | "customer contact must not match the contractor's own email or phone number"
- `coordinators/handle-wizard-answer/mod.ts:265` | "pick_existing requires customer.id"
- `coordinators/load-conversation/mod.ts:43` | "forbidden" `[load-bearing code]`
- `coordinators/lock-quote/mod.ts:61` | "forbidden" `[load-bearing code]`
- `coordinators/polish-job-details/mod.ts:62` | "raw is required"
- `coordinators/professionalize-bullet/mod.ts:41` | "text is required"
- `coordinators/rewind-wizard/mod.ts:44` | "forbidden" `[load-bearing code]`
- `coordinators/rewind-wizard/mod.ts:46` | "conversation is not in 'terms' phase"
- `coordinators/rewind-wizard/mod.ts:51` | "wizard state missing — call transition-to-terms first"
- `coordinators/send-contract/mod.ts:61` | "forbidden" `[load-bearing code]`
- `coordinators/send-contract/mod.ts:63` | "contractId does not match this conversation's contract"
- `coordinators/send-invoice/mod.ts:55` | "forbidden" `[load-bearing code]`
- `coordinators/send-invoice/mod.ts:57` | "conversation has no bound contract — accept the contract first"
- `coordinators/suggest-prices/mod.ts:63` | "raw is required"
- `coordinators/transition-to-terms/mod.ts:40` | "forbidden" `[load-bearing code]`
- `data/agent-conversation-store/mod.ts:57` | NotFoundError("agent_conversation", id) `[load-bearing code]`
- `data/openai/mod.ts:34` | "OPENAI_API_KEY is not set; cannot use OpenAILLMClient"
- `dto/conversation.ts:52` | "invalid agent conversation: ${JSON.stringify(errors)}"
- `dto/message.ts:65` | "invalid chat input: ${JSON.stringify(errors)}"
- `dto/wizard.ts:77` | "invalid wizard answer: ${JSON.stringify(errors)}"
- `entrypoints/chat-controller/mod.ts:55` | "voice chat requires payload.fileId"
- `entrypoints/chat-controller/mod.ts:62` | "image chat requires payload.fileId"
- `entrypoints/chat-controller/mod.ts:72` | "chat requires non-empty content"
- `entrypoints/conversations-controller/mod.ts:102` | "quoteId is required"
- `entrypoints/conversations-controller/mod.ts:114`,`127` | "contractId is required"
- `entrypoints/conversations-controller/mod.ts:162` | "customerId is required"
- `entrypoints/conversations-controller/mod.ts:170` | "forbidden" `[load-bearing code]`
- `entrypoints/job-details-controller/mod.ts:66`,`82`,`114` | "raw is required"
- `entrypoints/job-details-controller/mod.ts:146` | "text is required"
- `entrypoints/wizard-controller/mod.ts:54` | "conversationId required"

### backend/src/agents — logs
- `coordinators/generate-job-options/mod.ts:100` | "[generate-job-options] llm call failed:"
- `coordinators/handle-chat-message/mod.ts:676` | "[handle-chat] failed to load image ${fileId}:"
- `coordinators/handle-chat-message/mod.ts:916` | "[chat:lock_quote] email dispatch failed for quote ${quoteId}:"
- `coordinators/handle-wizard-answer/mod.ts:309` | "[wizard:finalize] conversation ${conv.id} has no quoteId — skipping contract creation"
- `coordinators/handle-wizard-answer/mod.ts:319` | "[wizard:finalize] failed to load quote ${conv.quoteId}:"
- `coordinators/lock-quote/mod.ts:85` | "[lock-quote] email dispatch failed for quote ${quote.id}:"
- `coordinators/polish-job-details/mod.ts:90` | "[polish-job-details] llm call failed:"
- `coordinators/professionalize-bullet/mod.ts:52` | "[professionalize-bullet] llm call failed:"
- `coordinators/send-contract/mod.ts:92`,`104`,`124` | "[send-contract] ... ok=... to=... reason=..." (delivery status logs)
- `coordinators/send-contract/mod.ts:95`,`107`,`127` | "[send-contract] ... dispatch failed ...:"
- `coordinators/send-invoice/mod.ts:100` | "[send-invoice] invoice=${invoice.id} email ok=... to=... reason=..."
- `coordinators/send-invoice/mod.ts:103` | "[send-invoice] email dispatch failed for invoice ${invoice.id}:"
- `coordinators/suggest-prices/mod.ts:81` | "[suggest-prices] llm call failed:"
- `data/openai/mod.ts:92` | "[openai-llm] empty response on first try; retrying once"

### backend/src/analytics — errors (DTO validators)
- `dto/clients-stats.ts:43` | "invalid top-clients response: ${JSON.stringify(errors)}"
- `dto/clients-stats.ts:50` | "invalid client-segments response: ${JSON.stringify(errors)}"
- `dto/dashboard-stats.ts:93` | "invalid dashboard stats: ${JSON.stringify(errors)}"
- `dto/quotes-stats.ts:33` | "invalid win-rate response: ${JSON.stringify(errors)}"
- `dto/quotes-stats.ts:40` | "invalid insight response: ${JSON.stringify(errors)}"

### backend/src/communication — errors
- `data/conversation-store/mod.ts:30` | NotFoundError(PREFIX, id) `[load-bearing code]`
- `data/conversation-store/mod.ts:36` | ForbiddenError(PREFIX, id) `[load-bearing code]`
- `data/message-store/mod.ts:44` | NotFoundError(PREFIX, id) `[load-bearing code]`
- `data/notification-store/mod.ts:55` | NotFoundError(PREFIX, id) `[load-bearing code]`
- `data/notification-store/mod.ts:61` | ForbiddenError(PREFIX, id) `[load-bearing code]`
- `dto/conversation.ts:25`,`32` | "invalid conversation[ patch]: ${JSON.stringify(errors)}"
- `dto/message.ts:46`,`53` | "invalid message[ patch]: ${JSON.stringify(errors)}"
- `dto/notification.ts:70`,`77` | "invalid notification[ patch]: ${JSON.stringify(errors)}"
- `entrypoints/contact-public-controller/mod.ts:21` | "invalid contact: ${JSON.stringify(errors)}"
- `entrypoints/email-controller/mod.ts:20` | "invalid email: ${JSON.stringify(errors)}"
- `entrypoints/message-controller/mod.ts:37` | "conversationId query param is required"

### backend/src/communication — logs
- `data/email-service/mod.ts:67` | "[email:dev-mode] would send to=${input.to} subject=\"${input.subject}\"${attachLog}"

### backend/src/core — errors & logs
- `business/transcription/.../openai-whisper/mod.ts:30` | "OPENAI_API_KEY not set"
- `business/transcription/.../openai-whisper/mod.ts:54` | "openai whisper ${res.status}: ${text.slice(0, 200)}"
- `business/transcription/.../openai-whisper/mod.ts:79` | "failed to fetch audio at ${req.audioUrl}: ${r.status}"
- `business/transcription/.../openai-whisper/mod.ts:82` | "transcription request requires `audio` or `audioUrl`"
- `data/repository/mod.ts:39` | NotFoundError(this.prefix, id) `[load-bearing code]`
- `dto/entity.ts:23` | "invalid ${label}: ${JSON.stringify(errors)}"
- `business/events/mod.ts:58` | "[EventBus] listener threw:" (log)

### backend/src/crm — errors
- `data/account-store/mod.ts:30`,`36` | NotFoundError / ForbiddenError(PREFIX, id) `[load-bearing code]`
- `data/customer-store/mod.ts:50`,`56` | NotFoundError / ForbiddenError(PREFIX, id) `[load-bearing code]`
- `data/entry-store/mod.ts:30`,`36` | NotFoundError / ForbiddenError(PREFIX, id) `[load-bearing code]`
- `dto/account.ts:31`,`38` | "invalid account[ patch]: ${JSON.stringify(errors)}"
- `dto/customer.ts:106`,`113` | "invalid customer[ patch]: ${JSON.stringify(errors)}"
- `dto/entry.ts:39`,`46` | "invalid entry[ patch]: ${JSON.stringify(errors)}"

### backend/src/files — errors & logs
- `data/file-store/mod.ts:43` | "file create commit failed"
- `data/file-store/mod.ts:50`,`56` | NotFoundError / ForbiddenError("file", id) `[load-bearing code]`
- `data/file-store/mod.ts:66` | "file ${id} page ${i} missing"
- `entrypoints/files-controller/mod.ts:22` | "invalid file: ${JSON.stringify(errors)}"
- `coordinators/process-voice-memo/mod.ts:46` | "[process-voice-memo] failed to mark file ${input.fileId} as failed: ..." (log)

### backend/src/paperwork — errors
- `data/change-order-store/mod.ts:45` | "change order not found: ${id}"
- `data/change-order-store/mod.ts:51` | "forbidden" `[load-bearing code]`
- `data/{contract,invoice,payment,payment-terms,quote}-store/mod.ts` (`:30`/`:36` each) | NotFoundError / ForbiddenError(PREFIX, id) `[load-bearing code]`
- `data/shortlink-store/mod.ts:46` | NotFoundError(PREFIX, code) `[load-bearing code]`
- `data/shortlink-store/mod.ts:111` | "shortlink: deterministic code collided with another resource"
- `dto/change-order.ts:40` | "invalid change order: ${JSON.stringify(errors)}"
- `dto/change-order.ts:43` | "change order needs a description"
- `dto/{contract,invoice,payment-terms,payment,quote,view}.ts` | "invalid <thing>[ patch]: ${JSON.stringify(errors)}" (validators, ~2 each)
- `entrypoints/cron-controller/mod.ts:60` | "invoiceId + day∈{3,7,14,30} are required"
- `entrypoints/invoice-controller/mod.ts:62` | "discountCents must be a positive integer"
- `entrypoints/invoice-controller/mod.ts:264` | "transcript is required"
- `entrypoints/paperwork-email-controller/mod.ts:23`,`30` | "invalid dispatch: ${JSON.stringify(errors)}"
- `entrypoints/payment-terms-controller/mod.ts:60` | "?total query param must be a number, got: ${total}"
- `entrypoints/public-controller/mod.ts:72`,`81`,`90`,`99`,`687` | "invalid {accept,decline,inquiry,sign,claim} body: ${JSON.stringify(errors)}"
- `entrypoints/public-controller/mod.ts:700` | "invalid method: ${dto.method}"

### backend/src/paperwork — logs
- `coordinators/confirm-payment/mod.ts:129` | "[confirm-payment] receipt dispatch failed:"
- `coordinators/confirm-payment/mod.ts:142` | "[confirm-payment] event emit failed:"
- `coordinators/render-contract-pdf/mod.ts:746` | "[render-contract-pdf] failed to embed signature:"
- `coordinators/schedule-invoice-nudges/mod.ts:53` | "[schedule-invoice-nudges] emit failed for invoice=${inv.id}:"
- `coordinators/send-paperwork-sms/mod.ts:207` | "[send-paperwork-sms] shortlink mint failed for ${r.kind}:${r.id}; falling back to long URL:" (warn)
- `coordinators/send-payment-reminder/mod.ts:70`,`101`,`139`,`147` | "[send-payment-reminder] ... failed:" (invoice/bus/email/sms)
- `coordinators/send-signed-confirmation/mod.ts` (`:122`,`127`,`192`,`228`,`242`,`248`,`273`) | "[send-signed-confirmation] ..." (dispatch/milestone/stamp status logs)
- `entrypoints/public-controller/mod.ts:212` | "[change-orders/${id}/approve] invoice update failed:" (warn)
- `entrypoints/public-controller/mod.ts:418` | "[contracts/${id}/public] mark-viewed failed:" (warn)
- `entrypoints/public-controller/mod.ts:515` | "[contracts/${updated.id}/sign] signed-confirmation failed:"

### backend/src/users — errors
- `business/normalize-phone/mod.ts:9` | "phone must be a string"
- `business/normalize-phone/mod.ts:13` | "phone has no digits"
- `business/normalize-phone/mod.ts:18` | "phone has invalid length: ${digits.length}"
- `business/normalize-phone/mod.ts:26` | "phone has unsupported length: ${digits.length}"
- `coordinators/require-user/mod.ts:43`,`45`,`49` | UnauthorizedError() `[load-bearing code]`
- `coordinators/verify-otp/mod.ts:85`,`86`,`90` | ExpiredCodeError / RateLimitedError / InvalidCodeError `[load-bearing code]`
- `data/reference-store/mod.ts:31`,`37` | NotFoundError / ForbiddenError(PREFIX, id) `[load-bearing code]`
- `data/user-store/mod.ts:33` | "user with phone ${input.phoneNumber} already exists"
- `data/user-store/mod.ts:40` | NotFoundError("user", id) `[load-bearing code]`
- `dto/{auth,business-address,business-identity,business-insurance,contract-defaults,reference,tax-identity,user}.ts` | "invalid <thing>[ patch]: ${JSON.stringify(errors)}" (validators)
- `entrypoints/me-controller/mod.ts:41` | UnauthorizedError() `[load-bearing code]`
- `entrypoints/tax-identity-controller/mod.ts:21` | "invalid tin: ${JSON.stringify(errors)}"

### backend/src/users — logs
- `coordinators/send-otp/mod.ts:49` | "[otp:debug] code=${code} phone=${normalizedPhone}"
- `coordinators/send-otp/mod.ts:53` | "[send-otp] SMS dispatch failed for ${normalizedPhone}: ${result.reason}"
- `data/sms/mod.ts:50` | "[sms:dev-mode] would send to=${input.to} body=\"${input.body}\""
- `data/sms/mod.ts:64` | "[sms] TWILIO_FROM=\"${from}\" is not valid E.164 (...). Register a 10DLC/branded sender: https://www.twilio.com/docs/messaging/compliance/a2p-10dlc"
- `data/sms/mod.ts:53`,`54` | "TWILIO_AUTH_TOKEN not set" / "TWILIO_FROM not set" (return reasons) `[load-bearing code]`

### front-end/lib — errors & logs
- `api.ts:123` | "${method} ${path} failed: ${res.status}" (ApiError message)
- `auth.ts:86` | "/me failed: ${res.status} ${bodyName}"
- `auth.ts:113` | "[loadUser] backend lookup failed:" (log)

### front-end/islands — thrown errors
- `AsstChat.tsx:1517` | "failed to create quote"
- `AsstChat.tsx:1522` | "failed to start conversation"
- `AsstChat.tsx:1648` | "seed: failed to create stub quote"
- `AsstChat.tsx:1656` | "seed: failed to start conversation"
- `AsstChat.tsx:1887` | "no contract bound to this conversation"
- `PublicChangeOrderActions.tsx:37` | "Couldn't submit (${res.status})" (fallback; body.reason preferred)
- `PublicInvoiceClaim.tsx:107` | "Couldn't submit (${res.status})" (fallback; body.reason preferred)

### front-end/islands — chat error-banner text (`setError(...)`, AsstChat.tsx)
> Surfaced to the contractor in the chat error banner — UI-adjacent but lives in error handlers.
- `1214` "send failed" · `1535` "couldn't start" · `1551` "pick an option first" · `1596` "couldn't save job details" · `1665` "seed failed" · `1707` "couldn't advance to terms" · `1724` "contract is not ready yet" · `1739` "couldn't load the contract" · `1779` "couldn't send the invoice" · `1806` "couldn't simulate acceptance" · `1857` "couldn't save & resend" · `1900` "couldn't send the contract" · `1967`/`1987`/`2047`/`2081` "couldn't save edit" · `1999` "couldn't load customers" · `2018` "couldn't switch customer" · `2107` "couldn't lock the quote" · `2229` "wizard answer failed" · `2251` "couldn't go back a step"
- (voice errors `2386`/`2402`/`2483`/`2592` already listed in §1 AsstChat)

### front-end/islands — homeowner-facing `friendlyError()` fallbacks (bilingual)
- `PublicAcceptQuote.tsx:25`,`28` | "Esta cotización ya fue aceptada." / "Esta cotización ya fue rechazada."
- `PublicAcceptQuote.tsx:42` | "Algo salió mal — inténtalo de nuevo." / "Something went wrong — please try again."
- `PublicQuoteActions.tsx:36`,`39` | "This quote has already been accepted." / "This quote has already been declined."
- `PublicQuoteActions.tsx:53` | "Algo salió mal — inténtalo de nuevo." / "Something went wrong — please try again."

### front-end/islands & routes — logs
- `AsstChat.tsx:830` | "[asst] phase-2 job-options generation failed:" (warn)
- `AsstChat.tsx:1366` | "[asst] job-options generation failed, keeping heuristic:" (warn)
- `AsstChat.tsx:1469` | "[asst] professionalize failed, keeping text:" (warn)
- `routes/assistant/index.tsx:40` | "[/assistant?onboard=1] start failed:"
