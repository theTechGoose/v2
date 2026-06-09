import { useEffect, useState } from "preact/hooks";
import { I, ICN } from "../lib/dash-icons.tsx";
import { assistantClient } from "../clients/assistant.ts";
import { tFor } from "../lib/i18n.ts";

interface Props {
  conversationId?: string;
  lang?: "en" | "es";
}

export default function AsstComposer({ conversationId, lang = "en" }: Props) {
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
      /* backend not ready */
    } finally {
      setSending(false);
    }
  }

  return (
    <div class="composer">
      <div class="composer__inner">
        <textarea
          class="composer__input"
          placeholder={tFor(lang, "asstComposer.placeholder")}
          rows={3}
          value={draft}
          onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div class="composer__tools">
          <button
            type="button"
            class="composer__btn"
            title={tFor(lang, "asstComposer.attachPhoto")}
          >
            <I d={ICN.img} size={17} />
          </button>
          <button
            type="button"
            class="composer__btn"
            title={tFor(lang, "asstComposer.attachFile")}
          >
            <I d={ICN.clip} size={17} />
          </button>
          <button
            type="button"
            class="composer__btn"
            title={tFor(lang, "asstComposer.voiceMemo")}
          >
            <I d={ICN.mic} size={17} />
          </button>
          <button
            type="button"
            class="composer__send"
            title={tFor(lang, "common.send")}
            onClick={send}
            disabled={sending || !draft.trim()}
          >
            <I d={ICN.arrow} size={16} sw={2.4} />
          </button>
        </div>
      </div>
      <div class="composer__hint">
        <kbd>⏎</kbd> {tFor(lang, "asstComposer.hintSend")} <kbd>⇧⏎</kbd>{" "}
        {tFor(lang, "asstComposer.hintNewLine")} <kbd>⌘K</kbd>{" "}
        {tFor(lang, "asstComposer.hintCommands")}
      </div>
    </div>
  );
}
