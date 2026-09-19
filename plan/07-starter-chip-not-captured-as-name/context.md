# 1.7 🐛 NW-47 — The starter chip text is never captured as the contractor's name (S) · slug `nw-47-first-turn-name-guard`

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 1.7) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

**Goal.** Emails/SMS never say "this is I from help me price it".
**Why.** `handle-chat-message/mod.ts:230` runs `extractNameAndBusiness(text)` on the first turn with no job-request guard (its sibling at
`:267` has `!looksLikeJobRequest(text)`). `onboarding/mod.ts:131-187` then splits "I know the job, help me price it" on ", " into
name "I know the job" + business "help me price it"; the SMS uses the first token → "I".

- [ ] RED — Deno unit test: create `backend/src/agents/domain/business/onboarding/test.ts` with `Deno.test` cases:
      `extractNameAndBusiness("I know the job, help me price it.")` → `undefined`; same for "I know my price, write it up.", "Job done, need to invoice.",
      "Just give me a quick quote." and the four Spanish chip strings (copy from `lang/es.json:354-357`); positive control
      `extractNameAndBusiness("Hans Pedersen, Hans LLC")` → `{ name: "Hans Pedersen", businessName: "Hans LLC" }`.
      Run `cd backend && deno test -A --unstable-kv src/agents/domain/business/onboarding/test.ts` → the chip cases fail.
- [ ] RED — Deno int test: `handle-chat-message/int.test.ts` add a case: fresh user, first message = "I know the job, help me price it." →
      after the turn `users.get(id).name` is still the placeholder (not "I know the job"). Run → fails.
- [ ] EDIT `onboarding/mod.ts:162-165`: after the `nameWords` checks add a stop-list guard:
      `const FIRST_WORD_STOP = new Set(["i","we","you","it","my","our","the","this","that","just","job","need","want","know","have","help","give","yo","necesito","quiero","tengo","dame","trabajo"]);`
      `if (FIRST_WORD_STOP.has(nameWords[0].toLowerCase())) return undefined;`
- [ ] EDIT `handle-chat-message/mod.ts:230`: `const userVolunteered = isFirstTurn && !looksLikeJobRequest(text) && extractNameAndBusiness(text);`
- [ ] GREEN: both Deno tests green; `cd jest && npx jest unit/ux-outbound-gate.test.ts` still green.
- [ ] Jest unit/e2e: `n/a — backend-only logic, covered by the Deno tests`.

## Source items from the triage (`new-working-issues.md`, client's words + verdict + evidence)

- The email: remove the quotation marks from the subject. I meant it should say that particular thing, not literally keep the quotes. (Screenshot also shows the contractor name rendered as "I" / "I know the job" / "I from help me price it." — the flow label is being used as the sender name.) [p44]
  - **NW-47 subject ✅ done; sender name 🐛 CONFIRMED, mechanism located and reproduces the screenshot exactly.** Effort S.
  - Subject: `lang/en.json:1575` `paperworkEmail.quote.subject` "{businessName} Quote for {customerName}, {jobName}" — no quotes;
    built `send-paperwork-email/mod.ts:505-515` via `shared/quote-flow/email-format.ts:140-144`. (`email-subject.ts` is test-only.)
  - Sender name: email uses `user.name` (`send-paperwork-email:500-505`), SMS uses its first token (`send-paperwork-sms:250-253` →
    `outbound-identity.ts:185-191`) in "Hi {hi}, this is {who} from {biz}." (`lang/en.json:1593`). Both are written by the first-turn
    onboarding branch `handle-chat-message/mod.ts:232` `const userVolunteered = isFirstTurn && extractNameAndBusiness(text);` →
    `:236-243` `users.update({name})` + `identity.upsert({businessName})` — **without the `looksLikeJobRequest` guard** its sibling
    has at `:267`. Trace of "I know the job, help me price it" through `onboarding/mod.ts:131-187`: ≤80 chars ✓, `QUOTE_SIGNAL_RE`
    (`:41-42`) has no "price" ✓, 8 words ✓, `PREFIX_RE` (`:38-39`) doesn't match "I know" ✓, `SEPARATOR_RE` splits on ", " →
    name = "I know the job" (4 tokens ≤4 ✓), business = "help me price it" (16 chars ✓) → sender "I", business "help me price it".
    Verified by reading the source in this triage.
  - Fix: `isFirstTurn && !looksLikeJobRequest(text) && extractNameAndBusiness(text)` at `:232`; reject name parts starting with a
    pronoun/verb in `onboarding/mod.ts:163-165`; block the four `asstChat.prompt.*` strings outright.
  - Tests: `email-subject.test.ts` (subject); `ux-outbound-gate.test.ts` + `outbound-*-content.cy.ts` (P-06 placeholder leak). None pin this case.

## Code at the cited lines (read from this tree while packaging)

### `backend/src/agents/domain/coordinators/handle-chat-message/mod.ts:227-233`

```
227:         const justAskedBiz = lastAskInfo.business;
228:         const justAskedState = lastAskInfo.state;
229:         const justAskedAddress = lastAskInfo.address;
230:         const userVolunteered = isFirstTurn && extractNameAndBusiness(text);
231:         const firstNameOf = (n: string | undefined): string =>
232:           n?.trim().split(/\s+/)[0] ?? "there";
233: 
```

### `backend/src/agents/domain/business/onboarding/mod.ts:131-187`

```
131: export function extractNameAndBusiness(
132:   input: string,
133: ): OnboardingExtraction | undefined {
134:   if (!input) return undefined;
135:   // Strip a single trailing `!` or `?`, but keep trailing `.` so
136:   // abbreviated business suffixes ("Co.", "Inc.", "LLC.") survive.
137:   const trimmed = input.trim().replace(/[!?]+$/, "");
138:   if (trimmed.length === 0 || trimmed.length > 80) return undefined;
139:   if (QUOTE_SIGNAL_RE.test(trimmed)) return undefined;
140: 
141:   const wordCount = trimmed.split(/\s+/).length;
142:   if (wordCount > 12) return undefined;
143: 
144:   // Strip optional "I'm / it's / call me" intros.
145:   const stripped = trimmed.replace(PREFIX_RE, "").trim();
146:   if (!stripped) return undefined;
147: 
148:   // Split on the first natural separator. Otherwise the whole string
149:   // is the name (single token or two tokens like "Diego Martinez").
150:   const sepMatch = stripped.match(SEPARATOR_RE);
151:   let namePart: string;
152:   let bizPart: string | undefined;
153:   if (sepMatch && sepMatch.index !== undefined) {
154:     namePart = stripped.slice(0, sepMatch.index).trim();
155:     bizPart = stripped.slice(sepMatch.index + sepMatch[0].length).trim();
156:   } else {
157:     namePart = stripped;
158:   }
159: 
160:   // Name validation: 1–4 tokens, each starting with a letter, no digits.
161:   // Allows "Diego", "Diego Martinez", "Tom & Linda K." (we keep the &/.).
162:   const nameWords = namePart.split(/\s+/).filter(Boolean);
163:   if (nameWords.length === 0 || nameWords.length > 4) return undefined;
164:   if (/\d/.test(namePart)) return undefined;
165:   if (!/^[A-Za-z]/.test(nameWords[0])) return undefined;
166:   // Single-token replies that match a stoplist word ("Hey", "ok",
167:   // "thanks") aren't names — bail. Multi-token names are fine.
168:   if (nameWords.length === 1 && STOP_WORDS.has(nameWords[0].toLowerCase())) {
169:     return undefined;
170:   }
171: 
172:   // Title-case single-token lowercase names ("diego" → "Diego"). Leave
173:   // multi-word names alone — the user likely typed them with their own
174:   // casing intent.
175:   const name =
176:     nameWords.length === 1 && nameWords[0] === nameWords[0].toLowerCase()
177:       ? nameWords[0][0].toUpperCase() + nameWords[0].slice(1)
178:       : namePart;
179: 
180:   // Business validation: same digit-free rule, max ~50 chars.
181:   let businessName: string | undefined;
182:   if (bizPart && bizPart.length > 0 && bizPart.length <= 50) {
183:     businessName = bizPart;
184:   }
185: 
186:   return businessName ? { name, businessName } : { name };
187: }
```

### `backend/src/agents/domain/business/onboarding/mod.ts:264-270`

```
264:     keys
265:       .flatMap((k) => (["en", "es"] as Lang[]).map((l) => askPrefix(l, k)))
266:       .filter((p) => p.length > 0),
267:   ]),
268: ) as Record<AskCategory, string[]>;
269: 
270: export interface LastAskInfo {
```

### `lang/es.json:354-357`

```
354:   "asstChat.prompt.helpPrice": "Conozco el trabajo, ayúdame a ponerle precio.",
355:   "asstChat.prompt.invoiceDone": "Trabajo terminado, necesito facturar.",
356:   "asstChat.prompt.knownPrice": "Sé mi precio, redáctalo.",
357:   "asstChat.prompt.quickQuote": "Solo dame una cotización rápida.",
```

### `backend/src/agents/domain/business/onboarding/mod.ts:162-165`

```
162:   const nameWords = namePart.split(/\s+/).filter(Boolean);
163:   if (nameWords.length === 0 || nameWords.length > 4) return undefined;
164:   if (/\d/.test(namePart)) return undefined;
165:   if (!/^[A-Za-z]/.test(nameWords[0])) return undefined;
```
