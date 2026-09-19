# 7.6 ◩ NW-43f — The `/quotes?open=` panel gets a close/back control (S) · slug `nw-43f-quote-panel-close`

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 7.6) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

**Why.** `QuotesPage.tsx:164-201` has no close (`grep close` → 0 hits); `InvoicesPage.tsx:1145-1152` + `:415-427` is the model (X button, strips `?open=`).

- [ ] RED e2e (`quotes-copy-link.cy.ts` or a new `quotes-open-panel.cy.ts`): `cy.visit("/quotes?open=<id>")` → `[data-cy=quote-panel-close]` → panel gone and URL has no `open`.
- [ ] EDIT: copy the X button into `qopen__head`, `onClose` = `setOpenId(null)` + `history.replaceState` without `open`.

## Phase context (verbatim from the plan, `Phase 7 — Remaining medium items (no decision needed; any order; after Phases 1–5 if time is short)`)



## Source items from the triage (`new-working-issues.md`, client's words + verdict + evidence)

- **Overall tasks** [p40]
  - "My Assistant" needs to be at the top of the dashboard. On mobile you have to open the hamburger to find it, and My Assistant is everything.
    - **NW-43a ✅** `DashboardPage.tsx:433-465` (`data-cy="assistant-cta"`, plain href, pre-hydration). Test `dashboard-assistant-access.cy.ts`.
  - After quotes and signed quotes, send a completion text and email.
    - **NW-43b ◩** on accept `public-controller/mod.ts:442-512` fires `SendAcceptedAlert` (`:497`) + `SendSignedConfirmation`
      (`:118`, SMS via `shared/quote-flow/sms-i18n.ts:69-90`); receipts strip `QuotesPage.tsx:124-127,217-232`. Gap: channels depend
      on what the customer has on file (`AsstChat.tsx:698-702` both/email-only/sms-only) — "both always" would require collecting
      the missing channel before send. Tests `public-completion-notify.cy.ts`, `notifications.int.test.ts`. Effort M.
  - Make it mobile-friendly.
    - **NW-43c ◩⚠** `MobileViewport.tsx` (global), `AsstThreads.tsx:26-90` drawer dock, per-page breakpoints; four specs
      (`responsive-mobile.cy.ts`, `landing-mobile-390.cy.ts`, `ux-landing-mobile.cy.ts`, `ux-dashboard-mobile-390.cy.ts`).
      `TESTS-PROBLEMS.md:141` board ("39 specs, 200 passing") is stale — 60 specs exist now. **Needs a live Cypress run to size.**
  - PM Assistant: the hamburger menu icon does not work.
    - **NW-43d ✅ fixed** — `DashTopbar.tsx:87-91` (hydration-gated `data-cy`, "pre-hydration clicks were the 'hamburger does not
      work' bug"), desktop half `DashSidebar.tsx:137-145`.
  - Settings: make the rest editable — mailing address, insurance upload, tax W-9.
    - **NW-43e ✅** `SettingsPage.tsx:500-604` (`settings-mailing-address`), `:695-860` (`settings-insurance-upload`), `:863-970`
      (`settings-w9-upload`); controllers `business-address`, `business-insurance`, `tax-identity`, `files`. Tests `settings-editable.cy.ts`, `settings.int.test.ts`.
  - There is no back button for the steps. Needs a back button throughout so they can easily be edited.
    - **NW-43f ◩** assistant + welcome wizard done (see NW-19; `WelcomeWizard.tsx:154`); the `/quotes?open=` panel
      (`QuotesPage.tsx:124-260`) and the invoice detail panel have no back/close control. Effort S.
  - "Job Name" must be consistent across the platform. Summarize the job details into a name of three words or less.
    - **NW-43g ✅** `shared/quote-flow/job-name.ts` (`summarizeJobName`, EN/ES stopwords), single write-point `quote-store/mod.ts:36`,
      LLM clamp `polish-job-details/mod.ts:95-101,158`, language-aware reads `sms-i18n.ts:34-46`, `send-paperwork-email:505-508`.
      Tests `job-name.test.ts`, `ux-job-name-es.test.ts`, `job-name.int.test.ts`, `quotes-job-name.cy.ts`.

## Code at the cited lines (read from this tree while packaging)

### `front-end/islands/QuotesPage.tsx:164-201`

```
164:   return (
165:     <section class="qopen" data-cy="quote-open-panel">
166:       <div class="qopen__head">
167:         <div class="qopen__id">
168:           <div class="qopen__eyebrow">{tFor(lang, "quoteCard.valueLabel")}</div>
169:           <h2 class="qopen__title">{title}</h2>
170:         </div>
171:         <span
172:           class={`qopen__badge qopen__badge--${badge}`}
173:           data-cy="quote-status-badge"
174:         >
175:           {tFor(lang, `quotesPage.status.${badge}`)}
176:         </span>
177:       </div>
178:       {q.summary && q.jobName?.trim() && (
179:         <p class="qopen__summary">{q.summary}</p>
180:       )}
181:       {q.customerName && (
182:         <p class="qopen__client" style="font-size:13px;color:var(--fg-muted)">
183:           {tFor(lang, "quotesPage.open.customer", { name: q.customerName })}
184:         </p>
185:       )}
186:       <div class="qopen__meta">
187:         <div class="qopen__amount">{fmtMoney(q.estimatedTotal ?? 0)}</div>
188:         <div class="qopen__actions">
189:           <button type="button" class="qopen__btn" onClick={copyLink}>
190:             {copied
191:               ? tFor(lang, "quotesPage.open.linkCopied")
192:               : tFor(lang, "quotesPage.open.copyLink")}
193:           </button>
194:           <a
195:             class="qopen__btn"
196:             href={`/q/${q.id}`}
197:             target="_blank"
198:             rel="noopener"
199:           >
200:             {tFor(lang, "quotesPage.open.viewAsClient")}
201:           </a>
```

### `front-end/islands/InvoicesPage.tsx:1145-1152`

```
1145:         <button
1146:           type="button"
1147:           onClick={onClose}
1148:           aria-label={tFor(lang, "common.close")}
1149:           style="appearance:none;cursor:pointer;background:none;border:0;padding:4px;color:var(--fg-muted,#6b7560)"
1150:         >
1151:           <I d={ICN.x} size={16} sw={2.5} />
1152:         </button>
```

### `front-end/islands/InvoicesPage.tsx:415-427`

```
415:       {openInv && (
416:         <InvoiceDetail
417:           inv={openInv}
418:           lang={lang}
419:           onClose={() => {
420:             setOpenId(null);
421:             const url = new URL(globalThis.location.href);
422:             url.searchParams.delete("open");
423:             history.replaceState(null, "", url.toString());
424:           }}
425:           onChanged={refreshInvoices}
426:         />
427:       )}
```
