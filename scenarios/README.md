## End-to-end app scenarios

Eighty real-life scenarios for evaluating the look, feel, and functionality of Paperwork Monsters across `/dashboard`, `/assistant`, `/clients`, `/quotes`, `/contracts`, `/invoices`, `/payments`, `/settings`, and the customer-facing email + SMS flows for quotes, contracts, and invoices.

These are broader than `backend/fixtures/scenarios/` (which only exercise the assistant turn-by-turn). Each file here describes a full user or customer journey: who they are, where they enter, what they do, and what should hold true at the end.

### Schema

```jsonc
{
  "id": "kebab-case-id",
  "name": "Human-readable name",
  "description": "What this scenario exercises",
  "category": "dashboard | assistant | clients | quotes | customer-email | settings | auth | cross-page",
  "surface": ["/dashboard", "/assistant", "/clients", "/quotes", "email", "sms", "public-quote", "public-contract", "public-invoice"],
  "channel": "web-desktop | web-mobile | email | sms | mixed",
  "persona": {
    "name": "Diego Martínez",
    "role": "Owner-operator, fence + deck contractor",
    "context": "Two-truck crew. Bilingual EN/ES. Lives on his phone."
  },
  "preconditions": [
    "User is authenticated",
    "Account has 4 quotes in pipeline"
  ],
  "steps": [
    {
      "actor": "user | customer | system",
      "action": "what they do or what the system does",
      "expect": "what should be visible / true after this step"
    }
  ],
  "emails": [
    {
      "to": "customer@example.com",
      "trigger": "user clicks Send",
      "subject": "Your quote from Diego — Patel fence",
      "linksTo": "public-quote",
      "expect": "Brand colors render in major mail clients; CTA button is tappable on mobile"
    }
  ],
  "evaluationCriteria": [
    { "aspect": "look",          "check": "..." },
    { "aspect": "feel",          "check": "..." },
    { "aspect": "functionality", "check": "..." },
    { "aspect": "accessibility", "check": "..." }
  ]
}
```

`emails` is optional — only present when a scenario crosses into a customer touchpoint.

### Index

| #   | File                                                | Surface                  |
| --- | --------------------------------------------------- | ------------------------ |
| 01  | `01-dashboard-first-login-empty.json`               | /dashboard               |
| 02  | `02-dashboard-kpi-overview.json`                    | /dashboard               |
| 03  | `03-dashboard-live-activity.json`                   | /dashboard               |
| 04  | `04-dashboard-cmdk-search.json`                     | /dashboard               |
| 05  | `05-dashboard-notifications-drawer.json`            | /dashboard               |
| 06  | `06-assistant-first-quote-text.json`                | /assistant               |
| 07  | `07-assistant-voice-spanish-mix.json`               | /assistant               |
| 08  | `08-assistant-existing-customer-link.json`          | /assistant               |
| 09  | `09-assistant-vague-then-clarified.json`            | /assistant               |
| 10  | `10-assistant-lock-and-terms.json`                  | /assistant               |
| 11  | `11-assistant-add-line-mid-draft.json`              | /assistant               |
| 12  | `12-assistant-discount-applied.json`                | /assistant               |
| 13  | `13-assistant-emergency-rush.json`                  | /assistant               |
| 14  | `14-assistant-recurring-monthly.json`               | /assistant               |
| 15  | `15-assistant-large-commercial.json`                | /assistant               |
| 16  | `16-assistant-typos-shorthand.json`                 | /assistant               |
| 17  | `17-assistant-cancel-mid-quote.json`                | /assistant               |
| 18  | `18-assistant-thread-switching.json`                | /assistant               |
| 19  | `19-assistant-mobile-keyboard.json`                 | /assistant (mobile)      |
| 20  | `20-assistant-status-question.json`                 | /assistant               |
| 21  | `21-clients-loop-followup.json`                     | /clients                 |
| 22  | `22-clients-segments-filter.json`                   | /clients                 |
| 23  | `23-clients-top-clients-leaderboard.json`           | /clients                 |
| 24  | `24-clients-add-private-note.json`                  | /clients                 |
| 25  | `25-clients-mobile-card-view.json`                  | /clients (mobile)        |
| 26  | `26-quotes-pipeline-overview.json`                  | /quotes                  |
| 27  | `27-quotes-stale-nudge.json`                        | /quotes                  |
| 28  | `28-quotes-opens-spike.json`                        | /quotes                  |
| 29  | `29-quotes-win-rate-side.json`                      | /quotes                  |
| 30  | `30-quotes-empty-state-new-user.json`               | /quotes                  |
| 31  | `31-customer-receives-quote-email.json`             | email → public-quote     |
| 32  | `32-customer-accepts-quote.json`                    | public-quote             |
| 33  | `33-customer-rejects-quote-with-feedback.json`      | public-quote             |
| 34  | `34-customer-asks-question-on-quote.json`           | public-quote             |
| 35  | `35-customer-signs-contract.json`                   | email → public-contract  |
| 36  | `36-customer-pays-deposit-invoice.json`             | email → public-invoice   |
| 37  | `37-customer-pays-final-invoice.json`               | email → public-invoice   |
| 38  | `38-customer-late-payment-reminder.json`            | email                    |
| 39  | `39-otp-login-returning-user.json`                  | auth                     |
| 40  | `40-cross-page-quote-to-cash.json`                  | cross-page (full funnel) |
| 41  | `41-assistant-name-onboarding-new-user.json`              | /assistant (P1.1)        |
| 42  | `42-assistant-name-onboarding-skipped.json`               | /assistant (P1.1)        |
| 43  | `43-assistant-name-onboarding-volunteered-with-quote.json`| /assistant (P1.1)        |
| 44  | `44-assistant-voice-realtime-streaming-transcript.json`   | /assistant (voice)       |
| 45  | `45-assistant-voice-cancel-mid-recording.json`            | /assistant (voice)       |
| 46  | `46-assistant-voice-permission-denied-fallback.json`      | /assistant (voice)       |
| 47  | `47-customer-declines-quote-with-price-reason.json`       | public-quote             |
| 48  | `48-customer-asks-question-roundtrip.json`                | public-quote → /dashboard|
| 49  | `49-contractor-bell-shows-customer-inquiry.json`          | /dashboard               |
| 50  | `50-sidebar-count-badge-on-quote-send.json`               | /dashboard sidebar       |
| 51  | `51-dashboard-skeleton-on-cold-load.json`                 | every authed page        |
| 52  | `52-settings-page-reflects-onboarded-name.json`           | /settings                |
| 53  | `53-public-quote-brand-falls-back-without-name.json`      | public-quote             |
| 54  | `54-assistant-second-quote-same-thread.json`              | /assistant               |
| 55  | `55-composer-draft-persists-after-reload.json`            | /assistant               |
| 56  | `56-thread-resume-after-overnight-gap.json`               | /assistant               |
| 57  | `57-messages-redirect-toast-from-old-link.json`           | /messages → /assistant   |
| 58  | `58-logout-clears-session-from-any-page.json`             | auth (every page)        |
| 59  | `59-public-quote-shows-declined-pill-after-revisit.json`  | public-quote             |
| 60  | `60-onboarding-then-first-quote-capstone.json`            | cross-page (P1.1 funnel) |
| 61  | `61-payments-hero-with-history.json`                      | /payments                |
| 62  | `62-payments-sparkline-empty-state.json`                  | /payments                |
| 63  | `63-payments-record-cta-deeplink.json`                    | /payments → /assistant   |
| 64  | `64-invoices-empty-state-fresh-account.json`              | /invoices                |
| 65  | `65-contracts-zero-state-copy.json`                       | /contracts               |
| 66  | `66-dashboard-outstanding-no-stray-divider.json`          | /dashboard               |
| 67  | `67-sidebar-identity-contrast-on-every-page.json`         | every authed page        |
| 68  | `68-cents-migration-restores-public-quote.json`           | public-quote/contract/invoice |
| 69  | `69-quotes-track-expand-state-after-rerender.json`        | /quotes                  |
| 70  | `70-dashboard-activity-realtime-on-send.json`             | /dashboard ↔ /assistant  |
| 71  | `71-settings-phone-update-propagates.json`                | /settings → public-quote |
| 72  | `72-public-quote-print-to-pdf.json`                       | public-quote             |
| 73  | `73-public-invoice-apple-pay-ios.json`                    | public-invoice (iOS)     |
| 74  | `74-assistant-record-payment-manual.json`                 | /assistant → /payments   |
| 75  | `75-quote-revision-after-rejection.json`                  | /assistant → public-quote|
| 76  | `76-customer-sms-only-payment.json`                       | sms → public-invoice     |
| 77  | `77-assistant-tablet-portrait-layout.json`                | /assistant (tablet)      |
| 78  | `78-assistant-offline-message-queue.json`                 | /assistant (offline)     |
| 79  | `79-mobile-public-quote-pinch-zoom.json`                  | public-quote (mobile)    |
| 80  | `80-quotes-csv-export.json`                               | /quotes                  |
