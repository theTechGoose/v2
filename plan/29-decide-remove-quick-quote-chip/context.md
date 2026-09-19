# 6.2 ❓ NW-03 + NW-38 — Remove "Just give me a quick quote"? (S) · slug `nw-38-remove-quick-quote-chip`

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 6.2) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

It is byte-identical to "I know my price" except the greeting (`AsstChat.tsx:3225-3251`); p35 says "REMOVE THIS", p65's verified copy expects three boxes and four render.

- If **remove** (recommended):
  - [ ] RED unit: `jest/unit/assistant-contracts.test.ts:143-158` → change `KEYS` to the three remaining chips and add `it("REQ-NNN NW-38 quickQuote is not a starter chip")` asserting `chipIntent` throws/undefined for it. RED e2e: `cypress/e2e/quotes-help-me-price.cy.ts:79-85` → replace the `it.skip` with `it("REQ-NNN exactly three starter chips")` → `cy.get("button.chat__empty-prompt").should("have.length", 3)`.
  - [ ] EDIT: delete `AsstChat.tsx:4886-4892` (button) and `:3243-3251` (`startQuickQuoteFlow`); in `shared/quote-flow/starter-chips.ts` drop `"quickQuote"` from `ChipKey` (`:13`), `INTENTS` (`:18`), both `REPLIES` (`:31-32`, `:41-42`); delete `asstChat.prompt.quickQuote` (`lang/*.json:357`); fix the `flowChip` union in `AsstChat.tsx` where TypeScript complains. Keep `quick-quote-prefill.ts` (used by the other starters at `:2439`).
- If **keep**: the client must say what it does differently; then it is a new feature (out of this plan).

## Phase context (verbatim from the plan, `Phase 6 — ❓ Decisions the client must make, with the work each answer unlocks`)

Send §10 (the message at the bottom) to the client. Do not start these tasks until the answer is back; everything above is unblocked meanwhile.

## Source items from the triage (`new-working-issues.md`, client's words + verdict + evidence)

- **NW-03 / NW-38:** "Just give me a quick quote" is byte-identical to "I know my price" (only the greeting differs) and is still
  live despite "REMOVE THIS."

- What is the difference between "Just give me a quick quote" and "I know my price, write it up"? [p25]
  - **NW-03 ❓ PRODUCT QUESTION — answered: there is no difference.** Effort S to remove.
  - Evidence: `AsstChat.tsx:3225-3251` `startKnownPriceFlow` and `startQuickQuoteFlow` are identical except `setFlowChip(...)`;
    the comment at `:3219-3224` says "Per roadmap p.11 the two are merged". `flowChip` is read only to pick the greeting bubble
    (`:4335-4347`) and for invoice chips (`:4371`); `submitJobDetails` branches only on `suggestPricing` (`:2440-2451`), false for
    both. Greetings: `shared/quote-flow/starter-chips.ts:22-45` (knownPrice "Great — you know your price…", quickQuote "Quick quote
    coming up…"); the intents at `:16-21` are never consumed. Its own header says "today a dup of knownPrice" (`:9-11`).
    Chip still live: `AsstChat.tsx:4886-4892`, `asstChat.prompt.quickQuote` (`lang/en.json:357` / `es.json:357`). Logged open in
    `TDD-QUOTE-FLOW.md:44` row 21; `cypress/e2e/quotes-help-me-price.cy.ts:79-85` is an `it.skip("[DECIDE p17]…")`.
  - Fix (if "REMOVE THIS" on p35 stands, see NW-38): delete the button, the handler, the `quickQuote` entries in `starter-chips.ts`,
    and the lang key; update `jest/unit/assistant-contracts.test.ts:143-160` (pins four chips) and the skipped Cypress case.

- "We need to build out the Just give me a quick quote" with "REMOVE THIS." written over it. [p35]
  - **NW-38 ⬜ removal not done — chip live** (`AsstChat.tsx:4886-4892`, `startQuickQuoteFlow` `:3236-3251`, `starter-chips.ts:14,20,32-34,44-45`,
    `asstChat.prompt.quickQuote` `lang/*.json:357`). Keep `shared/quote-flow/quick-quote-prefill.ts` — also used by the other
    starters via `AsstChat.tsx:2439`. See NW-03. Effort S.

- New Conversation copy: "Your PM Assistant is here to help! Click on a box or the text field below to get started!" with the three options and "Not sure? Just tell me about the job." [p65]
  - **◩ PARTIAL** copy matches (`lang/en.json:219,232,167`); **four** boxes render, not three (`AsstChat.tsx:4872-4899`) — the quick-quote chip, NW-38.

## Code at the cited lines (read from this tree while packaging)

### `front-end/islands/AsstChat.tsx:3225-3251`

```
3225:   function startKnownPriceFlow() {
3226:     pushHistory();
3227:     setFlowChip("knownPrice");
3228:     setSuggestPricing(false);
3229:     setPriceSuggestions(null);
3230:     setPendingJobDetailsRaw(null);
3231:     setAwaitingJobDetails(true);
3232:     // Synchronous focus inside the user gesture so iOS Safari pops the
3233:     // keyboard. The effect at the awaitingJobDetails mount is a fallback.
3234:     taRef.current?.focus();
3235:   }
3236: 
3237:   /**
3238:    * "Just give me a quick quote." — mechanically the same details-first
3239:    * capture as the known-price starter, but it is its OWN entry point so the
3240:    * chip gets its own intent-appropriate first reply (P-20: the four chips
3241:    * used to share one canned bubble).
3242:    */
3243:   function startQuickQuoteFlow() {
3244:     pushHistory();
3245:     setFlowChip("quickQuote");
3246:     setSuggestPricing(false);
3247:     setPriceSuggestions(null);
3248:     setPendingJobDetailsRaw(null);
3249:     setAwaitingJobDetails(true);
3250:     taRef.current?.focus();
3251:   }
```

### `jest/unit/assistant-contracts.test.ts:143-158`

```
143:   it("P-20 the four chips map to pairwise-distinct intents", () => {
144:     const intents = KEYS.map((k) => chips.chipIntent(k));
145:     expect(new Set(intents).size).toBe(KEYS.length);
146:   });
147: 
148:   it("P-20 the invoice chip's intent is about invoicing, not a quote", () => {
149:     const intent = String(chips.chipIntent("invoiceDone"));
150:     expect(intent).toMatch(/invoice/i);
151:     expect(intent).not.toMatch(/quote|cotiz/i);
152:   });
153: 
154:   it("P-20 the four ES chip replies are pairwise distinct (not one canned reply)", () => {
155:     const replies = KEYS.map((k) => chips.chipReply(k, "es"));
156:     replies.forEach((r) => expect(typeof r).toBe("string"));
157:     expect(new Set(replies).size).toBe(KEYS.length);
158:   });
```

### `cypress/e2e/quotes-help-me-price.cy.ts:79-85`

```
79: describe("assistant — Just give me a quick quote", () => {
80:   // PDF p17: the product decision is open — "We need to see how this option
81:   // could work". Do not invent behavior; unskip once the flow is decided.
82:   it.skip("[DECIDE p17] quick-quote flow is distinct from 'I know my price, write it up.'", () => {
83:     // Intentionally unimplemented.
84:   });
85: });
```

### `front-end/islands/AsstChat.tsx:4886-4892`

```
4886:                     <button
4887:                       type="button"
4888:                       class="chat__empty-prompt"
4889:                       onClick={startQuickQuoteFlow}
4890:                     >
4891:                       {tFor(lang, "asstChat.prompt.quickQuote")}
4892:                     </button>
```

### `front-end/islands/AsstChat.tsx:3243-3251`

```
3243:   function startQuickQuoteFlow() {
3244:     pushHistory();
3245:     setFlowChip("quickQuote");
3246:     setSuggestPricing(false);
3247:     setPriceSuggestions(null);
3248:     setPendingJobDetailsRaw(null);
3249:     setAwaitingJobDetails(true);
3250:     taRef.current?.focus();
3251:   }
```

### `front-end/islands/AsstChat.tsx:10-16`

```
10:   assistantClient,
11:   type CustomerLite,
12:   type JobOption,
13:   type Message,
14:   type Quote as AsstQuote,
15: } from "../clients/assistant.ts";
16: import { filesClient } from "../clients/files.ts";
```

### `front-end/islands/AsstChat.tsx:15-21`

```
15: } from "../clients/assistant.ts";
16: import { filesClient } from "../clients/files.ts";
17: import { quotesClient } from "../clients/quotes.ts";
18: import { clientsClient } from "../clients/clients.ts";
19: import { readCached, refreshDash, subscribeDash } from "../lib/dash-cache.ts";
20: import { type Lang, langSignal, tFor } from "../lib/i18n.ts";
21: import { localizeTermValue } from "../lib/term-i18n.ts";
```

### `front-end/islands/AsstChat.tsx:31-32`

```
31: } from "../../shared/quote-flow/assistant-back.ts";
32: import {
```

### `front-end/islands/AsstChat.tsx:41-42`

```
41:   extractQuickQuotePrefill,
42: } from "../../shared/quote-flow/quick-quote-prefill.ts";
```

### `front-end/islands/AsstChat.tsx:2436-2442`

```
2436:     // UX-04/UX-32: the sentence often already answers the next questions
2437:     // ("…para la familia Nguyen, $3,700 todo incluido") — seed the price
2438:     // picker and the customer step instead of asking again from $0.
2439:     const prefill = extractQuickQuotePrefill(trimmed);
2440:     if (prefill.priceCents && !suggestPricing) {
2441:       setPriceCents(prefill.priceCents);
2442:     }
```
