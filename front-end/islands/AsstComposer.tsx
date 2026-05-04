import { useEffect, useState } from "preact/hooks";
import { I, ICN } from "../lib/dash-icons.tsx";
import { assistantClient } from "../clients/assistant.ts";

interface Props { conversationId?: string }

export default function AsstComposer({ conversationId }: Props) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const storageKey = `pm:composer:${conversationId ?? "new"}`;

  useEffect(() => {
    const saved = globalThis.localStorage?.getItem(storageKey);
    if (saved) setDraft(saved);
  }, [storageKey]);

  useEffect(() => {
    if (!globalThis.localStorage) return;
    if (draft.length === 0) globalThis.localStorage.removeItem(storageKey);
    else globalThis.localStorage.setItem(storageKey, draft);
  }, [draft, storageKey]);

  async function send() {
    const content = draft.trim();
    if (!content) return;
    setSending(true);
    try {
      await assistantClient.chat({ conversationId, content });
      setDraft("");
      globalThis.localStorage?.removeItem(storageKey);
      globalThis.location.reload();
    } catch { /* backend not ready */ } finally { setSending(false); }
  }

  return (
    <div class="composer">
      <div class="composer__inner">
        <textarea
          class="composer__input"
          placeholder="help me draft a kitchen remodel quote"
          rows={1}
          value={draft}
          onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <div class="composer__tools">
          <button type="button" class="composer__btn" title="Attach photo"><I d={ICN.img} size={17} /></button>
          <button type="button" class="composer__btn" title="Attach file"><I d={ICN.clip} size={17} /></button>
          <button type="button" class="composer__btn" title="Voice memo"><I d={ICN.mic} size={17} /></button>
          <button type="button" class="composer__send" title="Send" onClick={send} disabled={sending || !draft.trim()}>
            <I d={ICN.arrow} size={16} sw={2.4} />
          </button>
        </div>
      </div>
      <div class="composer__hint">
        <kbd>⏎</kbd> send · <kbd>⇧⏎</kbd> new line · <kbd>⌘K</kbd> commands
      </div>
    </div>
  );
}
