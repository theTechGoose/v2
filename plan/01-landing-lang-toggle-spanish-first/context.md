# 1.1 🐛 NW-01 — Landing language toggle: Spanish button first (S) · slug `nw-01-lang-toggle-order`

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 1.1) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

**Goal.** On `/` the toggle reads "Yo hablo Español | I speak English" with Spanish first and selected by default.
**Why.** Default language is already Spanish everywhere (`front-end/lib/lang.ts:374-381`, `routes/index.tsx:199-203`) and the
labels are already exact, but `routes/index.tsx:291-299` renders the `data-lang="en"` button before the `data-lang="es"` one.
`/landing` already has ES first (`routes/landing.tsx:120-131`).

- [ ] RED — e2e: new `cypress/e2e/landing-lang-toggle.cy.ts`:
      `cy.visit("/")` → `cy.get(".lang-toggle button").first()` has attr `data-lang` = `es`, has class `on`, contains "Yo hablo Español";
      `.eq(1)` has `data-lang` = `en`, contains "I speak English". Run: `cd cypress && npx cypress run --spec e2e/landing-lang-toggle.cy.ts` → expect the first assertion to fail (first button is `en`).
- [ ] RED — integration: in `jest/integration/landing-pages.int.test.ts` (near the `<html lang="es">` pin at lines 113-120) add
      `it("REQ-NNN NW-01 the Spanish toggle button precedes the English one")`: fetch `/` HTML, assert
      `html.indexOf('data-lang="es"') < html.indexOf('data-lang="en"')`. Run → fails.
- [ ] Unit: `n/a — pure markup order, no logic`.
- [ ] EDIT `front-end/routes/index.tsx:291-308`: cut the whole `<button … data-lang="en" …>…</button>` block (lines 291-299) and
      paste it AFTER the `data-lang="es"` block (after line 308). Change nothing else; keep "Yo hablo Español" with the accent.
- [ ] GREEN: both tests pass; `cd cypress && npx cypress run --spec e2e/landing-mobile-390.cy.ts` still passes (it measures toggle alignment).
- [ ] Done when: `/` shows Spanish first and highlighted on a fresh browser with no cookie.

## Source items from the triage (`new-working-issues.md`, client's words + verdict + evidence)

- Default language must be Spanish. The toggle at the top should read "Yo hablo Espanol | I speak English", with "Yo hablo Espanol" selected by default. [p2]
  - **NW-01 ◩ PARTIALLY BUILT — default ✅, labels ✅, order ❌ (EN button renders first).** Effort S.
  - Evidence: default is unconditionally Spanish — `front-end/lib/lang.ts:374-381` `pickLangFromAcceptLanguage()` returns `"es"`
    for everyone; `lang.ts:15` `langSignal("es")`; `routes/index.tsx:199-203` precedence `?lang` > `pm_lang` cookie > es;
    `static/landing-scripts.js:359`. The toggle at `routes/index.tsx:288-310` already carries the exact strings ("I speak English" /
    "Yo hablo Español") and the `on` class binds to `lang === "es"`, but the `data-lang="en"` button is the first child. Strings
    are hard-coded in the route (no lang key); `/landing` orders ES first (`routes/landing.tsx:119-131`), so the two landings
    disagree. JS/CSS are order-agnostic (`landing-scripts.js:448-471`, `landing.css:3114-3119`).
  - Fix: swap the two `<button>` blocks at `routes/index.tsx:289-309`; keep the accent ("Español"). Optionally extract both labels
    to `lang/*.json` for parity with `/landing`.
  - Tests: none pin label/order (`cypress/e2e/landing-mobile-390.cy.ts:66-82` measures alignment only; `jest/integration/landing-pages.int.test.ts:113-120` pins `<html lang="es">`).

## Code at the cited lines (read from this tree while packaging)

### `front-end/lib/lang.ts:374-381`

```
374: export function pickLangFromAcceptLanguage(_header: string | null): Lang {
375:   // Spanish-first, by product decision: the app is built for Spanish-speaking
376:   // contractors, so it defaults to ES for EVERYONE regardless of the browser's
377:   // Accept-Language (an English-locale device still lands on Spanish). English
378:   // is opt-in via the language toggle, which persists pm_lang / pm:lang. The
379:   // header is ignored on purpose; kept in the signature so callers are unchanged.
380:   return "es";
381: }
```

### `front-end/routes/index.tsx:199-203`

```
199:   const qLang = new URL(ctx.req.url).searchParams.get("lang");
200:   const lang = (qLang === "en" || qLang === "es")
201:     ? qLang
202:     : langFromCookie(ctx.req.headers.get("cookie")) ??
203:       pickLangFromAcceptLanguage(ctx.req.headers.get("accept-language"));
```

### `front-end/routes/index.tsx:291-299`

```
291:             <button
292:               class={lang === "en" ? "on" : ""}
293:               type="button"
294:               data-lang="en"
295:               aria-label="I speak English"
296:             >
297:               <span class="lang-toggle__full">I speak English</span>
298:               <span class="lang-toggle__abbr" aria-hidden="true">EN</span>
299:             </button>
```

### `front-end/routes/landing.tsx:120-131`

```
120:                 <a
121:                   href="/landing?lang=es"
122:                   class={lang === "es" ? "on" : ""}
123:                 >
124:                   {t("langEs")}
125:                 </a>
126:                 <a
127:                   href="/landing?lang=en"
128:                   class={lang === "en" ? "on" : ""}
129:                 >
130:                   {t("langEn")}
131:                 </a>
```

### `front-end/routes/index.tsx:291-308`

```
291:             <button
292:               class={lang === "en" ? "on" : ""}
293:               type="button"
294:               data-lang="en"
295:               aria-label="I speak English"
296:             >
297:               <span class="lang-toggle__full">I speak English</span>
298:               <span class="lang-toggle__abbr" aria-hidden="true">EN</span>
299:             </button>
300:             <button
301:               class={lang === "es" ? "on" : ""}
302:               type="button"
303:               data-lang="es"
304:               aria-label="Yo hablo Español"
305:             >
306:               <span class="lang-toggle__full">Yo hablo Español</span>
307:               <span class="lang-toggle__abbr" aria-hidden="true">ES</span>
308:             </button>
```
