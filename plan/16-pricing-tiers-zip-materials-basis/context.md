# Phase 2 — One pricing rewrite closes NW-08 + NW-09 + NW-12 (M) · slug `nw-08-09-12-pricing-tiers`

_Packaged 2026-09-18 from `new-working-issues-plan.md` (## Phase 2) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

**Goal.** "Help me price it" shows **Competitive / Market / Premium** with the client's definitions, prices for the contractor's ZIP,
and says on screen that prices include labor and materials.
**Why (all three share one prompt).** `prompts.suggestPrices` (`lang/en.json:1773`, byte-identical in `es.json:1773`) hard-codes
`basic/standard/premium` with labels, never receives a location, and never states the materials basis. `suggest-prices/mod.ts:19`
types the tier union, `:78-83` builds ids/labels positionally, `:96-98` lets the model's English `label` override the localized one
(that is the ES leak), `:126-146` are the fallback tiers. The controller `job-details-controller/mod.ts:85-99` passes only
`{userId, raw, lang}` although `BusinessAddressStore` (`postal/city/state`, `users/dto/business-address.ts:4-13`) is one injection away.
Nothing tests this call today (no Deno, jest, or Cypress file mentions it beyond counting three cards).

- [ ] **Step 1 — RED, Deno int test.** Create `backend/src/agents/domain/coordinators/suggest-prices/int.test.ts` (copy the DI setup from
      `handle-chat-message/int.test.ts:1-30`; `StubLLMClient.setHandler(fn)` lets you script the model):
  - [ ] a. handler returns `{"options":[{"tier":"competitive","priceCents":300000,"rationale":"…"},{"tier":"market",…450000},{"tier":"premium",…600000}]}`
        → result `options[i].tier` = `competitive, market, premium`; `options[i].label` = `Competitive, Market, Premium` (en) even if the handler also sent `"label":"Basic"`; `result.basis === "labor_and_materials"`.
  - [ ] b. handler records the request → the system prompt contains `labor AND materials` and the user content contains `Austin, TX 78701` when the input carries `address: { city:"Austin", state:"TX", postal:"78701" }`.
  - [ ] c. handler throws → fallback tiers with the new ids/labels and `basis` present.
  - [ ] Run `cd backend && deno test -A --unstable-kv src/agents/domain/coordinators/suggest-prices/int.test.ts` → fails (old ids).
- [ ] **Step 2 — RED, jest integration.** New `jest/integration/suggest-prices.int.test.ts`: `const s = await contractor("+15125550960")`; set the address
      (`PUT /profile/address` — `backend/src/users/entrypoints/business-address-controller/mod.ts:23-27` — body `{ city:"Austin", state:"TX", postal:"78701" }`);
      `POST /agents/job-details/prices { raw: "Paint 2000 sq ft interior, two coats" }` → 200; `body.options.map(o=>o.tier)` equals `["competitive","market","premium"]`;
      every `label` ∈ {Competitive, Market, Premium}; `body.basis === "labor_and_materials"`. (Under the stub this exercises the fallback path — that is fine, the shape is the contract.) Run → fails.
- [ ] **Step 3 — RED, e2e.** `cypress/e2e/quotes-help-me-price.cy.ts` case at `:49-56`: add `cy.get("[data-cy=pricing-option]").eq(0).should("contain.text","Competitive")`
      (`.eq(1)` Market, `.eq(2)` Premium) and `cy.get("[data-cy=pricing-basis]").should("be.visible")`. Run → fails.
- [ ] **Step 4 — RED, jest unit (dictionary).** `i18n-dictionary-consistency.test.ts`: `en["suggestPrices.tier.competitive"]`="Competitive", `market`="Market", `premium`="Premium";
      es "Competitivo" / "De mercado" / "Premium"; `en["prompts.suggestPrices"]` contains "labor AND materials" and "competitive < market < premium"; `en["prompts.suggestPrices"] === es["prompts.suggestPrices"]` (the prompt stays English in both; the ES directive key `:1774` handles language). Run → fails.
- [ ] **Step 5 — EDIT the prompt** (`lang/en.json:1773`, then paste the identical value into `lang/es.json:1773`). Replace the whole value with this (keep it as one JSON string with `\n`):

  ```
  You are a pricing assistant for a small contractor. Given a raw job description and the contractor's location, propose THREE prices the contractor can choose between.

  OUTPUT — JSON only, no prose, no code fences:
    { "options": [
      { "tier": "competitive", "priceCents": <int>, "rationale": "<≤12 words>" },
      { "tier": "market",      "priceCents": <int>, "rationale": "<≤12 words>" },
      { "tier": "premium",     "priceCents": <int>, "rationale": "<≤12 words>" }
    ] }

  TIER MEANINGS (never describe a tier as lower quality, less prep, or less work):
  - competitive: a price-conscious bid for when the job is straightforward and winning the work is the priority.
  - market: the typical professional price for this type of work in the contractor's area.
  - premium: appropriate for urgent scheduling, difficult access, higher service expectations, or other job complexity.

  RULES:
  - Exactly 3 options, ascending price: competitive < market < premium.
  - priceCents is an integer number of cents (e.g. $850.00 → 85000).
  - Prices INCLUDE labor AND materials unless the description says the customer supplies materials.
  - Price for the contractor's market: use the location line (city, state, ZIP) to set local labor and material rates. Never fall back to a national average when a location is given.
  - Work from the quantities stated (square footage, coats, openings, linear feet, fixtures, hours). Do not invent quantities. If none are given, price a typical small residential job of this type and say so in the rationale.
  - rationale is ≤12 words, plain, no hype, no emojis, and never words like "basic", "minimal", or "cheap".
  - Return JSON only.
  ```

- [ ] **Step 6 — EDIT `suggest-prices/mod.ts`:**
  - [ ] `:8-15` input gains `address?: { city?: string; state?: string; postal?: string }`.
  - [ ] `:19` → `tier: "competitive" | "market" | "premium"`; `:28-30` result gains `basis: "labor_and_materials"`.
  - [ ] `:56-62` user content → `Raw job description:\n${raw}\n\nContractor location: ${[city, state].filter(Boolean).join(", ")} ${postal ?? ""}`.trim() + langLine (omit the location line entirely when all three are empty).
  - [ ] `:78-83` `tiers = ["competitive","market","premium"]`, labels from `suggestPrices.tier.competitive|market|premium`.
  - [ ] `:96-98` **always** use `labels[out.length]` — ignore the model's `label` (the fixed label is the product; the model gives numbers and rationale).
  - [ ] `:126-146` fallback: new ids, labels, and rationales from `suggestPrices.fallback.competitiveRationale|marketRationale|premiumRationale`.
  - [ ] Return `{ options, basis: "labor_and_materials" }` from both branches.
- [ ] **Step 7 — EDIT the controller** `job-details-controller/mod.ts`: import `BusinessAddressStore` from `@profile/domain/data/business-address-store/mod.ts`, add
      `private addresses: BusinessAddressStore` to the constructor (`:66-75`), and in `suggestPrices` (`:92-98`) pass
      `address: await this.addresses.get(user.id).then(a => a ? { city: a.city, state: a.state, postal: a.postal } : undefined).catch(() => undefined)`.
      (`StartOnboardingConversation` already injects the same store, so DI resolves.)
- [ ] **Step 8 — EDIT lang keys** (both dicts): rename `suggestPrices.tier.basic→competitive`, `standard→market` (premium stays); values above. Replace the three
      `suggestPrices.fallback.*Rationale` with the client's definitions shortened: competitive "Straightforward job, priced to win the work" / market "Typical professional price in your area" / premium "For urgency, difficult access, or extra complexity"
      (es: "Trabajo sencillo, precio para ganar la obra" / "Precio profesional típico en tu zona" / "Para urgencia, acceso difícil o más complejidad").
      Add `suggestPrices.basis.laborAndMaterials`: "Prices include labor and materials" / "Los precios incluyen mano de obra y materiales".
- [ ] **Step 9 — EDIT the tier cards** `AsstChat.tsx:4782-4786`: above the `priceSuggestions === null` ternary add
      `<div data-cy="pricing-basis" class="chat__price-basis">{tFor(lang, "suggestPrices.basis.laborAndMaterials")}</div>` (style: 12px muted). The type at `:616-620` gets `tier: "competitive"|"market"|"premium"` for honesty (it is `string` today — fine to leave).
- [ ] **Step 10 — model quality (optional, same task).** `openai/mod.ts:17` defaults to `gpt-4o-mini`. If the client's $3k/$4.5k/$6k comparison still looks low after the prompt,
      set `OPENAI_MODEL=gpt-4o` in the deploy env (affects every call) — or add a `model` override on `LLMRequest` and pass `"gpt-4o"` from `SuggestPrices` only. Record which in `requirements.md`.
- [ ] **GREEN:** Steps 1-4 pass; `cd cypress && npx cypress run --spec e2e/quotes-help-me-price.cy.ts` and `e2e/ux-help-me-price.cy.ts` green.
- [ ] **Done when:** with a real key and a saved Austin address, "Paint 2000 sq ft interior, two coats, baseboards, crown, 12 door jambs, 15 windows, all ceilings" produces three cards labelled
      Competitive/Market/Premium, a visible "Prices include labor and materials" line, and numbers in the same ballpark as the client's Claude/ChatGPT comparison ($6.5k–$16k). Record the three numbers in the commit body.

---

## Source items from the triage (`new-working-issues.md`, client's words + verdict + evidence)

- The price tiers cannot be "Basic / Standard / Premium" with descriptions like "Basic paint job with minimal prep". That sounds terrible, like you'll do shit work for less money. Use the structure we settled on earlier (names may have changed): [p7]
  - **Competitive** — price-conscious bid when the job is straightforward and winning the work is the priority.
  - **Market** — typical professional price for this type of work in your area.
  - **Premium** — appropriate for urgent scheduling, difficult access, higher service expectations, or other job complexity.
  - **NW-08 🐛 NOT BUILT as specified — "Competitive"/"Market" appear nowhere in lang or backend.** Effort M.
  - Evidence: the prompt `prompts.suggestPrices` (`lang/en.json:1773`, byte-identical in `es.json:1773`) dictates
    `{ "tier": "basic", "label": "Basic" … "standard" … "premium" }` and "ascending price: basic < standard < premium".
    `backend/src/agents/domain/coordinators/suggest-prices/mod.ts:19` types `tier: "basic"|"standard"|"premium"`; `normalize()`
    `:73-104` forces ids positionally and takes the model's `label` verbatim, else `suggestPrices.tier.*` (`lang/en.json:2368-2370`
    Basic/Premium/Standard; `es` Básico/Premium/Estándar); fallback rationales `:2365-2367` ("Core scope, essentials only" /
    "Premium materials, extra finish" / "Full scope, typical materials"). `AsstChat.tsx:4793-4816` renders `t.label` + `t.rationale`
    raw — "Basic paint job with minimal prep" is LLM rationale text.
  - Fix: rewrite the prompt in both dicts with `competitive|market|premium` and the three client definitions as rationale
    guidance (better: fixed localized labels client-side, LLM supplies numbers only); rename the `suggestPrices.tier.*` /
    fallback keys; widen the union + `tiers`/`labels` arrays at `suggest-prices/mod.ts:19,75-78,124-142`. No AsstChat change.
  - Tests: `cypress/e2e/quotes-help-me-price.cy.ts:54-55` only counts three `[data-cy=pricing-option]` + custom.

- When calculating the price, are you using the Dragon's zip code? [p7]
  - **NW-09 ⬜ answered from code: NO — nothing geographic reaches the pricing call.** Effort M.
  - Evidence: `front-end/clients/assistant.ts:365-372` posts `{ raw }` only; `job-details-controller/mod.ts:84-98` passes
    `{userId, raw, lang}` (its siblings `polishDetails`/`generateOptions` *do* read `BusinessIdentityStore` at `:32-50`);
    `suggest-prices/mod.ts:7-15` input = `userId, raw, lang`; `:56-62` content = `"Raw job description:\n${raw}"`; the prompt says
    "typical US small-contractor pricing" (national). Data exists unused: `backend/src/users/dto/business-address.ts:9,19` `postal?`.
  - Fix: inject the address store into `SuggestPrices`, add zip/city/state to the input and a "price for this market" rule to
    the prompt. Tests: none.

- Price comparison for the same scope (2,000 sq ft house, two coats, baseboard and crown molding, 12 door jambs, 15 windows, all ceilings): PM offered $3,000 / $4,500 / $6,000; Claude estimated roughly $7,500–$11,600; ChatGPT estimated $6,500–$16,000. For PM I don't know whether that includes materials. That is a vital question. [p21]
  - **NW-12 🐛 answered from code: the basis is UNDEFINED — the prompt never says whether materials are included.** Effort M (L for a quantity-based estimator).
  - Evidence: `prompts.suggestPrices` (`lang/en.json:1773`) has only "Base the numbers on typical US small-contractor pricing …
    reasonable mid-market range" — no materials/labor statement. The fallback copy `lang/en.json:2366-2367` mentions "materials"
    (implying included) but the live LLM never receives that instruction. No app math: `normalize()` `suggest-prices/mod.ts:73-104`
    rounds, rejects ≤0, sorts — no multiplier. Fallback constants `:124-142` are $500/$850/$1,200 (1 : 1.7 : 2.4), which does
    **not** match 3000/4500/6000 (1 : 1.5 : 2) → the client's numbers were raw `gpt-4o-mini` output
    (`backend/src/agents/domain/data/openai/mod.ts:17` `DEFAULT_MODEL`, `OPENAI_MODEL` override). The repo itself calls that model
    unreliable for this domain (`lock-quote/mod.ts:30-32`).
  - Fix: state the basis in the prompt ("prices INCLUDE labor and materials unless the contractor says otherwise; say so in the
    rationale"), require reasoning from quantities (sq ft, coats, openings), surface the basis on the tier card; consider a
    stronger model for this call. Tests: none assert magnitude, ratio or a materials disclosure.

## Code at the cited lines (read from this tree while packaging)

### `lang/en.json:1770-1776`

```
1770:   "prompts.polishJobDetails.spanishInstruction": "Write jobName, summary, and description in neutral Latin-American Spanish.",
1771:   "prompts.polishJobDetails.system": "You polish a contractor's raw job description into clean, professional copy a customer will read on a quote.\n\nOUTPUT — return JSON only, no prose, no code fences:\n  { \"jobName\": \"<3 words or less, Title Case>\", \"summary\": \"<short title, max 8 words, title case>\", \"description\": \"<1-3 sentences, professional, third-person>\" }\n\nRULES:\n- jobName is a noun-phrase la …[truncated]
1772:   "prompts.professionalizeBullet": "You rewrite a contractor's rough scope-of-work bullet into ONE clean, professional line a customer reads on a quote.\n\nOUTPUT — return JSON only, no prose, no code fences:\n  { \"text\": \"<one clean scope line>\" }\n\nRULES:\n- One short line, roughly 3–8 words. No sentences, no trailing period.\n- Third-person scope language (\"Remove flooring, drywall & cabinets\"), never first …[truncated]
1773:   "prompts.suggestPrices": "You are a pricing assistant for a contractor. Given a raw job description,\npropose THREE price options the contractor can choose between.\n\nOUTPUT — JSON only, no prose, no code fences:\n  { \"options\": [\n    { \"tier\": \"basic\",    \"label\": \"Basic\",    \"priceCents\": <int>, \"rationale\": \"<≤10 words>\" },\n    { \"tier\": \"standard\", \"label\": \"Standard\", \"priceCents\": …[truncated]
1774:   "prompts.suggestPricesSpanishDirective": "\n\nWrite each label and rationale in neutral Latin-American Spanish.",
1775:   "prompts.systemQuote": "You are the assistant. Phase 1: quote building. The contractor is on a job site, on their phone. Friction = lost deal — move fast.\n\nDECIDE FIRST — is the user describing a job that needs a quote?\n  YES — anything with a trade verb + a noun: paint, tile, install, repair, replace,\n        remove, build, demo, mow, cut, trim, clean, pressure-wash, patch, reroof,\n        regrade, refinish,  …[truncated]
1776:   "prompts.systemTerms": "You operate this contractor's business in PHASE 2 — agreement terms.\n\nThe wizard is driving the conversation. You only respond to:\n  - Free-text 'Custom…' answers (paraphrase the picked value cleanly).\n  - Quick clarifying questions about a specific term ('what does mediation mean?').\n\nDo NOT introduce new line items, prices, or job-details changes — phase 1 is locked.\nIf the user wan …[truncated]
```

### `lang/es.json:1770-1776`

```
1770:   "prompts.polishJobDetails.spanishInstruction": "Write jobName, summary, and description in neutral Latin-American Spanish.",
1771:   "prompts.polishJobDetails.system": "You polish a contractor's raw job description into clean, professional copy a customer will read on a quote.\n\nOUTPUT — return JSON only, no prose, no code fences:\n  { \"jobName\": \"<3 words or less, Title Case>\", \"summary\": \"<short title, max 8 words, title case>\", \"description\": \"<1-3 sentences, professional, third-person>\" }\n\nRULES:\n- jobName is a noun-phrase la …[truncated]
1772:   "prompts.professionalizeBullet": "You rewrite a contractor's rough scope-of-work bullet into ONE clean, professional line a customer reads on a quote.\n\nOUTPUT — return JSON only, no prose, no code fences:\n  { \"text\": \"<one clean scope line>\" }\n\nRULES:\n- One short line, roughly 3–8 words. No sentences, no trailing period.\n- Third-person scope language (\"Remove flooring, drywall & cabinets\"), never first …[truncated]
1773:   "prompts.suggestPrices": "You are a pricing assistant for a contractor. Given a raw job description,\npropose THREE price options the contractor can choose between.\n\nOUTPUT — JSON only, no prose, no code fences:\n  { \"options\": [\n    { \"tier\": \"basic\",    \"label\": \"Basic\",    \"priceCents\": <int>, \"rationale\": \"<≤10 words>\" },\n    { \"tier\": \"standard\", \"label\": \"Standard\", \"priceCents\": …[truncated]
1774:   "prompts.suggestPricesSpanishDirective": "\n\nWrite each label and rationale in neutral Latin-American Spanish.",
1775:   "prompts.systemQuote": "You are the assistant. Phase 1: quote building. The contractor is on a job site, on their phone. Friction = lost deal — move fast.\n\nDECIDE FIRST — is the user describing a job that needs a quote?\n  YES — anything with a trade verb + a noun: paint, tile, install, repair, replace,\n        remove, build, demo, mow, cut, trim, clean, pressure-wash, patch, reroof,\n        regrade, refinish,  …[truncated]
1776:   "prompts.systemTerms": "You operate this contractor's business in PHASE 2 — contract terms.\n\nThe wizard is driving the conversation. You only respond to:\n  - Free-text 'Custom…' answers (paraphrase the picked value cleanly).\n  - Quick clarifying questions about a specific term ('what does mediation mean?').\n\nDo NOT introduce new line items, prices, or job-details changes — phase 1 is locked.\nIf the user want …[truncated]
```

### `backend/src/agents/domain/coordinators/suggest-prices/mod.ts:16-22`

```
16: 
17: export interface PriceOption {
18:   /** Stable tier id. */
19:   tier: "basic" | "standard" | "premium";
20:   /** Short customer-facing label ("Standard"). */
21:   label: string;
22:   /** Suggested price in INTEGER CENTS. */
```

### `backend/src/agents/domain/coordinators/suggest-prices/mod.ts:78-83`

```
78:   const tiers: PriceOption["tier"][] = ["basic", "standard", "premium"];
79:   const labels = [
80:     t(lang, "suggestPrices.tier.basic"),
81:     t(lang, "suggestPrices.tier.standard"),
82:     t(lang, "suggestPrices.tier.premium"),
83:   ];
```

### `backend/src/agents/domain/coordinators/suggest-prices/mod.ts:96-98`

```
96:       label: typeof o?.label === "string" && o.label.trim()
97:         ? o.label.trim()
98:         : labels[out.length],
```

### `backend/src/agents/entrypoints/job-details-controller/mod.ts:85-99`

```
85:   @Post("prices")
86:   async suggestPrices(@Context() ctx: ExecutionContext, @Body() body: unknown) {
87:     const user = await requireUser(ctx, this.sessions, this.users);
88:     const b = (body ?? {}) as { raw?: unknown };
89:     if (typeof b.raw !== "string" || !b.raw.trim()) {
90:       throw new Error("raw is required");
91:     }
92:     return ctx.json(
93:       await this.prices.run({
94:         userId: user.id,
95:         raw: b.raw,
96:         lang: user.language === "es" ? "es" : "en",
97:       }),
98:     );
99:   }
```

### `backend/src/agents/entrypoints/job-details-controller/mod.ts:126-146`

```
126:   /**
127:    * POST /agents/job-details/options
128:    * Body: { raw: string, priceCents?: number }
129:    * Returns: { options: [{ id, jobName, summary, bullets[] }] }
130:    *
131:    * Powers the "Job Details" picker screen — three editable scope-of-work
132:    * options the contractor edits and picks between before the quote is built.
133:    */
134:   @Post("options")
135:   async generateOptions(
136:     @Context() ctx: ExecutionContext,
137:     @Body() body: unknown,
138:   ) {
139:     const user = await requireUser(ctx, this.sessions, this.users);
140:     const b = (body ?? {}) as { raw?: unknown; priceCents?: unknown };
141:     if (typeof b.raw !== "string" || !b.raw.trim()) {
142:       throw new Error("raw is required");
143:     }
144:     const priceCents =
145:       typeof b.priceCents === "number" && Number.isFinite(b.priceCents)
146:         ? b.priceCents
```

### `backend/src/users/dto/business-address.ts:4-13`

```
4: export interface BusinessAddress {
5:   userId: string;
6:   street?: string;
7:   city?: string;
8:   state?: string;       // 2-letter US code
9:   postal?: string;
10:   country?: string;     // default "US"
11:   createdAt: string;
12:   updatedAt: string;
13: }
```

### `backend/src/agents/domain/coordinators/handle-chat-message/int.test.ts:1-30`

```
1: import { assert, assertEquals, assertRejects } from "#std/assert";
2: import { HandleChatMessage } from "./mod.ts";
3: import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
4: import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
5: import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";
6: import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
7: import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
8: import { UserStore } from "@users/domain/data/user-store/mod.ts";
9: import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
10: import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
11: import { FileStore } from "@files/domain/data/file-store/mod.ts";
12: import { BusinessAddressStore } from "@profile/domain/data/business-address-store/mod.ts";
13: import { SendPaperworkEmail } from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
14: import {
15:   EmailService,
16:   type SendEmailInput,
17: } from "@communication/domain/data/email-service/mod.ts";
18: import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
19: import { ConversationStore as CommConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
20: import { MessageStore as CommMessageStore } from "@communication/domain/data/message-store/mod.ts";
21: import { type DomainEvent, EventBus } from "@core/business/events/mod.ts";
22: import { getKv, resetKv } from "@core/data/kv/mod.ts";
23: 
24: /**
25:  * Seed a fully-onboarded contractor profile for `userId` so the phase-1
26:  * onboarding gate (name/business/state/address/email/payout) is satisfied
27:  * and HandleChatMessage routes the turn to the LLM instead of asking for a
28:  * missing profile field. The quote/lock/email behavior tests below are about
29:  * paperwork actions, not onboarding — they need a complete profile.
30:  *
```

### `backend/src/users/entrypoints/business-address-controller/mod.ts:23-27`

```
23:   @Put()
24:   async upsert(@Context() ctx: ExecutionContext, @Body() body: unknown) {
25:     const user = await requireUser(ctx, this.sessions, this.users);
26:     return await this.store.upsert(user.id, parseUpdateBusinessAddress(body));
27:   }
```

### `lang/es.json:8-15`

```
8:   "acceptedAlert.email.headlineJob": "¡{name} aprobó tu cotización de {job}!",
9:   "acceptedAlert.email.subject": "¡{name} aprobó tu cotización! 🎉",
10:   "acceptedAlert.email.subjectJob": "¡{name} aprobó tu cotización de {job}! 🎉",
11:   "acceptedAlert.sms.body": "{name} acaba de aprobar tu cotización. Siguiente paso: envía el contrato o la factura → {url}",
12:   "acceptedAlert.sms.bodyJob": "{name} acaba de aprobar tu cotización de {job}. Siguiente paso: envía el contrato o la factura → {url}",
13:   "activeJobs.count": "{n} activos",
14:   "activeJobs.due": "Vence {due}",
15:   "activeJobs.empty.action": "Ver embudo →",
```

### `lang/es.json:16-22`

```
16:   "activeJobs.empty.text": "Aún no hay trabajos en curso. En cuanto un cliente firme una cotización, el trabajo aparecerá aquí.",
17:   "activity.busySub": "Los monstruos han estado ocupados",
18:   "activity.emptySub": "Nada aún — tu actividad aparecerá aquí.",
19:   "activity.fullLog": "Registro completo →",
20:   "activity.title": "Lo que manejamos hoy",
21:   "appNav.ariaPrimary": "Principal",
22:   "appNav.assistant": "Asistente",
```

### `lang/es.json:28-30`

```
28:   "assistantCoachmark.dismissHint": "toca en cualquier lugar para cerrar",
29:   "assistantCoachmark.heading": "Toca aquí para hablar con tu asistente",
30:   "assistantDemo.actionCard.rowFlakes": "Escamas de color y sellado",
```

### `lang/es.json:56-62`

```
56:   "assistantDemo.chat.userGrind": "Pulido. Poliaspártico. Aquí está el piso — un par de manchas de aceite en la esquina del fondo, tenlo en cuenta.",
57:   "assistantDemo.chatHeader.backToDashboard": "Volver al panel",
58:   "assistantDemo.chatHeader.more": "Más",
59:   "assistantDemo.chatHeader.shareThread": "Compartir conversación",
60:   "assistantDemo.client": "Tom & Linda K.",
61:   "assistantDemo.continueCta.start": "Comenzar",
62:   "assistantDemo.continueCta.sub": "Pago, garantía, disputas, estado regulador — unas pocas preguntas rápidas",
```

### `lang/es.json:78-83`

```
78:   "assistantDemo.wiz.chipConfig": "Config.:",
79:   "assistantDemo.wiz.chipCustomer": "Cliente:",
80:   "assistantDemo.wiz.chipStart": "Inicio:",
81:   "assistantDemo.wiz.chipWraps": "Termina:",
82:   "assistantDemo.wiz.finalize": "Finalizar y enviar",
83:   "assistantDemo.wiz.footCount": "4 de 10 completados",
```

### `lang/es.json:96-98`

```
96:   "assistantDemo.wiz.pillStateNotices": "Avisos estatales",
97:   "assistantDemo.wiz.pillTermination": "Terminación",
98:   "assistantDemo.wiz.pillWarranty": "Garantía",
```

### `lang/es.json:126-146`

```
126:   "assistantInbox.time.eightMin": "8 min",
127:   "assistantInbox.time.mon": "Lun",
128:   "assistantInbox.time.oneHour": "1 h",
129:   "assistantInbox.time.sat": "Sáb",
130:   "assistantInbox.time.sun": "Dom",
131:   "assistantInbox.time.threeHour": "3 h",
132:   "assistantPage.assistantHelp": "¡Tu Asistente PM está aquí para ayudarte!",
133:   "assistantPage.docTitle": "Asistente · Paperwork Monster",
134:   "assistantPage.greetingDate": "Mi Asistente · siempre disponible",
135:   "assistantPage.greetingOverride": "¿En qué te puedo ayudar?",
136:   "assistantPage.newConversation": "Conversación nueva",
137:   "assistantThread.greetingDate": "Mi Asistente · siempre activo",
138:   "assistantThread.greetingFallback": "hola",
139:   "assistantThread.greetingOverride": "¿Qué puedo quitarte de encima?",
140:   "assistantThread.newConversation": "Nueva conversación",
141:   "assistantThread.pageTitle": "Asistente · Paperwork Monster",
142:   "assistantThread.phasePrefix": "Fase: {phase}",
143:   "assistantThread.statusFallback": "Cuéntale a tu asistente sobre un trabajo — por voz o texto",
144:   "asstChat.actionCard.jobDetails": "Detalles del trabajo",
145:   "asstChat.actionCard.lockIn": "Confirmar",
146:   "asstChat.actionCard.reopen": "Reabrir",
```

### `lang/es.json:66-75`

```
66:   "assistantDemo.dealBar.phaseQuote": "Cotización",
67:   "assistantDemo.dealBar.phaseSend": "Enviar",
68:   "assistantDemo.dealBar.phaseTerms": "Términos",
69:   "assistantDemo.dealBar.quoteTotal": "Total de la cotización",
70:   "assistantDemo.phaseDivider.contractTerms": "Fase 2 — Términos del contrato",
71:   "assistantDemo.suggest.net30": "\"Mejor a 30 días\"",
72:   "assistantDemo.suggest.orType": "O simplemente escribe:",
73:   "assistantDemo.suggest.reopenQuote": "Reabrir la cotización",
74:   "assistantDemo.suggest.useLastContract": "Usar el último contrato",
75:   "assistantDemo.voice.play": "Reproducir",
```

### `lang/es.json:92-98`

```
92:   "assistantDemo.wiz.optThirds": "30/30/40",
93:   "assistantDemo.wiz.optThirdsSub": "Al iniciar, a la mitad, al terminar",
94:   "assistantDemo.wiz.pillDispute": "Disputa",
95:   "assistantDemo.wiz.pillGoverning": "Estado regulador",
96:   "assistantDemo.wiz.pillStateNotices": "Avisos estatales",
97:   "assistantDemo.wiz.pillTermination": "Terminación",
98:   "assistantDemo.wiz.pillWarranty": "Garantía",
```

### `front-end/islands/AsstChat.tsx:4782-4786`

```
4782:                     {suggestPricing && (
4783:                       <div
4784:                         class="chat__price-tiers"
4785:                         style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px"
4786:                       >
```

### `front-end/islands/AsstChat.tsx:616-620`

```
616:   const [priceSuggestions, setPriceSuggestions] = useState<
617:     Array<
618:       { tier: string; label: string; priceCents: number; rationale: string }
619:     > | null
620:   >(null);
```

### `backend/src/agents/domain/data/openai/mod.ts:14-20`

```
14:   withChatTimeout,
15: } from "#quote-flow/chat-timeout.ts";
16: 
17: const DEFAULT_MODEL = "gpt-4o-mini";
18: 
19: /**
20:  * OpenAILLMClient — production adapter against OpenAI Chat Completions
```
