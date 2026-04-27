# `PhoneAssistant` — Mobile assistant preview / mobile responsive spec

> ⚠️ **DEFERRED — depends on agents module + chat infrastructure.** Same "decorative on desktop only" rule as `pages/dashboard/components/phone-preview.md` — this is a *spec for the mobile responsive layout* of the Assistant page, not a desktop component.

## Purpose

380×760 iPhone-frame mockup of the Assistant page. Same chrome as the dashboard `<Phone>` (notch, status, top bar, bottom tab bar) but the body shows the chat experience: condensed thread bar, full-width chat with smaller bubbles, a docked composer, and a minimized phase progress strip.

## Source

- JSX: `Paperwork Monsters Assistant.html` lines **4031–4209** (`PhoneAssistant`)
- Reuses the same `.phone__*` chrome rules as `<Phone>` (Dashboard.html inline `<style>`)

## What's distinctive about the assistant mobile layout

### 1. No threads sidebar

On mobile, the Threads pane is hidden. The chat fills the viewport. Tapping a "back" button on the chat header opens a slide-over with the thread list.

### 2. Compact deal bar

The desktop `<DealBar />` (4-column grid) collapses to two stacked rows:
- Row 1: client name + total
- Row 2: tiny phase chips (`✓ Quote → 2 Terms → 3 Send`)

### 3. Sticky composer at bottom

Always visible above the home indicator. Mic button is the most prominent (replacing the pink send circle in the bottom tab bar from `<Phone>`).

### 4. Bottom tab bar replaces the desktop sidebar nav

Same 5-tab structure as Dashboard's `<Phone>`:
- Home → `/dashboard`
- Jobs → `/dashboard/jobs`
- [Center pink button] → opens a quick-action sheet (mic, photo, file) — **different from Dashboard's "send" button which navigates to /assistant**
- Money → `/dashboard/money`
- More → `/dashboard/more`

When already on `/assistant`, the active tab is the center button; tapping it opens the recording sheet immediately.

### 5. Message bubbles are smaller

- `.msg__bubble` font drops from 13 → 12 px
- `max-width: 88%` (vs 78% on desktop)
- Avatar 24 × 24 (vs 28)

### 6. Action cards collapse

The full action card (icon + title + 4 line items + total) is too tall on mobile. Show only the head + total; tapping expands to show line items.

### 7. Wizard takes full width

Option grid drops to 1 column. "All-on-one" mode is hidden (mobile is always step-by-step).

### 8. Voice messages are bigger

Play button: 36 × 36 (vs 28). Bars: 2 px wider gap between them.

## Mobile-specific JSX (from prototype, structurally)

```jsx
const PhoneAssistant = () => (
  <div className="phone">
    <div className="phone__screen">
      <div className="phone__notch"/>
      <div className="phone__status">…9:41 + signal/wifi/battery…</div>

      {/* Compact chat header */}
      <div className="phone__top phone__top--chat">
        <button className="phone__top-back"><I d={ICN.back} size={18}/></button>
        <div className="phone__chat-avatar"><img src={window.LOGO_DATA_URL}/></div>
        <div className="phone__top-greet">
          <div className="phone__top-greet-line">Tom & Linda K.</div>
          <div className="phone__top-greet-name">Garage epoxy · Phase 2 · Terms</div>
        </div>
        <button className="phone__bell">
          <I d={ICN.more} size={15}/>
        </button>
      </div>

      {/* Scrollable chat */}
      <div className="phone__scroll phone__scroll--chat">
        {/* Compact deal bar (2 rows) */}
        <div className="phone-deal">…Tom & Linda K. · $3,400 + tiny phase pills…</div>

        {/* Day marker */}
        <div className="chat__day">Today · 8:42 AM · Phase 1 — Chat</div>

        {/* User voice bubble */}
        <div className="msg msg--user">…<Voice/>… 8:42 AM · transcribed</div>

        {/* Assistant text bubble */}
        <div className="msg">…assistant questions…</div>

        {/* User text + photo strip */}
        <div className="msg msg--user">…Grind. Polyaspartic. + 3 photos…</div>

        {/* Action card (collapsed on mobile) */}
        <div className="msg">
          <div className="action-card action-card--mobile">…just head + total…</div>
        </div>

        {/* Wizard (full-width, 1-col options) */}
        <div className="msg">
          <div className="wiz wiz--mobile">…step 5 of 10 + 1-col options…</div>
        </div>
      </div>

      {/* Sticky composer */}
      <div className="phone-composer">
        <textarea placeholder="Reply or hit mic…" rows={1}/>
        <button className="phone-composer__mic"><I d={ICN.mic} size={20}/></button>
      </div>

      {/* Bottom tab bar (5 tabs, center = pink mic shortcut) */}
      <div className="ptabs">…Home / Jobs / [Mic] / Money / More…</div>
      <div className="home-indicator"/>
    </div>
  </div>
);
```

## CSS additions for mobile (intended)

```css
.phone__top--chat {
  display: grid; grid-template-columns: auto auto 1fr auto;
  gap: 8px;
}
.phone__top-back {
  width: 32px; height: 32px; border-radius: 8px;
  background: var(--mint-200); border: 0; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  color: var(--brand-teal);
}
.phone__chat-avatar {
  width: 32px; height: 32px; border-radius: 9px;
  background: var(--brand-green); overflow: hidden;
  display: flex; align-items: center; justify-content: center;
}

.phone-deal {
  background: rgba(255,255,255,0.92);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 8px 12px;
  display: flex; flex-direction: column; gap: 6px;
  font-size: 11px;
  margin-bottom: 12px;
}

/* mobile chat scaling */
.phone__scroll--chat .msg__bubble        { font-size: 12px; max-width: 88%; padding: 8px 12px; }
.phone__scroll--chat .msg__avatar        { width: 24px; height: 24px; }

.action-card--mobile { /* collapsed by default; tap to expand line items */ }
.action-card--mobile .action-card__body  { display: none; }
.action-card--mobile.is-expanded .action-card__body { display: flex; }

.wiz--mobile .wiz__opts                  { grid-template-columns: 1fr; }
.wiz--mobile .wiz__head-mode             { display: none; }   /* no all-on-one on mobile */

.phone-composer {
  position: sticky; bottom: 60px;             /* above tab bar */
  display: grid; grid-template-columns: 1fr auto;
  gap: 8px; align-items: end;
  background: #fff;
  border-top: 1px solid var(--border);
  padding: 8px 12px env(safe-area-inset-bottom);
}
.phone-composer textarea  { background: var(--mint-200); border: 0; outline: 0;
                             border-radius: 999px; padding: 8px 14px;
                             font-family: var(--font-body); font-size: 13px;
                             color: var(--brand-teal); resize: none; }
.phone-composer__mic {
  width: 36px; height: 36px; border-radius: 999px;
  background: var(--brand-pink); color: #fff; border: 0;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 6px 14px rgba(255,107,107,0.32);
}
```

## Translation: how to actually ship the mobile layout

When `viewport ≤ 768 px` AND the route is `/assistant/*`, the rendered tree changes:

1. **Hide** `<Threads />` (move it behind a slide-over triggered by the back button)
2. **Replace** `<ChatHeader />` with the compact chat header (avatar + 2-line title + more menu)
3. **Replace** `<DealBar />` with the 2-row compact version
4. **Render** all `<MessageBubble />` with `class="msg msg--mobile"`
5. **Collapse** `<ActionCard />` to head + total only; tap to expand
6. **Force** `<Wizard />` to 1-column option grid
7. **Replace** `<Composer />` with the rounded-pill composer
8. **Add** the bottom tab bar (`.ptabs`) — same component as Dashboard's `<Phone>` minus the navigation difference for the center button (here it opens recording, there it navigates)

## Props

```ts
type PhoneAssistantProps = {};   // when shipped as desktop decoration; otherwise this is the mobile layout itself.
```

## Data source

Same as `chat-viewport.md` — eventually `GET /agents/conversations/:id`. Static seed for v1.

## Island vs server

If shipping as a desktop decoration: **server**.
If shipping as the actual mobile layout: each piece is its own island (composer, voice playback, wizard, etc.).

## Accessibility

- Bottom tab bar: `<nav aria-label="Mobile navigation">` with `<a aria-current="page">` for the active route.
- The center pink button is a CTA, not a nav link — `<button aria-label="Open quick actions">` opening a `<dialog>` with mic/photo/file choices.
- The compact deal bar still needs `role="progressbar"` for the phase strip.
- Hide notch/status bar from SR (`aria-hidden="true"`).
- Composer textarea + mic button: same a11y as desktop `Composer`.

## Edge cases

- **Keyboard open:** the composer should rise above the keyboard. Use `visualViewport.height` to detect.
- **Tab bar behind keyboard:** hide on focus.
- **Pull-to-refresh in the chat scroll:** disable to avoid accidental reloads; instead use a manual refresh button in the chat header.
- **Voice recording on iOS:** Safari requires a user gesture; the mic button click counts.
- **No assistant module yet:** show a "Coming soon" empty state with the static seed conversations greyed out.
