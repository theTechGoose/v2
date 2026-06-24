# Page: `/assistant` (and `/assistant/:threadId`)

**Routes:** `routes/assistant/index.tsx` (new/empty chat) and
`routes/assistant/[threadId].tsx` (a specific conversation). **Sources copied
to:** `js/index.tsx`, `js/[threadId].tsx`. Components in `components/`.

> **Consolidation:** `routes/messages/index.tsx` is a **302 → `/assistant?from=messages`**.
> "Messages" and "Assistant" are the same workspace; the sidebar's
> **`active="messages"`** highlights this page. `<RedirectToast>` shows a
> one-line explainer when `?from=messages` is present. There is **no separate
> messages page** — do not build one.

## Purpose
The AI assistant ("Bossie") chat workspace where the contractor drafts quotes,
sets terms, and manages a job conversation end-to-end. This is the app's
largest, most interactive surface.

## Two route variants
| Variant | Handler behavior |
|---|---|
| **`/assistant`** (index) | `?onboard=1` → `POST /agents/conversations/onboarding-start` (in-process SSR), then **302 → `/assistant/:id?onboard=1`**; on any failure **302 → `/dashboard`** (never strand in an empty chat). Otherwise: SSR-fetch thread list (`GET /agents/conversations?limit=50`) + profile; render an empty `AsstChat` (`initialMessages={[]}`). |
| **`/assistant/:threadId`** | SSR-fetch in parallel: conversation **detail** (`GET /agents/conversations/:id`, in-process — also clears `hasUnreadEvent` server-side), thread **list**, and **profile**. Computes `headerTitle`/`headerStatus` from `detail.conversation`, and an **onboarding banner gate**: `showOnboardBanner = isOnboard && initialStep<4 && !hasActivity` where `initialStep` = count of {name, biz, state, address} filled and `hasActivity` = bound customer / sent contract / phase==="terms". |

## Classification & data flow
- **Page tier:** `define.page` SSR shell + **multiple islands**. SSR reads are
  **authed in-process** (`ssrBackendGetAuthed` / `ssrBackendPostAuthed`) because
  the plain HTTP client 500s/508s SSR-side on Deno Deploy — note this for the
  rebuild's SSR data layer.
- **Data:** `Conversation[]` (list), `ConversationDetail` (messages + customer +
  contract), `ProfileSnapshot` (initials, comms languages, language). See
  `data-model.md` §1.9.
- **Liveness:** `AsstChat` opens a **websocket `/api/voice/stream`** (proxied to
  the backend `/voice/stream` → AssemblyAI streaming) for voice dictation —
  **pushed**. Message send/receive is request-response over `clients/assistant.ts`.
- **Initials:** `deriveUserInitials({name, businessName, phoneNumber})` exported
  from `AsstChat.tsx`, used to render the user disc consistently with the sidebar.

## `<Head>`
- index: `<title>{assistantPage.docTitle}</title>`; thread:
  `<title>{assistantThread.pageTitle}</title>`
- `<link rel="stylesheet" href="/assistant-page.css">` (the 180 KB feature
  sheet; 28 keyframes — components extract only their own subset).

## Layout / composition order (both variants)
```
<RedirectToast/>                         (index only; ?from=messages explainer)
.app
  <DashSidebar active="messages" />      [SHARED]
  main.main
    <DashTopbar greetingName greetingOverride={assistant…} />   [SHARED]
    .asst                                (two-pane: threads rail | chat)
      <AsstThreads initialThreads [activeId] />    ← ISLAND (left rail)
      .asst__chat-wrap
        section.chat
          <OnboardingProgress initialStep />       ← ISLAND ([threadId] only, when showOnboardBanner)
          <ChatHeaderLive initialClient initialStatus />  ← ISLAND
          <AsstChat … />                            ← ISLAND (the main chat)
```
`AsstChat` props differ by variant: index passes `initialMessages=[]`,
`userInitials`, `sendLanguages`; thread also passes `conversationId`,
`initialMessages` (from detail), `initialCustomer`, `initialContract`, and
`from={business,name,phone,email}`.

## Components
| Component | Folder | Tier (one-line) |
|---|---|---|
| `AsstChat` | `components/asst-chat/` | island — the chat (message list, typed bubbles, inline composer, voice ws, quote/terms phases, job-option cards, embeds MoneyInput; renders its **own** `action_card` quote-card variant — NOT the QuoteCard island). VERY large (8450 LOC) — spec is a faithful macro decomposition. |
| `AsstThreads` | `components/asst-threads/` | island — conversation list rail; SSR-seeded then client-updated. |
| `ChatHeaderLive` | `components/chat-header-live/` | island — live chat header (client name + phase/status chip). |
| `MoneyInput` | `components/money-input/` | island — currency entry used inside AsstChat money prompts. |
| `OnboardingProgress` | `components/onboarding-progress/` | island — 4-step onboarding strip, server-seeded `initialStep`. |
| `RedirectToast` | `components/redirect-toast/` | island — `?from=messages` consolidation toast. |

Shared (referenced, not re-specced here): `DashSidebar`, `DashTopbar`,
`Skeletons`, `MobileViewport`, `QuoteTrack`, `ui/*`. NOTE: AsstChat does **not**
render the shared `QuoteCard` island — it has its own local `action_card`
quote-card message variant (different prop shape). Verified by grep; the
`QuoteCard` island is rendered only by `QuotesPage`.

## Dead code orphaned by this feature (do NOT build)
`islands/AsstComposer.tsx`, `islands/Composer.tsx`, `islands/DocTabs.tsx`,
`components/AssistantSections.tsx`, `components/MessageBubble.tsx` — all
zero live references (AsstChat has its own inline composer/bubbles).

## Capture checklist (auth-gated)
- URLs: `/assistant`, `/assistant/<threadId>` (need a seeded conversation),
  `/assistant?onboard=1` (onboarding banner). Auth via dev master OTP `000000`.
- Viewports: real `assistant-page.css` `@media` widths (two-pane collapses to a
  single column + thread drawer on mobile — verify the exact width).
- Transient states: composer focus, mic/voice active (ws), a money prompt,
  job-option cards, onboarding strip steps 0–4, the `?from=messages` toast.
- Light theme only.

## Build order
design tokens → app shell (DashSidebar/DashTopbar) → `redirect-toast`,
`chat-header-live`, `asst-threads`, `onboarding-progress`, `money-input` →
`asst-chat` (depends on MoneyInput) → page compositions.
