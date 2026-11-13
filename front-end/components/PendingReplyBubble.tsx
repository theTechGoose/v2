/**
 * REQ-670 (demo-loop cycle 5, p7 — "Assistant replies never stream"; the
 * backlog's c1-nc-6, c2-nc-stream, c4-nc-no-streaming): the assistant's
 * pending reply in the thread. It shows the reply so far as the server
 * streams it (front-end/lib/chat-stream.ts), else what the turn is doing in
 * words beside the typing dots ("Assistant is thinking…", "Pricing the
 * job…") — never three dots alone.
 *
 * It reads the turn's signal itself, so a streamed piece re-renders this
 * bubble and nothing else: held in the chat island's own state, every piece
 * re-rendered the whole of AsstChat. The bubble is DOM like any other, so
 * the demo stage mirrors it.
 */
import type { Signal } from "@preact/signals";
import { type Lang, tFor } from "../lib/i18n.ts";
import { pendingLabelKey, type PendingReply } from "../lib/chat-stream.ts";

export function PendingReplyBubble(
  { reply, lang }: { reply: Signal<PendingReply>; lang: Lang },
) {
  const { text, stage } = reply.value;
  return (
    <div
      class="msg"
      aria-live="polite"
      aria-label={tFor(lang, "asstChat.bossieThinking")}
      aria-busy={text ? "true" : undefined}
    >
      <div class="msg__avatar">
        <img src="/logo-monster.png" alt="" />
      </div>
      {text
        ? (
          <div
            class="msg__bubble msg__bubble--streaming"
            data-cy="msg-streaming"
          >
            {text}
          </div>
        )
        : (
          <div class="msg__bubble msg__bubble--typing">
            <span class="typing-dot" />
            <span class="typing-dot" />
            <span class="typing-dot" />
            <span class="typing-label" data-cy="msg-typing-label">
              {tFor(lang, pendingLabelKey(stage))}
            </span>
          </div>
        )}
    </div>
  );
}
