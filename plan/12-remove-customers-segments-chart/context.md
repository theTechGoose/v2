# 1.12 🐛 NW-36 — Remove the "Who's on your books" chart (S) · slug `nw-36-remove-segments-chart`

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 1.12) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

**Why.** `customer.segment` is declared (`backend/src/crm/dto/customer.ts:4-5,27-29`) but has zero write sites; the chart always shows everyone as Unsorted.

- [ ] RED — e2e: `cypress/e2e/clients-page-quality.cy.ts` add `it("REQ-NNN NW-36 no segments chart")`: `cy.visit("/clients")` (the URL that spec already uses at `:47`), `cy.get(".csegment2").should("not.exist")`. Run → fails.
- [ ] EDIT `front-end/components/ClientsSections.tsx:238-289`: delete `ClientsSegmentsProps`, `SEGMENT_COLOR`, and `ClientsSegments`.
- [ ] EDIT `front-end/islands/ClientsPage.tsx`: delete the mount at `:159`; delete the `clientsClient.segments()` entry in the `Promise.all` (`:101-103`) and the `segments` destructure/state; remove the now-unused imports.
- [ ] EDIT `front-end/clients/clients.ts`: delete `ClientSegmentRow`, `ClientSegmentsResponse` (`:60-69`) and the `segments:` method (`:78-79`).
- [ ] EDIT `lang/en.json` + `lang/es.json`: delete the seven `clientsSegments.*` keys (`:702-708`). Leave `clientsSeed.segment.*` if the demo seed still uses them (grep first).
- [ ] Leave the backend endpoint (`backend/src/analytics/entrypoints/clients-controller/mod.ts:78-104`) — it has its own e2e test and hurts nothing. Delete `.csegment2*` CSS rules if you find them.
- [ ] GREEN: `cd front-end && deno task build` succeeds; e2e green; `cd jest && npx jest unit/i18n-dictionary-consistency.test.ts` green.

## Source items from the triage (`new-working-issues.md`, client's words + verdict + evidence)

- Customers tab: remove the "Who's on your books" chart (Property mgmt / Homeowners / Small biz / HOAs / Unsorted). We do not collect this data. [p32]
  - **NW-36 🐛 confirmed: the field it charts is declared but has zero write sites.** Effort S.
  - Evidence: `ClientsSections.tsx:251-289` `ClientsSegments` (title `clientsSegments.title`, `lang/en.json:702-708` / `es.json`
    "Quién está en tu lista"), mounted `ClientsPage.tsx:159`, fed by `GET /analytics/clients/segments` (`clients-controller/mod.ts:78-103`,
    which emits the four real segments even at count 0 and puts everyone in `unsorted`). `segment` is declared
    (`crm/dto/customer.ts:4-5,27-29`) but no create/update call sends it (`ClientsPage:73-78`, `handle-wizard-answer:274-286`,
    `AsstChat:3362-3367`, `clients.ts:82-89` signature lacks it); the `?segment=` URL param on `/clients` filters by *status*
    (`ClientsBoard.tsx:52-56`). Only the demo seed populates it (`lib/clients-seed.ts:405-408`).
  - Fix: delete the mount, the component (`:238-289`), the `segments()` fetch (`ClientsPage:101-106`, `clients.ts:60-80`) and the
    `clientsSegments.*` / `clientsSeed.segment.*` keys (`lang/*.json:693-708`); optionally the endpoint. Tests: none.

## Code at the cited lines (read from this tree while packaging)

### `front-end/components/ClientsSections.tsx:238-289`

```
238: interface ClientsSegmentsProps {
239:   rows: ClientSegmentRow[];
240:   lang?: Lang;
241: }
242: 
243: const SEGMENT_COLOR: Record<string, string> = {
244:   property_mgmt: "var(--brand-green)",
245:   homeowner: "var(--brand-pink)",
246:   small_biz: "var(--brand-teal)",
247:   hoa: "var(--coffee-500)",
248:   unsorted: "var(--coffee-300)",
249: };
250: 
251: export function ClientsSegments({ rows, lang = "en" }: ClientsSegmentsProps) {
252:   if (rows.length === 0) {
253:     return (
254:       <div class="csegment2">
255:         <div class="csegment2__title">
256:           {tFor(lang, "clientsSegments.title")}
257:         </div>
258:         <div class="csegment2__empty">{tFor(lang, "clientsSegments.empty")}</div>
259:       </div>
260:     );
261:   }
262:   // Plural-ize labels for the section
263:   const PLURAL: Record<string, string> = {
264:     "property_mgmt": tFor(lang, "clientsSegments.label.property_mgmt"),
265:     "homeowner": tFor(lang, "clientsSegments.label.homeowner"),
266:     "small_biz": tFor(lang, "clientsSegments.label.small_biz"),
267:     "hoa": tFor(lang, "clientsSegments.label.hoa"),
268:     "unsorted": tFor(lang, "clientsSegments.label.unsorted"),
269:   };
270:   return (
271:     <div class="csegment2">
272:       <div class="csegment2__title">{tFor(lang, "clientsSegments.title")}</div>
273:       {rows.map((s) => (
274:         <div class="cseg2-row" key={s.key}>
275:           <div class="cseg2-row__lbl">{PLURAL[s.key] ?? s.label}</div>
276:           <div class="cseg2-row__bar">
277:             <div
278:               class="cseg2-row__fill"
279:               style={`width:${s.pct}%; background:${
280:                 SEGMENT_COLOR[s.key] ?? "var(--coffee-300)"
281:               }`}
282:             />
283:           </div>
284:           <div class="cseg2-row__num">{s.count}</div>
285:         </div>
286:       ))}
287:     </div>
288:   );
289: }
```

### `front-end/components/ClientsSections.tsx:156-162`

```
156:         <span class="loopbar__h">
157:           {tFor(
158:             lang,
159:             `loopBar.heading.${picks.length === 1 ? "one" : "other"}`,
160:             { n: picks.length },
161:           )}
162:         </span>
```

### `front-end/components/ClientsSections.tsx:101-103`

```
101:                     { n: quietCount },
102:                   )}
103:                 </strong>{" "}
```

### `front-end/components/ClientsSections.tsx:60-69`

```
60:                   lang,
61:                   totalClients === 1
62:                     ? "clientsHero.titlePre.one"
63:                     : "clientsHero.titlePre",
64:                 )}{" "}
65:                 <em>
66:                   {tFor(
67:                     lang,
68:                     `clientsHero.people.${totalClients === 1 ? "one" : "other"}`,
69:                     { word: numberWord(totalClients, lang) },
```

### `front-end/components/ClientsSections.tsx:78-79`

```
78:                 )}
79:               </h1>
```

### `backend/src/analytics/entrypoints/clients-controller/mod.ts:78-104`

```
78:   @Get("analytics/clients/segments")
79:   async segments(@Context() ctx: ExecutionContext): Promise<ClientSegmentsResponse> {
80:     const user  = await requireUser(ctx, this.sessions, this.users);
81:     const cards = await this.flow.run(user.id);
82:     const total = cards.length;
83: 
84:     const counts = new Map<ClientSegment | "unsorted", number>();
85:     for (const c of cards) {
86:       const key: ClientSegment | "unsorted" = c.segment ?? "unsorted";
87:       counts.set(key, (counts.get(key) ?? 0) + 1);
88:     }
89: 
90:     const ordered: (ClientSegment | "unsorted")[] = [...CLIENT_SEGMENTS, "unsorted"];
91:     const segments: ClientSegmentRow[] = ordered
92:       .filter((k) => (counts.get(k) ?? 0) > 0 || k !== "unsorted")
93:       .map((k) => {
94:         const count = counts.get(k) ?? 0;
95:         return {
96:           key:   k,
97:           label: SEGMENT_LABELS[k],
98:           count,
99:           pct:   total > 0 ? Math.round((count / total) * 100) : 0,
100:         };
101:       });
102: 
103:     return { segments };
104:   }
```
