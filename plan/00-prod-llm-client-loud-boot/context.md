# 0.A ⚠ Is prod on the stub LLM? (S, but it decides the size of Phase 5)

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 0.A) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

**Why it matters.** `backend/src/agents/mod-root.ts:53-61` picks `OpenAILLMClient` only when the env var
`AGENTS_LLM_CLIENT` equals `"openai"`; otherwise it silently picks `StubLLMClient`, whose only behaviour is to echo
`"(stub) <your text>"` (`…/llm/implementations/stub/mod.ts:43-44`). That echo fails JSON parsing, so every job-options
and pricing call falls to the deterministic fallbacks — which produce *exactly* the screenshots in NW-05, NW-11 and the
unanchored prices in NW-12. Only dev sets the var (`serve.ts:42`, `backend/deno.json:3-4`). The composed prod entry
`mod.ts` never reads it, and the repo has no deploy config, no `.env.example`, no `.github`, no `Dockerfile`.
`TRANSCRIPTION_CLIENT` (voice memos, `backend/src/files/mod-root.ts:15-18`) has the identical gap.

- [ ] **Step 1 — look at the hosting dashboard.** Find where prod runs (Deno Deploy is the assumption — `mod.ts:6` talks
      about Deploy's 508 self-fetch behaviour; ask Raphael/Hans if unsure). Open the project → Settings → Environment
      variables. Write down whether each of these is present: `AGENTS_LLM_CLIENT` (must be exactly `openai`),
      `OPENAI_API_KEY`, `TRANSCRIPTION_CLIENT` (`openai`), `OPENAI_MODEL` (optional; default is `gpt-4o-mini`).
- [ ] **Step 2 — if any is missing, set it, redeploy, and re-test** with the client's exact sentence in a fresh
      conversation: chip "I know my price, write it up" → type `I need to replace a toilet for $500` → price → the three
      options must be *rewritten* scope bullets, not the sentence. If they are still the sentence, the LLM call is
      failing at runtime → read the deploy logs for `[suggest-prices] llm call failed` / the generate-job-options catch.
- [ ] **Step 3 — make the silent fall-through impossible (code, small).** Slug: `llm-client-loud-boot`.
  - [ ] RED (backend Deno unit test): create `backend/src/agents/domain/business/llm/select/test.ts` with three cases on a
        new pure function `selectLlmClientName(env: { AGENTS_LLM_CLIENT?: string; DENO_DEPLOYMENT_ID?: string })`:
        `{AGENTS_LLM_CLIENT:"openai"}` → `"openai"`; `{}` → `"stub"`; `{DENO_DEPLOYMENT_ID:"abc"}` (prod, var unset) →
        **throws** `Error("AGENTS_LLM_CLIENT must be \"openai\" in production")`. Run `cd backend && deno test -A --unstable-kv src/agents/domain/business/llm/select/test.ts` → fails "module not found".
  - [ ] Create `backend/src/agents/domain/business/llm/select/mod.ts` exporting that function (no I/O inside).
  - [ ] In `backend/src/agents/mod-root.ts:53-61` replace the `if (Deno.env.get("AGENTS_LLM_CLIENT") === "openai")` with
        `if (selectLlmClientName({ AGENTS_LLM_CLIENT: Deno.env.get("AGENTS_LLM_CLIENT"), DENO_DEPLOYMENT_ID: Deno.env.get("DENO_DEPLOYMENT_ID") }) === "openai")`.
        Keep the dynamic import as is. (When the key is absent, `OpenAILLMClient`'s constructor already throws at boot —
        `openai/mod.ts:50-53` — so prod now fails loudly instead of echoing.)
  - [ ] Do the same for `backend/src/files/mod-root.ts:15-18` (`TRANSCRIPTION_CLIENT`), reusing the helper with a second env-key argument.
  - [ ] Add `.env.example` at the repo root listing: `OPENAI_API_KEY=`, `AGENTS_LLM_CLIENT=openai`, `TRANSCRIPTION_CLIENT=openai`, `OPENAI_MODEL=gpt-4o-mini`, `APP_URL=`. One comment line each. Commit it (it holds no secrets).
  - [ ] Root `deno.json:6` `start` task: prefix with `AGENTS_LLM_CLIENT=openai TRANSCRIPTION_CLIENT=openai ` so a VM/`deno task start` deploy matches `backend/deno.json:3`.
  - [ ] GREEN: the Deno test passes; `cd backend && deno task test` still green (tests never set the var and never set
        `DENO_DEPLOYMENT_ID`, so they keep the stub). Integration `n/a — env selection happens before any HTTP`. E2E `n/a`.
- [ ] **Done when:** the dashboard shows all vars, the toilet sentence produces rewritten options in prod, and the test file exists and passes.

---

## Source items from the triage (`new-working-issues.md`, client's words + verdict + evidence)

- The AI must never echo the user's raw input back as the suggested description. (Screenshot: all three "I Need To" options just repeat "I need to replace a toile for $500".) We are the ones professionalizing the quotes. Claude and ChatGPT get this right every time. Until this is solved we cannot produce even simple quotes and invoices. [p4]
  - **NW-05 🐛 CONFIRMED in three places; the screenshot is reproducible from source, and the prod path CAN produce it.** Effort L.
  - Evidence — the echo: `backend/src/agents/domain/coordinators/generate-job-options/mod.ts:233-269` `fallbackOptions()` splits raw
    on `[\n.;]`, so "I need to replace a toile for $500" (no separators) → `base = [raw]`; opt1 = raw, opt2 = raw, opt3 = raw +
    `generateJobOptions.jobsiteCleanup` (`lang/en.json:1099`). Title: `clampJobName` (`:210-221`) takes the first three words
    title-cased → **"I Need To"**, then `versionTitle` appends " · Short version" / " · Wider scope"
    (`shared/quote-flow/version-titles.ts:44-51`). The frontend mirrors it in `AsstChat.tsx:223-251` `localFallbackOptions()` and
    **paints it first, before any server call** (`:1899-1903`, `:1936-1940`), keeping it if the request fails or the user touched
    anything (`optionsTouchedRef` `:1916`, `:1955`). `polish-job-details/mod.ts:152-160` also returns `description: raw`.
  - When it happens: (1) stub LLM — `backend/src/agents/mod-root.ts:53-61` binds `StubLLMClient` unless `AGENTS_LLM_CLIENT==="openai"`;
    the stub's `"(stub) …"` fails `tryParseJson` (`:186-203`) → `normalizeOptions` → `[]` → fallback, every time.
    `TESTS-UX-PROBLEMS.md:134-135` and `jest/integration/ux-job-name.int.test.ts:25-31` document this as the known behaviour under
    test. ⚠ Prod: root `deno.json:6` `start` does not set the var; only `backend/deno.json:3-4` and `serve.ts:40-42` do; no deploy
    config in the repo. (2) real LLM but failure/timeout: `generate-job-options/mod.ts:114-117` catch + FE catch `:1907-1913`.
    (3) healthy LLM: the echo still flashes first. (4) Prompt: `prompts.generateJobOptions` (`lang/en.json:1763`) never forbids
    verbatim output; `prompts.polishJobDetails.system` (`:1771`) literally says "mirror it back cleaned-up rather than padding".
  - Fix: (a) verify/force `AGENTS_LLM_CLIENT=openai` on the composed prod entry and fail loudly at boot when the key is absent;
    (b) rewrite both fallbacks to derive scope bullets (strip "I need to…", drop the price clause) or show an honest "couldn't
    draft — write it yourself" instead of echoing; show the `asstChat.jobOpts.writing` spinner (`:3898-3906`) instead of the
    heuristic paint; (c) add "never return the contractor's sentence verbatim" to `prompts.generateJobOptions` and delete the
    "mirror it back" clause, in both dicts.
  - Tests: none pin "no echo". `ux-job-name.int.test.ts:163,181`, `jest/unit/ux-job-name-es.test.ts`, `cypress/e2e/ux-help-me-price.cy.ts:76,88`
    *depend on* the fallback and will need updating. Same defect as NW-13 (p20).

- Confirm the "Confirm your job details" page is working correctly. (Screenshot: the three options are the raw text verbatim; "Wider scope" only adds "Jobsite cleanup".) [p20]
  - **NW-11 🐛 CONFIRMED — the screenshot is the client-side heuristic, painted before the LLM answers.** Effort M (shares NW-05).
  - Evidence: `openJobPickerForConfirm` `AsstChat.tsx:1933-1945` sets `setOptionsLoading(false)`, paints `localFallbackOptions`
    (`:223-251`: opt1 = raw bullets, opt2 = minus last, opt3 = + `asstChat.jobsiteCleanup` `lang/en.json:264`), then awaits
    `generateJobOptions` and swaps only if `!optionsTouchedRef.current`. "· Wider scope" from `shared/quote-flow/version-titles.ts:25-31`.
    Backend fallback identical (`generate-job-options/mod.ts:240-252`). Headings `lang/en.json:251-252`, rendered `:3887,3892`.
  - Fix: `setOptionsLoading(true)` at `:1936` and await before painting (spinner branch exists `:3898-3906`); keep the heuristic
    strictly as an error path and make both fallbacks honest. Tests: `cypress/e2e/quotes-help-me-price.cy.ts:39` pins flow shape only.

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

### `backend/src/agents/mod-root.ts:53-61`

```
53: async function selectLLMClass(): Promise<new () => LLMClient> {
54:   if (Deno.env.get("AGENTS_LLM_CLIENT") === "openai") {
55:     const { OpenAILLMClient } = await import(
56:       "@agents/domain/data/openai/mod.ts"
57:     );
58:     return OpenAILLMClient;
59:   }
60:   return StubLLMClient;
61: }
```

### `serve.ts:39-45`

```
39:     // outbound paperwork open a dead port.
40:     env: {
41:       PORT: String(BACKEND_PORT),
42:       AGENTS_LLM_CLIENT: "openai",
43:       APP_URL: `http://localhost:${FRONTEND_PORT}`,
44:     },
45:     color: "\x1b[36m", // cyan
```

### `backend/deno.json:3-4`

```
3:     "start": "AGENTS_LLM_CLIENT=openai TRANSCRIPTION_CLIENT=openai deno run -A --env-file=../.env --unstable-kv bootstrap/mod.ts",
4:     "dev":   "AGENTS_LLM_CLIENT=openai TRANSCRIPTION_CLIENT=openai deno run -A --env-file=../.env --watch --unstable-kv bootstrap/mod.ts",
```

### `backend/src/files/mod-root.ts:15-18`

```
15:  *   - TRANSCRIPTION_CLIENT=openai → OpenAIWhisperClient (requires OPENAI_API_KEY)
16:  *   - anything else (default)     → StubTranscriptionClient
17:  *
18:  * Mirrors the AGENTS_LLM_CLIENT switch in AgentsModule. The `start` deno
```

### `mod.ts:3-9`

```
3: 
4: // Expose the backend handler on a known global so SSR (loadUser, future
5: // route loaders) can dispatch in-process instead of self-fetching the
6: // public URL. Deno Deploy returns 508 (Loop Detected) on self-fetch from
7: // a worker, so HTTP is not an option for same-origin calls. Using a
8: // bare-import of the backend module from the front-end would pull
9: // server-only deps (decorators, openai SDK, etc.) into the Vite SSR
```

### `backend/src/agents/domain/data/openai/mod.ts:50-53`

```
50:     const apiKey = opts.apiKey ?? Deno.env.get("OPENAI_API_KEY");
51:     if (!apiKey) {
52:       throw new Error("OPENAI_API_KEY is not set; cannot use OpenAILLMClient");
53:     }
```

### `deno.json:3-9`

```
3:   "nodeModulesDir": "manual",
4:   "tasks": {
5:     "build": "cd front-end && PATH=\"$PWD/../node_modules/.bin:$PATH\" deno task build",
6:     "start": "deno serve -A --unstable-kv mod.ts",
7:     "start:local": "deno serve -A --unstable-kv --env-file=.env mod.ts",
8:     "serve": "deno run -A --unstable-kv serve.ts",
9:     "install:all": "deno run -A scripts/install-all-platforms.ts",
```

### `backend/deno.json:1-6`

```
1: {
2:   "tasks": {
3:     "start": "AGENTS_LLM_CLIENT=openai TRANSCRIPTION_CLIENT=openai deno run -A --env-file=../.env --unstable-kv bootstrap/mod.ts",
4:     "dev":   "AGENTS_LLM_CLIENT=openai TRANSCRIPTION_CLIENT=openai deno run -A --env-file=../.env --watch --unstable-kv bootstrap/mod.ts",
5:     "test": "deno test -A --unstable-kv --parallel",
6:     "wipe": "deno run -A --unstable-kv scripts/wipe.ts"
```
