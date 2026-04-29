# Assistant

## Purpose
The conversational workspace where the contractor and the AI ("the monsters") draft quotes, contracts, and follow-ups together. The desktop view is a clean single-pane chat. The mobile companion (rendered as the sticky `.phone` preview) shows the same thread plus a "deal phase" strip (Quote → Terms → Send) so the user can see where they are in the workflow at a glance.

## Top-level structure
Standard `.stage` → `.window` → `.app` → `.main` chrome. Inside `.main` is `<AssistantWorkspace>`:

```
<div class="asst">
  <div class="asst__chat-wrap">
    <section class="chat">
      <ChatHeader/>     ← .chat__head with avatar, title, subtitle, tools
      <ChatScroll/>     ← .chat__scroll containing .msg + .msg--user bubbles
      <Suggestions/>    ← inline suggestion chips
      <Composer/>       ← .composer pinned at the bottom
    </section>
  </div>
</div>
```

Messages can carry payloads:
- Voice memos (`<Voice>` with duration + played %).
- Photo galleries (`.msg__photos` of 3 colored swatches).
- Action cards (`.action-card__*`).
- Inline wizards (`.wiz__*`) — embedded directly inside an assistant `.msg`.

## Layout chrome (uses `shared/`)
- `shared/sidebar`, `shared/topbar`, `shared/annotation-dots`.
- `shared/phone-preview` — but rendered with assistant-specific contents (chat thread + deal phase strip). See `components/phone-thread-preview/`.

## Page-unique components
- [phone-thread-preview](components/phone-thread-preview/) — the Phone preview's contents on this page: deal-phase strip, voice memo, action card, embedded wizard, mini composer. See `shared/phone-preview` for the chassis.
- [payment-setup-wizard](components/payment-setup-wizard/) — `.wiz__*` collapsible question-answering form embedded as a chat message. The "Payment setup" name in the plan is a misnomer in this build; the production data shows it gathering Contract terms, but the same wiz pattern is reusable for any setup flow.
- [right-rail-summary](components/right-rail-summary/) — There is no right-rail summary on this page in the static export. The phone preview occupies the rail position, and the deal-phase strip inside the phone (`Quote → Terms → Send`) is the closest analog. This folder documents that the rail role is filled by the phone.

## Notable interactions
- The composer expands focus state via `.composer__inner:focus-within` (border + shadow).
- The wizard inside a chat message is collapsible; "Show all on one page" toggle is `.wiz__head-mode`.
- Inline `.wiz-chip` answers are checkable pills representing previously answered questions.

## Source
`extracted/Paperwork Monsters Assistant.html` (also at `pages/assistant/raw.html`).
