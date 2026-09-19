# 5.1 Honest scope bullets from raw text (pure helper, both fallbacks) (M) · slug `nw-05-scope-from-raw`

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 5.1) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

- [ ] RED — jest unit: new `jest/unit/scope-from-raw.test.ts` for a new module `shared/quote-flow/scope-from-raw.ts` exporting `scopeBulletsFromRaw(raw: string, lang: "en"|"es"): { bullets: string[]; degraded: boolean }`:
  - [ ] `"I need to replace a toile for $500"` → bullets `["Replace a toile"]` (intent prefix "I need to" removed, price clause removed, first letter capitalized, no trailing period), `degraded:false`.
  - [ ] `"Necesito cambiar 12 tablas del deck por $900"` → `["Cambiar 12 tablas del deck"]`.
  - [ ] `"Customer wants a 10x10 slab, what should I charge?"` → `["10x10 slab"]` (question tail removed).
  - [ ] `"paint fence; haul debris\nclean up"` → three bullets.
  - [ ] `"ok"` (nothing left after stripping) → `bullets: []`, `degraded: true`.
  - [ ] Invariant on every case: no bullet `=== raw.trim()`, no bullet contains `$`, none starts with `/^(I|we|necesito|quiero)\b/i`.
      Run `cd jest && npx jest unit/scope-from-raw.test.ts` → fails (module missing).
- [ ] RED — Deno int test `generate-job-options/int.test.ts` (new; DI like `handle-chat-message/int.test.ts`, use `StubLLMClient.setHandler`):
      (a) handler throws → options exist, no bullet equals the raw sentence, none contains "$500", `result.degraded === true`; (b) handler returns valid JSON → passthrough, `degraded` false;
      (c) default stub echo `"(stub) …"` → same as (a). And `polish-job-details/int.test.ts`: fallback `description` is the joined bullets, not `raw`.
- [ ] EDIT `shared/quote-flow/scope-from-raw.ts`: strip `^(i|we|customer|client|they)\s+(need|needs|want|wants)\s+(to\s+)?` and es `^(necesito|necesitamos|quiero|queremos|el cliente quiere)\s+`, strip `(for|por|,)?\s*\$\s?[\d,]+(\.\d+)?(\s*(total|todo incluido))?`, strip `,?\s*what should I charge\??$`, split on `[\n;.]`, capitalize, dedupe; `degraded` when no bullet survives.
- [ ] EDIT `generate-job-options/mod.ts:236-272`: `base = scopeBulletsFromRaw(raw, primary).bullets` (fallback to `[t(lang,"generateJobOptions.newJob")]` when degraded); return `degraded: true` on the fallback path (add to the result type and the controller response). Import via `#quote-flow/scope-from-raw.ts`.
- [ ] EDIT `polish-job-details/mod.ts:152-161`: `description: scopeBulletsFromRaw(raw, lang).bullets.join("\n") || raw`.
- [ ] GREEN: unit + Deno; `cd jest && npx jest integration/ux-job-name.int.test.ts` (dev server up) still green — if a job-name expectation changed, decide per case whether the new name is better (it should be identical for inputs without a prefix or price).

## Phase context (verbatim from the plan, `Phase 5 — Never echo the contractor's sentence back (root cause #6) — closes NW-05, NW-11 (L) — **do Phase 0 first**`)

**Why.** Three places echo raw text: backend `generate-job-options/mod.ts:236-272` `fallbackOptions` (bullets = the raw sentences; `clampJobName` `:212-220`
→ "I Need To"), backend `polish-job-details/mod.ts:152-161` (`description: raw`), and front-end `AsstChat.tsx:223-252` `localFallbackOptions`, which
is painted **before** the request at `:1898-1903` and `:1937-1942` (`setOptionsLoading(false)` first, so the "Writing up your options…" spinner at
`:3896-3906` is dead). The prompt `prompts.polishJobDetails.system` (`lang/*.json:1771`) even says "mirror it back cleaned-up". Under the stub LLM
(Phase 0) every call takes this path; under a real key it still flashes first and still happens on timeout.

Tests that currently *depend* on the echo and must keep passing or be consciously updated: `jest/integration/ux-job-name.int.test.ts:153-191`
(they assert job names that are word-windows of the input — they survive if the rewrite only strips intent prefixes and price clauses),
`jest/unit/ux-job-name-es.test.ts` (pure, unaffected), `cypress/e2e/ux-help-me-price.cy.ts:71` (waits 20 s for `[data-cy=confirm-details]` — still fine).

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

## Code at the cited lines (read from this tree while packaging)

### `backend/src/agents/domain/coordinators/generate-job-options/mod.ts:236-272`

```
236: function fallbackOptions(raw: string, langs: Lang[]): JobOption[] {
237:   const lines = raw
238:     .split(/[\n.;]+/)
239:     .map((l) => l.trim().replace(/\s+/g, " "))
240:     .filter((l) => l.length > 0);
241:   const base = (lines.length > 0 ? lines : [raw.trim()]).slice(0, 4);
242: 
243:   const perLang = (lang: Lang, variant: 0 | 1 | 2): JobOptionLang => {
244:     const summary = clampSummary(base[0] || t(lang, "generateJobOptions.newJob"));
245:     const jobName = deriveJobName(summary, lang);
246:     const bullets = variant === 0
247:       ? base
248:       : variant === 1
249:       ? base.slice(0, 3)
250:       : [...base.slice(0, 3), t(lang, "generateJobOptions.jobsiteCleanup")]
251:         .slice(0, 4);
252:     // P-24: the three fallback variants get honest, localized qualifiers
253:     // ("· Versión breve" / "· Alcance ampliado") instead of "(2)" / "(3)",
254:     // which read as duplicates rather than versions.
255:     return {
256:       jobName: versionTitle(
257:         jobName,
258:         variant === 0 ? "full" : variant === 1 ? "short" : "wider",
259:         lang,
260:       ),
261:       summary,
262:       bullets,
263:     };
264:   };
265: 
266:   const primary = langs[0];
267:   return ([0, 1, 2] as const).map((variant) => {
268:     const byLang: Record<string, JobOptionLang> = {};
269:     for (const l of langs) byLang[l] = perLang(l, variant);
270:     return { id: `opt${variant + 1}`, ...byLang[primary], byLang };
271:   });
272: }
```

### `backend/src/agents/domain/coordinators/polish-job-details/mod.ts:152-161`

```
152: function fallback(raw: string, lang: "en" | "es"): PolishJobDetailsResult {
153:   const firstLine = raw.split(/\n/)[0].trim();
154:   const summaryWords = clampSummary(firstLine);
155:   const summary = summaryWords || t(lang, "polishJobDetails.fallbackSummary");
156:   return {
157:     summary,
158:     jobName: deriveJobName(summary, lang),
159:     description: raw,
160:   };
161: }
```

### `backend/src/agents/domain/coordinators/generate-job-options/mod.ts:212-220`

```
212: function clampJobName(s: string, lang: Lang): string {
213:   if (lang === "es") return summarizeJobName(s, "es");
214:   const cleaned = s.trim().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(
215:     /\s+/g,
216:     " ",
217:   );
218:   const words = cleaned.split(" ").filter(Boolean).slice(0, 3);
219:   return words.map(titleCaseWord).join(" ");
220: }
```

### `front-end/islands/AsstChat.tsx:223-252`

```
223: function localFallbackOptions(raw: string, lang: Lang): JobOption[] {
224:   const lines = raw
225:     .split(/[\n.;]+/)
226:     .map((l) => l.trim().replace(/\s+/g, " "))
227:     .filter(Boolean);
228:   const base = (lines.length > 0 ? lines : [raw.trim()]).slice(0, 4);
229:   const summary = base[0]?.split(/\s+/).slice(0, 8).join(" ") ||
230:     tFor(lang, "asstChat.newJob");
231:   const jobName = summary.split(/\s+/).slice(0, 3).join(" ");
232:   // P-24: the three versions must be distinguishable at a glance. They used
233:   // to share one jobName verbatim (and the server's old scheme numbered the
234:   // collisions "(2)" / "(3)"), so the picker looked like the same job three
235:   // times. Each variant now carries the qualifier that describes what it IS.
236:   return [
237:     { id: "opt1", jobName, summary, bullets: base },
238:     {
239:       id: "opt2",
240:       jobName: versionTitle(jobName, "short", lang),
241:       summary,
242:       bullets: base.slice(0, 3),
243:     },
244:     {
245:       id: "opt3",
246:       jobName: versionTitle(jobName, "wider", lang),
247:       summary,
248:       bullets: [...base.slice(0, 3), tFor(lang, "asstChat.jobsiteCleanup")]
249:         .slice(0, 4),
250:     },
251:   ];
252: }
```

### `front-end/islands/AsstChat.tsx:1898-1903`

```
1898:     setOptionsLoading(false);
1899:     const heuristic = toOptionDrafts(
1900:       localFallbackOptions(raw || tFor(lang, "asstChat.newJob"), lang),
1901:     );
1902:     setJobOptions(heuristic);
1903:     setSelectedOptionId(heuristic[0]?.id ?? null);
```

### `front-end/islands/AsstChat.tsx:1937-1942`

```
1937:     setOptionsLoading(false);
1938:     const heuristic = toOptionDrafts(
1939:       localFallbackOptions(raw || tFor(lang, "asstChat.newJob"), lang),
1940:     );
1941:     setJobOptions(heuristic);
1942:     setSelectedOptionId(heuristic[0]?.id ?? null);
```

### `front-end/islands/AsstChat.tsx:3896-3906`

```
3896:                     {optionsLoading || !jobOptions
3897:                       ? (
3898:                         <div class="chat__jobopts-loading">
3899:                           <span class="chat__details-dots" aria-hidden="true">
3900:                             <span></span>
3901:                             <span></span>
3902:                             <span></span>
3903:                           </span>
3904:                           {tFor(lang, "asstChat.jobOpts.writing")}
3905:                         </div>
3906:                       )
```

### `jest/integration/ux-job-name.int.test.ts:153-191`

```
153:   it("UX-26(c): the polish step never yields 'Pintar La Sala' — the SMS job name source", async () => {
154:     const { status, body } = await s.post("/agents/job-details/polish", {
155:       raw: "pintar la sala y el comedor",
156:     });
157:     expect(status).toBe(200);
158:     // Probed today: "Pintar La Sala" — the exact string the UX-26 customer
159:     // received inside "Your Quote + Agreement for Pintar La Sala is ready".
160:     expect(body.jobName).toBe("Pintar la sala");
161:   });
162: 
163:   it("UX-41: the version-option cards carry sentence-case ES titles ('Cambiar 12 tablas')", async () => {
164:     const { status, body } = await s.post("/agents/job-details/options", {
165:       raw: "cambiar 12 tablas del deck y sellar todo",
166:     });
167:     expect(status).toBe(200);
168:     // sanity (green precondition): the es persona gets es cards
169:     expect(body.langs).toContain("es");
170:     const opts = body.options as Array<
171:       { byLang: Record<string, { jobName: string }> }
172:     >;
173:     expect(opts.length).toBeGreaterThanOrEqual(3);
174:     // Probed today: "Cambiar 12 Tablas" / "Cambiar 12 Tablas · Versión breve".
175:     expect(opts[0].byLang.es.jobName).toBe("Cambiar 12 tablas");
176:     expect(opts[1].byLang.es.jobName.startsWith("Cambiar 12 tablas · ")).toBe(
177:       true,
178:     );
179:   });
180: 
181:   it("UX-05: the version-option cards keep ES stopwords lowercase mid-title", async () => {
182:     const { status, body } = await s.post("/agents/job-details/options", {
183:       raw: "instalación de patio de adoquines nuevos",
184:     });
185:     expect(status).toBe(200);
186:     const opts = body.options as Array<
187:       { byLang: Record<string, { jobName: string }> }
188:     >;
189:     // Probed today: opt1 "Instalación De Patio".
190:     expect(opts[0].byLang.es.jobName).toBe("Instalación de patio");
191:     // No card may Title-Case a Spanish stopword anywhere in its es title
```

### `cypress/e2e/ux-help-me-price.cy.ts:68-74`

```
68:       .type(DETALLES);
69:     cy.get("button.composer__send").click();
70:     // The version-confirm step: 3 editable version cards + the green strip.
71:     cy.get("[data-cy=confirm-details]", { timeout: 20_000 }).should(
72:       "be.visible",
73:     );
74:   });
```
