# `MessageBubble` — Avatar + bubble + timestamp scaffold

> ⚠️ **DEFERRED — depends on agents module.** The component itself is structurally simple; deferred only because content comes from the chat stream.

## Purpose

The repeating row inside `ChatScroll`: a 28×28 avatar (assistant logo or user initials), a message bubble (text/HTML/photos) or an arbitrary slotted child (used for action-cards, wizards, voice memos, continue-CTAs), and a small timestamp underneath. User messages mirror to the right; assistant messages anchor left.

## Source

- JSX patterns: throughout `ChatScroll` (Assistant.html lines **4310–4524**)
- Inline CSS: search for `.msg`, `.msg__avatar`, `.msg__bubble`, `.msg__time`, `.msg__photos`, `.msg__photo`, `.msg__photo--{1,2,3}`, `.msg--user`

## JSX patterns (verbatim — three flavors)

### Plain text

```jsx
<div className="msg msg--user">
  <div className="msg__avatar">DR</div>
  <div>
    <div className="msg__bubble">Looks good. Lock it in.</div>
    <div className="msg__time">8:44 AM</div>
  </div>
</div>
```

### Text + photo grid

```jsx
<div className="msg msg--user">
  <div className="msg__avatar">DR</div>
  <div>
    <div className="msg__bubble">
      Grind. Polyaspartic. Here's the floor — couple oil stains in the back corner, factor that in.
      <div className="msg__photos">
        <div className="msg__photo msg__photo--1"><I d={ICN.img} size={20}/></div>
        <div className="msg__photo msg__photo--2"><I d={ICN.img} size={20}/></div>
        <div className="msg__photo msg__photo--3"><I d={ICN.img} size={20}/></div>
      </div>
    </div>
    <div className="msg__time">8:43 AM</div>
  </div>
</div>
```

### Text + slotted child (action-card / wizard / voice / continue)

```jsx
<div className="msg">
  <div className="msg__avatar"><img src={window.LOGO_DATA_URL} alt=""/></div>
  <div style={{flex:1, minWidth:0}}>
    <div className="msg__bubble">On it. Here's your quote, ready to look at.</div>
    <ChildComponent /> {/* ActionCard | Wizard | etc. */}
    <div className="msg__time">8:43 AM · 47 sec to draft</div>
  </div>
</div>
```

## CSS (intended structure)

```css
.msg {
  display: grid; grid-template-columns: 28px 1fr;
  gap: 10px; align-items: flex-start;
  margin-bottom: 4px;
}
.msg--user            { grid-template-columns: 1fr 28px;
                        justify-content: end; text-align: right; }
.msg--user .msg__avatar { order: 2; }
.msg--user > div:nth-child(2),
.msg--user .msg__bubble  { text-align: left; }            /* keep text LTR */

.msg__avatar {
  width: 28px; height: 28px; border-radius: 8px;
  background: var(--brand-green); color: #fff;
  font-family: var(--font-heading); font-weight: 800; font-size: 11px;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden; flex-shrink: 0;
}
.msg__avatar img      { width: 22px; height: 22px; }

.msg__bubble {
  display: inline-block;
  background: #fff; color: var(--brand-teal);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px 14px;
  font-size: 13px; line-height: 1.5;
  font-family: var(--font-body);
  max-width: 78%;
  text-align: left;
}
.msg--user .msg__bubble {
  background: var(--brand-green); color: #fff;
  border-color: transparent;
}
.msg--user .msg__bubble strong { color: #fff; }

.msg__time {
  font-size: 10px; color: var(--fg-subtle);
  font-family: var(--font-heading); font-weight: 700;
  margin-top: 4px;
  letter-spacing: 0.04em;
}

/* photo grid (3 thumbs) */
.msg__photos {
  margin-top: 10px;
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px;
}
.msg__photo {
  aspect-ratio: 1;
  border-radius: 10px;
  background: var(--mint-200);
  display: flex; align-items: center; justify-content: center;
  color: var(--fg-muted);
  position: relative; overflow: hidden;
}
.msg__photo--1 { background: linear-gradient(135deg, #d4e7d4, #aac9a8); }
.msg__photo--2 { background: linear-gradient(135deg, #e0d3c4, #b89c83); }
.msg__photo--3 { background: linear-gradient(135deg, #d2dee0, #9eb6ba); }
```

## Preact / Fresh translation

```tsx
// v2/frontend/components/assistant/MessageBubble.tsx — server component scaffold

type MessageBubbleProps = {
  side: 'user' | 'assistant';
  time: string;
  avatar: string;          // initials for user, "PM" for assistant
  html?: string;           // sanitized HTML to render in bubble
  text?: string;           // plain text alternative
  photos?: string[];       // image URLs (when implemented)
  children?: preact.ComponentChildren;   // slotted card/wizard/voice
};

export function MessageBubble(p: MessageBubbleProps) {
  return (
    <div class={`msg ${p.side === 'user' ? 'msg--user' : ''}`}>
      <div class="msg__avatar">
        {p.avatar === 'PM'
          ? <img src="/logo-monster.png" alt="" width={22} height={22} />
          : p.avatar}
      </div>
      <div style="flex:1; min-width:0">
        {(p.html || p.text) && (
          <div class="msg__bubble">
            {p.html
              ? <span dangerouslySetInnerHTML={{ __html: p.html }} />
              : p.text}
            {p.photos && p.photos.length > 0 && (
              <div class="msg__photos">
                {p.photos.slice(0, 3).map((src, i) => (
                  <div class={`msg__photo msg__photo--${i + 1}`}>
                    <img src={src} alt="" loading="lazy" />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {p.children}
        <div class="msg__time">{p.time}</div>
      </div>
    </div>
  );
}
```

The HTML rendering uses `dangerouslySetInnerHTML` because messages may contain `<strong>`, `<em>`, `<br/>`, and `<ul><li>` formatting. **The agents-module response must sanitize** — never render raw user input. Acceptable since the agent generates the HTML server-side.

## Props

See above.

## Data source

`Conversation.messages` (FUTURE — `backend.md` §4). Per-message shape:

```ts
type Message = {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  channel: 'text' | 'voice' | 'web';
  content: string;            // sanitized HTML or plain text
  createdAt: string;
  attachments?: { type: 'image' | 'file'; url: string }[];
};
```

The `Communication.message` DTO in v2 already covers most of this — extend with `attachments` when needed.

## Island vs server

**Server.** The bubble itself has no JS. Slotted children (action card actions, voice playback, wizard step changes) are their own islands.

## Accessibility

- The `<div class="msg">` should be `role="article"` with `aria-label={`${avatar} ${time}`}`.
- The avatar `<img>` for the assistant has empty alt — correct (decorative; the role and label provide context).
- For user messages, the initials avatar is decorative — ensure SR doesn't read it as text. Wrap in `<span aria-hidden="true">`.
- Photo thumbs: when real photos arrive, add `alt={fileName}` and clickable to open lightbox.
- Time text needs no special handling — it's a sibling of the bubble, not a tooltip.

## Edge cases

- **Bubble overflow:** `max-width: 78%` keeps bubbles from spanning the whole pane. Long words still need `word-wrap: break-word`.
- **HTML safety:** strip `<script>`, on-event attributes, and form elements server-side.
- **Empty bubble + child:** render only the child (e.g., a wizard inside an otherwise-empty bubble shouldn't show an empty white box).
- **Mobile (<768px):** avatars shrink to 24 px and bubble `max-width: 88%`.
- **User messages with photos:** the prototype's three-photo grid is decorative; real photos use the same `.msg__photo` shell with a real `<img>`.
- **More than 3 photos:** show first 3 with a "+N" overlay on the third.
