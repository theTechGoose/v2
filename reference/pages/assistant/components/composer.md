# `Composer` (and `Suggestions`) — Bottom message input

> ⚠️ **DEFERRED — depends on agents module.** The UI shell is buildable in v1 (textarea + buttons + draft persistence). The "Send" handler that POSTs to `/agents/chat` is deferred.

## Purpose

Sticky bottom dock with: a multi-line textarea ("Tell me what you need — or hit the mic and just talk."), three left-side tool buttons (attach photo, attach file, voice memo), a primary send button, and a hint line below showing keyboard shortcuts (`⏎ send · ⇧⏎ new line · ⌘K commands`). Above the composer, a "Suggestions" row with quick-reply chips ("Net 30 instead", "Re-open the quote", "Use last contract").

## Source

- Composer JSX: `Paperwork Monsters Assistant.html` lines **4535–4556**
- Suggestions JSX: lines **4526–4533**
- Inline CSS: search for `.composer`, `.composer__inner/input/tools/btn/send/hint`, `.suggest`, `.suggest__chip`

## JSX (verbatim — Suggestions)

```jsx
const Suggestions = () => (
  <div className="suggest">
    <span style={{
      fontSize:11, fontWeight:800, letterSpacing:'0.06em',
      color:'var(--fg-subtle)', textTransform:'uppercase',
      alignSelf:'center', marginRight:4
    }}>Or just type:</span>
    <button className="suggest__chip"><I d={ICN.bolt} size={11}/> "Net 30 instead"</button>
    <button className="suggest__chip"><I d={ICN.refresh} size={11}/> Re-open the quote</button>
    <button className="suggest__chip"><I d={ICN.bookmark} size={11}/> Use last contract</button>
  </div>
);
```

## JSX (verbatim — Composer)

```jsx
const Composer = () => (
  <div className="composer">
    <div className="composer__inner">
      <textarea
        className="composer__input"
        placeholder="Tell me what you need — or hit the mic and just talk."
        rows={1}
      />
      <div className="composer__tools">
        <button className="composer__btn" title="Attach photo"><I d={ICN.img}  size={17}/></button>
        <button className="composer__btn" title="Attach file"> <I d={ICN.clip} size={17}/></button>
        <button className="composer__btn" title="Voice memo">   <I d={ICN.mic}  size={17}/></button>
        <button className="composer__send" title="Send">
          <I d={ICN.arrow} size={16} sw={2.4}/>
        </button>
      </div>
    </div>
    <div className="composer__hint">
      <kbd>⏎</kbd> send · <kbd>⇧⏎</kbd> new line · <kbd>⌘K</kbd> commands
    </div>
  </div>
);
```

## CSS (intended structure)

```css
.suggest {
  display: flex; flex-wrap: wrap; gap: 6px;
  padding: 0 24px 10px;
}
.suggest__chip {
  display: inline-flex; align-items: center; gap: 6px;
  background: #fff; border: 1px solid var(--border-strong);
  border-radius: 999px;
  padding: 6px 12px;
  font-family: var(--font-heading); font-weight: 700; font-size: 12px;
  color: var(--brand-teal); cursor: pointer;
  transition: all 200ms var(--ease-bounce);
}
.suggest__chip:hover { border-color: var(--brand-pink); transform: translateY(-1px); }

.composer {
  padding: 8px 24px 16px;
  background: linear-gradient(180deg, transparent 0%, var(--bg) 100%);
}
.composer__inner {
  display: grid; grid-template-columns: 1fr auto;
  gap: 8px; align-items: end;
  background: #fff;
  border: 1.5px solid var(--border-strong);
  border-radius: 16px;
  padding: 8px 8px 8px 14px;
  transition: border-color 200ms;
}
.composer__inner:focus-within { border-color: var(--brand-green);
                                  box-shadow: 0 0 0 4px rgba(81,152,67,0.15); }
.composer__input {
  background: transparent; border: 0; outline: 0;
  font-family: var(--font-body); font-size: 14px; line-height: 1.5;
  color: var(--brand-teal);
  resize: none; overflow-y: auto;
  max-height: 160px; min-height: 36px;
  padding: 6px 0;
  width: 100%;
}
.composer__input::placeholder { color: var(--fg-subtle); }

.composer__tools { display: flex; gap: 4px; align-items: center; }
.composer__btn   { width: 32px; height: 32px; border-radius: 8px;
                   background: transparent; border: 0; cursor: pointer;
                   color: var(--fg-muted);
                   display: flex; align-items: center; justify-content: center;
                   transition: all 120ms; }
.composer__btn:hover { background: var(--mint-200); color: var(--brand-teal); }
.composer__send {
  width: 36px; height: 36px; border-radius: 10px;
  background: var(--brand-pink); color: #fff;
  border: 0; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 6px 14px rgba(255,107,107,0.32);
  transition: all 200ms var(--ease-bounce);
}
.composer__send:hover         { transform: translateY(-1px); }
.composer__send:disabled      { opacity: 0.5; cursor: not-allowed; transform: none; }

.composer__hint {
  margin-top: 6px;
  font-size: 11px; color: var(--fg-subtle);
  display: flex; gap: 8px; align-items: center;
}
.composer__hint kbd {
  font-family: var(--font-mono); font-size: 10px;
  background: rgba(0,0,0,0.05);
  padding: 1px 5px; border-radius: 4px;
  color: var(--fg-muted);
}
```

## Preact / Fresh translation

```tsx
// v2/frontend/islands/Composer.tsx — island

import { useEffect, useRef, useState } from "preact/hooks";
import * as I from "../components/ui/icons.tsx";

export function Composer(props: { threadId: string; onSend: (text: string) => Promise<void> }) {
  const [v, setV] = useState('');
  const [recording, setRecording] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);

  // Restore draft from localStorage
  useEffect(() => {
    const k = `asst:draft:${props.threadId}`;
    setV(localStorage.getItem(k) ?? '');
  }, [props.threadId]);

  // Persist draft
  useEffect(() => {
    const k = `asst:draft:${props.threadId}`;
    if (v) localStorage.setItem(k, v);
    else   localStorage.removeItem(k);
  }, [v, props.threadId]);

  // Auto-resize
  useEffect(() => {
    if (!ta.current) return;
    ta.current.style.height = 'auto';
    ta.current.style.height = Math.min(ta.current.scrollHeight, 160) + 'px';
  }, [v]);

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }
  async function send() {
    const text = v.trim();
    if (!text) return;
    setV('');
    await props.onSend(text);
  }

  return (
    <div class="composer">
      <div class="composer__inner">
        <textarea ref={ta} class="composer__input"
                  placeholder="Tell me what you need — or hit the mic and just talk."
                  value={v} onInput={e => setV((e.target as HTMLTextAreaElement).value)}
                  onKeyDown={onKey} rows={1} aria-label="Message" />
        <div class="composer__tools">
          <button type="button" class="composer__btn" title="Attach photo" aria-label="Attach photo">
            <I.Img size={17} />
          </button>
          <button type="button" class="composer__btn" title="Attach file" aria-label="Attach file">
            <I.Clip size={17} />
          </button>
          <button type="button" class={`composer__btn ${recording ? 'composer__btn--rec' : ''}`}
                  title="Voice memo" aria-label="Voice memo"
                  aria-pressed={recording}
                  onClick={() => setRecording(!recording)}>
            <I.Mic size={17} />
          </button>
          <button type="button" class="composer__send" title="Send" aria-label="Send"
                  disabled={!v.trim()} onClick={send}>
            <I.Arrow size={16} sw={2.4} />
          </button>
        </div>
      </div>
      <div class="composer__hint">
        <kbd>⏎</kbd> send · <kbd>⇧⏎</kbd> new line · <kbd>⌘K</kbd> commands
      </div>
    </div>
  );
}
```

`Suggestions` is a small server component:

```tsx
export function Suggestions(props: { items: { icon: 'bolt'|'refresh'|'bookmark'; label: string }[] }) {
  return (
    <div class="suggest">
      <span class="text-[11px] font-extrabold uppercase tracking-[0.06em] text-teal-500/55 mr-1">Or just type:</span>
      {props.items.map(s => (
        <button class="suggest__chip" type="button">
          {/* …icon… */} {s.label}
        </button>
      ))}
    </div>
  );
}
```

Suggestions are server-rendered (the chip click triggers a small island that fills the composer with the suggested text).

## Props

```ts
type ComposerProps = { threadId: string; onSend: (text: string) => Promise<void> };
type SuggestionsProps = { items: { icon: 'bolt'|'refresh'|'bookmark'; label: string }[] };
```

## Data source

- Composer: pure UI; `onSend` is supplied by the page-level orchestrator.
- Suggestions: agent-supplied per-conversation. Defaults to a few static chips when the agent hasn't proposed any.

## Island vs server

- Composer: **island.**
- Suggestions: **server** (the click that pre-fills the composer is a tiny inline `onClick` that dispatches a custom event the composer island listens for).

## Accessibility

- `<textarea>` carries `aria-label="Message"`.
- All buttons need explicit `aria-label` (the icon buttons currently have only `title`).
- `aria-pressed={recording}` on the mic button.
- Disabled send needs `aria-disabled="true"` so SR doesn't try to invoke.
- `<kbd>` elements are accessible by default.
- Keyboard:
  - `⏎` → send
  - `⇧⏎` → newline
  - `⌘K` → open command palette (future) — open a slash-command picker
  - `⌘N` → new conversation (handled at page level, not here)
- Voice recording requires mic permission — show a one-time dialog + a tooltip when blocked.

## Edge cases

- **Empty submit:** `disabled={!v.trim()}` prevents sending whitespace.
- **Double-submit:** disable button while `onSend` is in-flight (`useState<'idle'|'sending'>`).
- **Long messages:** textarea grows up to 160 px then scrolls.
- **Paste an image:** `onpaste` handler can intercept clipboard images and push them as attachments.
- **iOS keyboard overlap:** the composer is sticky bottom; on focus, the iOS keyboard pushes it up. Use `padding-bottom: env(safe-area-inset-bottom)`.
- **Lost network mid-send:** queue the message in `localStorage` and retry on reconnect; show a "Pending" pill on the optimistic message bubble.
- **Recording while another voice plays:** pause playback before starting recording.
