# i18n Language-Threading Fix — Triage

> The app's strings were migrated to `/lang` (`t()` / `tFor(lang,…)`), but most **authed-app islands don't receive the real language**, so they render English regardless of the contractor's setting and don't switch live. This doc lists every place that needs fixing, with file:line and the exact change, so it can be picked up by anyone.

## Root cause (two shapes)

1. **Island reads `lang` from a prop that defaults to `"en"`** and never reads `langSignal` → not reactive, stuck on English. (The route doesn't pass `lang` either.)
2. **A parent renders a `lang`-accepting child without `lang=`** → the child falls back to its own `"en"` default.

Almost every page has **both**: the island is on shape (1) *and* doesn't thread `lang` to its sections (shape 2).

## The fix recipe (verified — already shipped on the dashboard)

`langSignal` (in `front-end/lib/i18n.ts`) is the reactive source of truth for the **authed app** UI language. It is:
- **seeded** from `user.language` by `front-end/lib/dash-cache.ts` (`writeCached → setLang`), and
- **set live** by `SettingsPage`'s App-language `<select>` (`setLang(v)` on change).

So an authed-app island just needs to **read it and thread it down**:

```tsx
import { langSignal } from "../lib/i18n.ts";   // adjust relative path
// inside the component body:
const lang = langSignal.value;                 // reactive — re-renders on Settings change
// then pass it to every lang-accepting child:
<SomeSection … lang={lang} />
```

Leaf/section components (`*Sections.tsx`, cards, etc.) are **already correct** — they accept `lang?: Lang` and use `tFor(lang,…)`. Do **not** make them read `langSignal` (they're SSR-presentational); they just need the parent to pass `lang`.

### Already done (reference implementations — don't redo)
- `front-end/lib/i18n.ts` — added `setLang()`
- `front-end/lib/dash-cache.ts` — seeds `langSignal` from the profile
- `front-end/islands/SettingsPage.tsx` — `setLang` on change + reactive
- `front-end/islands/DashSidebar.tsx` — reads `langSignal`
- `front-end/islands/DashboardPage.tsx` — reads `langSignal` + threads `lang` to its 6 sections ✅ verified switching live

### ✅ Also fixed (the "non-obvious" set — done this pass)
- `front-end/components/contract-doc.tsx` L674 — threads `lang` to `<PublicSignContract>` (Spanish contract → Spanish signature pad).
- **Change order:** `backend/.../public-controller/mod.ts` getChangeOrderPublic now returns `commsLanguage`; `front-end/routes/co/[id].tsx` resolves `lang` from it and passes `lang` to `<PublicChangeOrderActions>`.
- `front-end/islands/DashTopbar.tsx` — now reads `langSignal` **and computes the greeting date itself** (reactive), so the date + "Hey/Hola, {name}" + ticker re-localize live. ✅ verified live (no reload). This also moots every route's pre-formatted `greetingDate` prop (now ignored).
- `front-end/routes/quotes/index.tsx` — dropped its hardcoded English `WEEKDAY`/`MONTH` arrays; greeting name now uses `tFor(lang, "common.thereFallback")`.
- `front-end/islands/Topbar.tsx` — **deleted** (dead; no importers).
- `front-end/islands/SetupChecklist.tsx` — reads `langSignal` (no longer frozen to the one-shot profile fetch).

### ✅ Page-island bulk — DONE (all of the below is now applied)
Every authed-app island now self-sources `langSignal`, and the page islands thread `lang` to their section components:
- `ClientsPage`, `QuotesPage`, `InvoicesPage`, `PaymentsPage`, `ContractsPage` — read `langSignal`; the first three + contracts thread `lang` to their `*Sections` components.
- `AsstChat`, `AsstThreads`, `ChatHeaderLive`, `AssistantCoachmark` — read `langSignal`.
- `MoneyInput`, `DeleteQuoteButton`, `OnboardingProgress`, `RedirectToast` — self-source `langSignal` (so parents needn't thread to them).

**Verified live in-browser (Español):** Dashboard, Settings, Clients, Quotes, Assistant all render + switch. Frontend `vite build` + backend `deno check` green.

### Known minor leftovers (not blocking — surfaced during verification)
- `routes/quotes/index.tsx` `<title>` is still the hardcoded `"Quotes · Paperwork Monster"` (only the greeting was migrated). Low priority.
- Clients relative-time shows `"… 1 día ago"` — the `clientsDisplay` "ago" suffix has an un-keyed spot. Low priority.
- The Assistant route's `greetingOverride` and any other route-resolved override strings are still passed pre-resolved (frozen until navigation), like the old greeting date was. Low priority.
- `QSideTip` / analytics "insight" text and conversation titles are **backend-generated dynamic data**, not UI labels — correctly left as-is (localize at the source if desired).

### Priority legend
- **P1** — primary authed-page text stuck in English / no live switch (user-visible, high traffic)
- **P2** — secondary surfaces, or correct-but-not-live
- **P3** — minor / edge / pre-fetch error states

---

## Authed app — page islands

### Clients
**`islands/ClientsPage.tsx`**
- **[P1]** Import `langSignal` (extend the existing i18n import) and replace the `{ lang = "en" }` prop with `const lang = langSignal.value;` (≈L25 import, L51 signature).
- **[P1]** Thread `lang={lang}` to: `<ClientsHero>` (L103), `<LoopBar>` (L109), `<ClientsBoard>` (L110), `<TopClients>` (L111), `<ClientsSegments>` (L112).
- `islands/ClientsBoard.tsx`, `components/ClientsSections.tsx` — **(ok)**, inherit once ClientsPage passes `lang`.
- `routes/clients/index.tsx` L58 — optional `lang=` (not needed once the island reads `langSignal`).

### Quotes
**`islands/QuotesPage.tsx`**
- **[P1]** L29 import `langSignal`; L86 replace `{ lang = "en" }` with `const lang = langSignal.value;` (keep the `useEffect` `[lang]` dep at L112).
- **[P1]** Thread `lang={lang}` to: `<QuotesHero>` (L163), `<QuotesKpis>` (L175), 3× `<QuoteTrack>` (L186, L198, L210), 3× `<QuoteCard>` (L194, L206), `<DecidedRow>` (L218), `<QSideBig>` (L224), `<QSideRate>` (L225), `<QSideTip>` (L226).
- **[P2]** `islands/QuoteCard.tsx` L178 — pass `lang` to `<DeleteQuoteButton>`.
- **[P2]** `components/QuotesSections.tsx` L186 (`DecidedRow`) — pass `lang` to `<DeleteQuoteButton>`.
- `QuoteCard.tsx`, `QuoteTrack.tsx`, `QuotesSections.tsx` — **(ok)** leaves; inherit.

### Invoices
**`islands/InvoicesPage.tsx`** (renders its sections inline)
- **[P1]** L30 import `langSignal`; add `const lang = langSignal.value;` as the first body line (≈L275/276). All inline `tFor(lang,…)` + already-threaded children (`InvoicesHero`, `InvoicesKpis`, every `InvoiceCard`) become reactive automatically. No child-threading gaps.
- `routes/invoices/index.tsx` L55 — **[P2]** optional `lang={lang as Lang}` for SSR first paint (import `type Lang`).

### Payments
**`islands/PaymentsPage.tsx`** (renders its sections inline)
- **[P1]** L39 import `langSignal`; add `const lang = langSignal.value;` as the first body line (≈L262/263). All children (`PaymentsHero`, `PaymentsKpis`, `PaymentCard`, `LandedRow`, `PSideFlow`, `PSideTopPayors`, `PSideMix`, `PSideTip`) already threaded. No child gaps.
- `routes/payments/index.tsx` L55 — **[P2]** optional `lang={lang}` (`Lang` already imported there).

### Contracts
**`islands/ContractsPage.tsx`**
- **[P1]** L24 import `langSignal`; L47 replace `{ lang = "en" }` with `const lang = langSignal.value;`.
- **[P1]** Thread `lang={lang}` to: `<ContractsHero>` (L132), `<ContractsKpis>` (L140), `<ScheduleStrip>` (L151), and all 4 `<ContractCard>` (L163, L185, L207, L228).
- `ContractCard.tsx`, `ContractTrack.tsx`, `ContractsSections.tsx` — **(ok)**, inherit.
- `routes/contracts/index.tsx` L33 — optional.

### Assistant (highest-traffic surface)
- **[P1] `islands/AsstChat.tsx`** — L21 import the shared `Lang` + `langSignal`; L419–428 replace the `lang = "en"` prop with `const lang = langSignal.value;`. ~80 `tFor(lang,…)` call sites then go reactive. **[P2]** also pass `lang={lang}` to `<MoneyInput>` (L3075).
- **[P1] `islands/AsstThreads.tsx`** — L18 read `langSignal` (conversation sidebar: titles, recency groups, chips, timestamps).
- **[P1] `islands/ChatHeaderLive.tsx`** — L26 read `langSignal` (Back / Share / More titles + live header updates).
- **[P2] `islands/AssistantCoachmark.tsx`** — L31 read `langSignal` (first-run coachmark on the dashboard).
- **[P1] `routes/assistant/index.tsx`** (L107/110/114) and **`routes/assistant/[threadId].tsx`** (L132/138/142) — thread `lang={lang}` to `<AsstThreads>`, `<ChatHeaderLive>`, `<AsstChat>` for correct SSR first paint (avoids an EN flash before hydration).
- `components/AssistantSections.tsx`, `components/MessageBubble.tsx`, `islands/AsstComposer.tsx` — **(ok / not on the live path)** — `AsstComposer` appears unused (real composer is inline in AsstChat); if reintroduced, make it read `langSignal`.

## Authed app — shared chrome & misc islands
- **[P1] `islands/DashTopbar.tsx`** L13/L36 — read `langSignal` (greeting line, toggle-sidebar aria, live-activity aria, "{time} ago"). Rendered by every authed route with no `lang=`.
- **[P1] `islands/Topbar.tsx`** L10/L18 — read `langSignal`. ⚠️ **Appears to be dead/legacy** (no route renders `<Topbar>`); consider deleting instead.
- **[P1] `islands/MoneyInput.tsx`** L26/L33 — read `langSignal` (self-sufficient fix; covers spelled-out amount words + labels). Its only caller (`AsstChat`) doesn't pass `lang`.
- **[P1] `islands/DeleteQuoteButton.tsx`** L11/L19 — read `langSignal` (label / confirm dialog / error alert).
- **[P2] `islands/OnboardingProgress.tsx`** L17/L36 — read `langSignal` (onboarding chat copy).
- **[P2] `islands/RedirectToast.tsx`** L13 — read `langSignal` (one-shot toast; resolve at build time).
- **[P2] `islands/SetupChecklist.tsx`** L40 — currently derives `lang` from a one-shot `profileClient.get()`, so it **does not live-switch** on a Settings change. Switch to `const lang = langSignal.value;` (keep the profile fetch only for checklist item data).

## Public document pages (use the DOCUMENT's language, NOT `langSignal`)
These render in the quote/contract's `commsLanguage` (or the route's `es` flag). Fix = make sure the route resolves the doc language and threads it down.
- **[P1] `components/contract-doc.tsx` L674** — `<PublicSignContract …>` is rendered **without `lang=`**, so a **Spanish contract shows an English signature pad**. `ContractDoc` already has `const lang` in scope (L249). Fix: `<PublicSignContract contractId={contract.id} lang={lang} />`.
- **[P2] `routes/co/[id].tsx`** (L39/144) + `islands/PublicChangeOrderActions.tsx` — the whole change-order page renders English because the `/change-orders/:id/public` **backend payload carries no `commsLanguage`**. Fix: add `commsLanguage` (or `es`) to that payload, resolve `lang` in the route, and pass `lang={lang}` to `<PublicChangeOrderActions>`. (Requires a small backend change.)
- **[P3] `routes/c/[id].tsx` / `islands/PublicContractView.tsx`** — pre-fetch loading/error copy defaults to EN (contract is fetched client-side, so no `commsLanguage` at route render). The agreement **body** is correct. Acceptable.
- **(ok)** `routes/q/[id].tsx`, `routes/i/[id].tsx`, `routes/s/[code].tsx` and their islands already resolve + thread the document language. (`i/[id]` and `s/[code]` error/404 states use `tFor("en",…)` — acceptable, no document to localize.)

## Special cases (need more than threading)
- **Frozen SSR greeting strings.** `DashTopbar` `greetingDate` / `greetingName` / `greetingOverride` (and `Topbar` `greeting`) are passed in **already-localized as plain strings** by the route, not as keys. Flipping `langSignal` cannot re-localize them — they stay in the SSR language until a full reload. To make the date live-switch, pass the **raw timestamp / day+month indices** into the island and format client-side against `langSignal` (the way `DashboardPage`'s `shortMonth`/`shortDay` already do).
- **`routes/quotes/index.tsx` L7–37** builds its greeting from **hardcoded English `WEEKDAY`/`MONTH` arrays and a literal `"there"`** (doesn't use `tFor` at all) — so that route's topbar is English-only even at SSR. Worth auditing the other dashboard-style route greeting builders for the same miss.

## Suggested order & verification
1. Do the **page islands** (Clients, Quotes, Invoices, Payments, Contracts) — biggest visible win, all the same mechanical fix.
2. Do **AsstChat + AsstThreads + ChatHeaderLive** (highest traffic).
3. Do **shared chrome** (DashTopbar, MoneyInput, DeleteQuoteButton) + misc islands.
4. Do **public**: `contract-doc.tsx` L674 (quick P1); change-order payload (needs backend).
5. Handle the **frozen-greeting** special case last.

**Verify each** with: `cd front-end && deno task build` (must stay green), then drive the app — set Settings → App language to Español and confirm the page flips **live, without reload** (sidebar already proves the mechanism works). Repeat per page.
