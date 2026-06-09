import type { Message } from "../clients/assistant.ts";
import { tFor } from "../lib/i18n.ts";

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function MessageBubble(
  { msg, lang = "en" }: { msg: Message; lang?: "en" | "es" },
) {
  const mine = msg.role === "user";
  const initial = mine
    ? tFor(lang, "messageBubble.youInitial")
    : tFor(lang, "messageBubble.assistantInitial");
  return (
    <div class={`msg ${mine ? "msg--user" : ""}`}>
      <div class="msg__avatar">{initial.slice(0, 1)}</div>
      <div class="col" style="gap:2px">
        <div class="msg__bubble">{msg.content}</div>
        <div class="msg__time">{fmtTime(msg.createdAt)}</div>
      </div>
    </div>
  );
}

export function PhaseDivider({ label }: { label: string }) {
  return (
    <div class="phase-divider">
      <span class="phase-divider__line" />
      <span class="phase-divider__label">{label}</span>
      <span class="phase-divider__line" />
    </div>
  );
}
