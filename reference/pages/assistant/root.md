# Assistant Page — Root

> ⚠️ **Most chat behavior is DEFERRED** — the AI agent is being built in parallel as a new backend `agents` module (see `backend.md` §4). The frontend ships the chat shell with a static seed; every `[DEFERRED]` component below renders mock data until `/agents/*` exists.
>
> Components NOT deferred (build in v1): the **page shell** (Sidebar + Topbar reused from Dashboard), the **Threads list** (left rail, 280 px), the **phase divider**, and a static read-only **DocPane** that mirrors the active quote.

## Purpose

The contractor's AI workspace. Left rail lists conversations grouped by recency (Today / Yesterday / This week). Center panel is a chat between the contractor and "Bossie" (the AI assistant). Each conversation walks through three phases: **Phase 1 — Chat** (define the job), **Phase 2 — Contract terms** (inline wizard), **Phase 3 — Send**. Right pane (in some layouts) shows a live document preview as terms are agreed.

The chat supports rich message types: voice memos, text bubbles, action cards (quotes/contracts/invoices generated inline), wizard messages (multi-step inline forms), and continue-CTA prompts to advance phases.

## Source

- Prototype HTML: `v2/reference/paperwork-monsters/project/Paperwork Monsters Assistant.html` (4797 lines)
- Inline CSS: Assistant.html lines **264–3173** (heavy — defines `.asst`, `.threads`, `.chat`, `.msg`, `.voice`, `.action-card`, `.wiz`, `.wiz-chip`, `.deal`, `.docpane`, `.docket`, `.doc`, `.continue-cta`, `.phase-divider`, `.composer`, `.suggest`, `.phone__*` …)
- Inline JSX (React 18 + Babel): Assistant.html lines **3175–4795**

The Sidebar, Topbar, Spark, Ticker, ActivityTicker, Hero, Kpis, ActiveJobs, QuotesAwaiting, Outstanding, Activity, Phone, NAV, ICN, and `I` components in Assistant.html are **identical copies** of the Dashboard ones (lines 3448–4029). Reuse the dashboard component files; do not re-document.

## Route

```
v2/frontend/routes/assistant/index.tsx          → "/assistant"
v2/frontend/routes/assistant/[threadId].tsx     → "/assistant/:threadId"
v2/frontend/routes/assistant/_middleware.ts     → requires auth (same as dashboard)
```

The active conversation is selected via URL: `/assistant` shows the latest, `/assistant/t1` shows thread `t1`. This is route state, not React state.

## Layout (top-down)

```
.app
├── <Sidebar />                      ← reuse from dashboard (`pages/dashboard/components/sidebar.md`)
└── <main>
    ├── <Topbar />                   ← reuse from dashboard (`pages/dashboard/components/topbar.md`)
    └── <AssistantWorkspace>         (.asst)
        ├── <Threads />              → components/thread-list.md          ✅ build
        └── <ChatPanel> (.chat)
            ├── <ChatHeader />       → covered inside chat-viewport.md
            ├── <ChatScroll>         → components/chat-viewport.md         [DEFERRED]
            │   ├── <DealBar />      → components/deal-summary-bar.md      [DEFERRED]
            │   ├── <PhaseDivider/>  → components/phase-divider.md         ✅ build (CSS only)
            │   ├── <Voice />        → components/voice-message.md         [DEFERRED]
            │   ├── <MessageBubble/> → components/message-bubble.md        [DEFERRED]
            │   ├── <ActionCard />   → components/action-card.md           [DEFERRED]
            │   ├── <Wizard />       → components/wizard.md                [DEFERRED]
            │   └── <ContinueCTA />  → covered inside chat-viewport.md
            ├── <Suggestions />      → covered inside composer.md
            └── <Composer />         → components/composer.md              [DEFERRED]

(Optional, not currently in `AssistantWorkspace`'s output but defined in the prototype — `DocPane`)
└── <DocPane />                      ← right pane: tabs (Quote/Client/Log) + read-only doc preview
                                       Build a STATIC version (no chat-driven updates) for v1.
                                       File: covered inside chat-viewport.md (DocPane section)

Side preview (desktop only):
└── <PhoneAssistant />               → components/phone-preview-assistant.md  [DEFERRED]
                                       Same "decorative on desktop" rule as Dashboard's <Phone>.
```

## Page-level state

| State | Where | Note |
|---|---|---|
| `activeThreadId` | URL param `[threadId]` | Server-rendered |
| `threads` | Server-fetched | `GET /agents/conversations` (FUTURE) — until then, static seed |
| `messages` | Server-fetched (per thread) | `GET /agents/conversations/:id` (FUTURE) — until then, static seed |
| `composerDraft` | Composer island, persisted to `localStorage[`asst:draft:${threadId}`]` | So switching threads doesn't lose typed text |
| Chat scroll position | Auto-scroll to bottom on new message | Local DOM state |
| Voice playback | Per-bubble, local DOM state | Web Audio API (deferred) |
| Wizard step state | Per-wizard, lifted to a signal | Reset on conversation change |
| `sidebarCollapsed` | Reuse from Sidebar island | Same as Dashboard |

## Backend dependencies

**v1 (chat shell only):**

| UI surface | Endpoint | Status |
|---|---|---|
| Sidebar profile + counts | `GET /profile`, `GET /analytics/dashboard` | Same as Dashboard |
| Topbar bell + ticker | `GET /notifications` | Same as Dashboard |
| Threads list | static seed for v1 | — |
| Active thread messages | static seed for v1 | — |
| Composer send (no-op in v1) | none | — |
| DocPane "active quote" | `GET /quotes/:id` for the linked quote | Existing v2 endpoint |

**Post-v1 (when `agents` module ships):**

| UI surface | Endpoint | Where defined |
|---|---|---|
| Threads list | `GET /agents/conversations[?limit=&cursor=]` | `backend.md` §4 |
| Active thread + messages | `GET /agents/conversations/:id` | `backend.md` §4 |
| Send a message | `POST /agents/chat` (`{ conversationId?, content }`) | `backend.md` §4 |
| Voice memo upload + transcription | (TBD — agents module v2) | — |
| Action card actions ("Lock it in", "Send to client") | calls existing v2 paperwork endpoints (`POST /quotes`, `PUT /contracts/:id/sign`, etc.) | Existing |
| Wizard answer submission | `POST /agents/chat` with structured payload OR direct `PUT /contracts/:id` | `backend.md` §4 |

## Auth

**Required.** Same `_middleware.ts` as dashboard.

## Mobile breakpoints

**Mobile-first matters more here** than on the dashboard, because the assistant is the primary interaction surface. Below 768px:
- Threads list collapses behind a "back to threads" button on the chat header
- Single-column: chat fills the viewport
- Composer becomes sticky at the bottom (above the home indicator on iOS)
- Voice messages get a bigger play button (44 px touch target)
- The wizard takes full width and reflows option buttons to 1-col

The `<PhoneAssistant />` mockup (Assistant.html:4031–4209) is the spec for this — see `components/phone-preview-assistant.md`.

## Implementation order

1. Build the **page shell** — `/assistant` route, sidebar + topbar reuse, empty `<AssistantWorkspace>` placeholder. Confirm layout doesn't break when chat is empty.
2. Build **`<Threads />`** with the static seed — sidebar of conversations. Click → URL changes to `/assistant/:threadId`.
3. Build **`<ChatHeader />`** + **`<DealBar />`** + **`<PhaseDivider />`** with static content. These are the "chrome" of the chat — visible even before any messages render.
4. Build **`<MessageBubble />`** as a dumb display component (renders user/assistant text). Seed with 2–3 hardcoded messages so the layout looks alive.
5. Build **`<Composer />`** UI shell — textarea + buttons. Wire up `localStorage` draft persistence. **No send action yet** (or wire to a stub that appends locally, doesn't post).
6. Build **`<DocPane />`** as a static preview of `GET /quotes/:id`. Tabs are state but the data is read-only.
7. Build **`<PhoneAssistant />`** for documentation/decoration purposes only (do not ship as desktop component; treat as the mobile responsive layout spec).
8. **Stop here for v1.** Wait for the `agents` module before building voice, action cards, wizard, suggestions logic.

## What NOT to port

- The `<div class="stage">` browser chrome (same as Dashboard).
- `TweaksPanel`, `useTweaks`, `TWEAK_DEFAULTS` (dev tools).
- `window.LOGO_DATA_URL` — use `static/logo-monster.png`.
- The static `THREADS` seed once the `/agents/conversations` endpoint lands.

## Conventions for this folder

Same as `pages/landing/` and `pages/dashboard/`. Each `[DEFERRED]` component file starts with a `> ⚠️ DEFERRED — depends on agents module` blockquote so it can be skimmed quickly.

## Cross-reference

For the underlying chat-message bubble styles, the prototype's CSS (Assistant.html inline `<style>` lines 264–3173) defines:

| Selector family | Component |
|---|---|
| `.asst` | AssistantWorkspace root grid |
| `.chat`, `.chat__head`, `.chat__scroll`, `.chat__day` | chat-viewport |
| `.deal`, `.deal__client`, `.deal__total`, `.deal__phases`, `.deal__phase` | deal-summary-bar |
| `.msg`, `.msg__avatar`, `.msg__bubble`, `.msg__time`, `.msg__photos`, `.msg--user` | message-bubble |
| `.voice`, `.voice__play`, `.voice__wave`, `.voice__bar`, `.voice__time` | voice-message |
| `.action-card`, `.action-card__head/icon/title/sub/chip/body/row` | action-card |
| `.wiz`, `.wiz__head*/chips/step/opts/rest`, `.wiz-chip`, `.wiz-opt`, `.wiz-pill` | wizard |
| `.continue-cta`, `.continue-cta__icon/txt/title/sub/btn` | (in chat-viewport.md) |
| `.phase-divider`, `.phase-divider__line/label` | phase-divider |
| `.composer`, `.composer__inner/input/tools/btn/send/hint`, `.suggest`, `.suggest__chip` | composer |
| `.threads`, `.threads__head/title/count/new/list/group-label`, `.thread`, `.thread--active`, `.thread__head/client/time/preview/chips`, `.thread__chip--{sent,draft,needs,paid}` | thread-list |
| `.docpane`, `.docpane__tabs/tab/body/cta/cta-btn`, `.docket`, `.docket__title/items/item/item-num/item-label`, `.doc`, `.doc__head/type/title/meta-label/meta-val/lines/line/line-name/line-qty/line-amt/totals/totals-row/totals-row--grand` | (DocPane section in chat-viewport.md) |
