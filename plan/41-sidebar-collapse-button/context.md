# 7.5 ◩ NW-39 — QuickBooks-style collapse control inside the sidebar (S) · slug `nw-39-sidebar-collapse-button`

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 7.5) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

**Why.** `DashSidebar.tsx:171-179` `toggle()` exists and persists; the only trigger is the topbar hamburger event (`:142-148`). `AsstThreads.tsx:145-177` already has the exact button to copy; `[data-cy=sidebar-collapse|expand]` are expected by `dashboard-assistant-access.cy.ts` and `TDD-QUOTE-FLOW.md:58` but never rendered.

- [ ] RED e2e: `dashboard-assistant-access.cy.ts` → `[data-cy=sidebar-collapse]` visible at 1280 px; click → rail collapsed and `[data-cy=sidebar-expand]` visible; reload keeps it collapsed.
- [ ] EDIT `DashSidebar.tsx:318`: above `sb__bottom` add the `AsstThreads.tsx:145-177` button (icons, `aria-label` keys `dashSidebar.collapse|expand` both dicts) calling `toggle()`; `data-cy` hydration-gated like `DashTopbar.tsx:87-91`.

## Phase context (verbatim from the plan, `Phase 7 — Remaining medium items (no decision needed; any order; after Phases 1–5 if time is short)`)



## Source items from the triage (`new-working-issues.md`, client's words + verdict + evidence)

- Sidebar collapse: the arrow between HANS LLC and Settings that minimizes the sidebar should work like QuickBooks, showing the hamburger plus an arrow to minimize. Use the same pattern for the PM Assistant conversations panel and remove the existing button. [p36]
  - **NW-39 ◩ conversations panel matches exactly; the sidebar collapses QuickBooks-style but has no in-rail control.** Effort S.
  - Evidence: `DashSidebar.tsx:127-130` persisted state, `:171-180` `toggle()`, `:281-291` true icon rail; the **only** trigger is
    the topbar hamburger (`DashTopbar.tsx:139-148` → `pm:sb-toggle`, `DashSidebar:137-151`). No `[data-cy=sidebar-collapse|expand]`
    in any island (only in `cypress/e2e/dashboard-assistant-access.cy.ts` and `TDD-QUOTE-FLOW.md:58` — currently unsatisfiable).
    `AsstThreads.tsx:144-176` has the hamburger ⇄ hamburger+arrow button (`asst-threads-expand/collapse`). Duplicate Settings link
    already removed (`DashSidebar:358-361`).
  - Fix: a button above the `sb__footer` business-name link (`DashSidebar:319`) reusing `AsstThreads:160-176` icons and `toggle()`.

## Code at the cited lines (read from this tree while packaging)

### `front-end/islands/DashSidebar.tsx:171-179`

```
171:   function toggle() {
172:     setCollapsed((c) => {
173:       const next = !c;
174:       try {
175:         globalThis.localStorage?.setItem("pm:sb-collapsed", next ? "1" : "0");
176:       } catch { /* SSR-safe */ }
177:       return next;
178:     });
179:   }
```

### `front-end/islands/AsstThreads.tsx:145-177`

```
145:           <button
146:             type="button"
147:             class="threads__toggle"
148:             // Same QuickBooks pattern as the sidebar (roadmap p9): one physical
149:             // button — collapse arrow when open, hamburger when collapsed.
150:             data-cy={mounted
151:               ? (collapsed ? "asst-threads-expand" : "asst-threads-collapse")
152:               : undefined}
153:             onClick={toggleCollapsed}
154:             aria-label={collapsed
155:               ? tFor(lang, "asstThreads.expandConversations")
156:               : tFor(lang, "asstThreads.collapseConversations")}
157:             title={collapsed
158:               ? tFor(lang, "asstThreads.expand")
159:               : tFor(lang, "asstThreads.collapse")}
160:           >
161:             <I
162:               d={collapsed
163:                 ? (
164:                   <>
165:                     <path d="M3 6h18M3 12h18M3 18h18" />
166:                   </>
167:                 )
168:                 : (
169:                   <>
170:                     {/* QuickBooks-style hamburger + collapse arrow */}
171:                     <path d="M3 6h13M3 12h13M3 18h13" />
172:                     <path d="M21 9l-3 3 3 3" />
173:                   </>
174:                 )}
175:               size={16}
176:             />
177:           </button>
```

### `front-end/islands/AsstThreads.tsx:142-148`

```
142:           : undefined}
143:       >
144:         <div class="threads__head">
145:           <button
146:             type="button"
147:             class="threads__toggle"
148:             // Same QuickBooks pattern as the sidebar (roadmap p9): one physical
```

### `front-end/islands/DashSidebar.tsx:315-321`

```
315:             </nav>
316:           )}
317: 
318:           <div class="sb__bottom">
319:             {s.identity && (
320:               <a
321:                 href="/settings"
```

### `front-end/islands/DashTopbar.tsx:87-91`

```
87:   // The data-cy hook appears only after hydration so a test can never click
88:   // the hamburger before the pm:sb-toggle listener (DashSidebar) is live —
89:   // pre-hydration clicks were the "hamburger does not work" bug (PDF p8).
90:   const [mounted, setMounted] = useState(false);
91:   useEffect(() => setMounted(true), []);
```
