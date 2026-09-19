# 5.2 Front-end: spinner first, heuristic only on failure, honest degraded state (S) · slug `nw-11-spinner-before-options`

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 5.2) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

- [ ] RED — e2e: `cypress/e2e/ux-help-me-price.cy.ts` add: (a) `cy.intercept("POST","/api/agents/job-details/options",{ delay: 1500, fixture… })` → after sending details `.chat__jobopts-loading` is visible before any `[data-cy=confirm-details]`;
      (b) intercept with `statusCode: 500` → `[data-cy=jobopts-degraded]` note visible, the Write-it-myself editor open and prefilled, and no `.chat__jobopts` bullet text equals the typed sentence. Run → fails.
- [ ] EDIT `AsstChat.tsx:1897-1903` and `:1936-1942`: `setOptionsLoading(true)`; do NOT paint the heuristic; after `await`: if `res?.options?.length` → paint them, `setOptionsLoading(false)`; if `res.degraded` → also show the note; on `null` (request failed) → paint `localFallbackOptions` (now built on `scopeBulletsFromRaw`) or, when degraded, open `openWriteMyself()` prefilled with `raw`.
- [ ] EDIT `localFallbackOptions` (`:223-252`) to use `scopeBulletsFromRaw` from `shared/quote-flow/scope-from-raw.ts` (extensionless import like the other shared modules).
- [ ] EDIT lang (both dicts): `asstChat.jobOpts.degraded` "I couldn't draft this one — edit the bullets or write it yourself." / "No pude redactar esto — edita los puntos o escríbelo tú mismo."; render with `data-cy="jobopts-degraded"`.
- [ ] Done when: with the network throttled you see the dots + "Writing up your options…" first, and a forced 500 never shows the sentence back.

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

- Confirm the "Confirm your job details" page is working correctly. (Screenshot: the three options are the raw text verbatim; "Wider scope" only adds "Jobsite cleanup".) [p20]
  - **NW-11 🐛 CONFIRMED — the screenshot is the client-side heuristic, painted before the LLM answers.** Effort M (shares NW-05).
  - Evidence: `openJobPickerForConfirm` `AsstChat.tsx:1933-1945` sets `setOptionsLoading(false)`, paints `localFallbackOptions`
    (`:223-251`: opt1 = raw bullets, opt2 = minus last, opt3 = + `asstChat.jobsiteCleanup` `lang/en.json:264`), then awaits
    `generateJobOptions` and swaps only if `!optionsTouchedRef.current`. "· Wider scope" from `shared/quote-flow/version-titles.ts:25-31`.
    Backend fallback identical (`generate-job-options/mod.ts:240-252`). Headings `lang/en.json:251-252`, rendered `:3887,3892`.
  - Fix: `setOptionsLoading(true)` at `:1936` and await before painting (spinner branch exists `:3898-3906`); keep the heuristic
    strictly as an error path and make both fallbacks honest. Tests: `cypress/e2e/quotes-help-me-price.cy.ts:39` pins flow shape only.

## Code at the cited lines (read from this tree while packaging)

### `front-end/islands/AsstChat.tsx:1897-1903`

```
1897:     setJobOptionsOpen(true);
1898:     setOptionsLoading(false);
1899:     const heuristic = toOptionDrafts(
1900:       localFallbackOptions(raw || tFor(lang, "asstChat.newJob"), lang),
1901:     );
1902:     setJobOptions(heuristic);
1903:     setSelectedOptionId(heuristic[0]?.id ?? null);
```

### `front-end/islands/AsstChat.tsx:1936-1942`

```
1936:     setJobOptionsOpen(true);
1937:     setOptionsLoading(false);
1938:     const heuristic = toOptionDrafts(
1939:       localFallbackOptions(raw || tFor(lang, "asstChat.newJob"), lang),
1940:     );
1941:     setJobOptions(heuristic);
1942:     setSelectedOptionId(heuristic[0]?.id ?? null);
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
