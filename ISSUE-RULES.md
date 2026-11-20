# What counts as a real issue (REQ-621)

One rule, used by the demo testers when they report and by the judge when it decides what gets fixed. Raphael, 2026-11-12: "What is the line between a nitpick? What is pedantic? And what is a real suggestion? Because even feature requests, sometimes are features that are missing from the product."

Take the issue through the questions **in this order. The first one that matches wins.** Nothing a user would notice can be called a nitpick, because those questions come first.

| # | Category | Ask | Action |
|---|---|---|---|
| 1 | `NOT_REAL` | Did the agent err, or did the test setup cause it, while the app behaved correctly? You must prove the app was right. If the screen *invited* the mistake, skip this row: it is a bug in the design, below. | drop |
| 2 | `BUG_CONTRADICTION` | Does the product break its own promise or disagree with itself? A promise in its own screens, landing page, settings, emails, assistant replies or requirements.md is not kept; or two places disagree on a price, saved data, a status, a count or a name. | fix |
| 3 | `BUG_HARM` | Is money, a signed document, what the customer receives, or stored data wrong, lost or unsafe? Includes accepting absurd input that then reaches money or a customer. | fix (major or higher) |
| 4 | `MISSING_IN_FLOW` | Does a contractor doing an ordinary task for their trade hit a dead end, or have to leave the app or work around it, and the fix fits inside an existing screen or flow? (a reminder button on an unpaid invoice, asking the deposit amount) | fix |
| 5 | `MISSING_NEW_AREA` | Same as 4, but the fix is a new area of the product (a time clock, a card processor, a new role system). | owner list, with a rough size |
| 6 | `BUG_POLISH` | Would someone see it without looking for it? Clipping, overlap, a colour that means the wrong thing, flicker or blank flashes, the wrong language, confusing or wrong wording, misalignment, a label that lies. | fix |
| 7 | `OWNER_CALL` | Was the current behaviour chosen on purpose (a requirement says so), yet a user is hurt by it? | owner list, with both sides |
| 8 | `NITPICK` | It works, it matches the rest of the app, and it is clear. The complaint is only a preference for another reasonable design. | log, don't fix |
| 9 | `PEDANTIC` | It is only visible in devtools or the source, or only under a reading of the spec that no user would hit, and it changes nothing for anyone. | drop |

## How to apply it

- **Testers:** tag every issue you report with one category from the table (for example `[BUG_POLISH]`) and add one line on why. Still report your NITPICK and PEDANTIC findings, tagged as such. The judge decides; your tag is your best first call.
- **Judge:** decide every issue yourself against this table, even when an earlier step called it "not a bug" or "a feature request". Quote the evidence that settles it. For `NOT_REAL`, name what proves the app was right. For `NITPICK`, say why it is already clear and consistent. For `MISSING_NEW_AREA`, give a size (S: under a day, M: a few days, L: more).
- Severity (blocker / major / minor / polish) is separate from category. A `BUG_POLISH` can be minor; a `BUG_HARM` is at least major.

## Examples from this loop

- `NOT_REAL`: "Pair 6 employee typed '80' for $180": the field showed 80, so the app did exactly what was typed.
- Not `NOT_REAL`, design bug: "Pair 2 customer pressed 'Emitir factura' instead of 'Cancelar'" when the two buttons look alike and sit side by side.
- `BUG_CONTRADICTION`: the plan step contradicts the landing page's 30-day trial and $99 price. Settings shows empty Street/State that onboarding saved. "Business identity: Nothing set yet." while a name is set.
- `BUG_HARM`: "Make it around $18,000" multiplied every line by 10. A signed agreement's payment terms changed after signature. A $99,999,999 invoice with no customer was marked Sent.
- `MISSING_IN_FLOW`: no "send reminder" on an unpaid invoice that is not yet overdue. "Deposit + balance" silently uses 20% and never asks.
- `MISSING_NEW_AREA`: no time clock for hourly workers. No built-in card processor.
- `BUG_POLISH`: the "Alex" pointer label is clipped to "ex". An avatar overlaps a label. Red chips mark positive states. Assistant replies never stream, with no typing indicator.
- `OWNER_CALL`: the customer is not asked before a demo attaches (deliberate, REQ-300).
- `NITPICK`: "I'd put the Save button on the left", when the right matches every other form in the app.
- `PEDANTIC`: a console-only warning with no visible effect.
