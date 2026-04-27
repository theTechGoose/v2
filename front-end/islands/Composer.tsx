import { useEffect, useState } from "preact/hooks";
import { Icon } from "../components/ui/Icon.tsx";
import { assistantClient } from "../clients/assistant.ts";

interface Props {
  conversationId?: string;
}

export default function Composer({ conversationId }: Props) {
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
    } catch {
      // Backend not ready in v1 — leave the draft in place.
    } finally {
      setSending(false);
    }
  }

  return (
    <div class="composer">
      <div class="composer__inner">
        <button class="btn btn-ghost" type="button" aria-label="Attach"><Icon name="image" /></button>
        <button class="btn btn-ghost" type="button" aria-label="Voice"><Icon name="mic" /></button>
        <textarea
          rows={1}
          placeholder="Tell Bossie what to do…"
          value={draft}
          onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
          }}
        />
        <button class="composer__send" type="button" disabled={sending || draft.trim().length === 0} onClick={send}>
          <Icon name="send" /> Send
        </button>
      </div>
    </div>
  );
}
