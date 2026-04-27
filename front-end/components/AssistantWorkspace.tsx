import type { Conversation, ConversationDetail, Message, Quote } from "../clients/assistant.ts";
import { MessageBubble, PhaseDivider } from "./MessageBubble.tsx";
import Threads from "../islands/Threads.tsx";
import Composer from "../islands/Composer.tsx";

interface Props {
  groups: { label: string; items: Conversation[] }[];
  activeId?: string;
  detail?: ConversationDetail;
  quotePreview?: Quote;
}

const PHASE_LABEL: Record<string, string> = {
  chat: "Phase 1 · Chat",
  terms: "Phase 2 · Contract terms",
  send: "Phase 3 · Send",
};

function fmtMoney(n?: number): string {
  if (n === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export function AssistantWorkspace({ groups, activeId, detail, quotePreview }: Props) {
  const conversation = detail?.conversation;
  const messages: Message[] = detail?.messages ?? [];

  return (
    <section class="asst">
      <Threads groups={groups} activeId={activeId} />
      <div class="chat">
        <header class="chat__head">
          <div>
            <strong>{conversation?.customerName ?? conversation?.title ?? "New conversation"}</strong>
            {conversation?.phase ? (
              <div class="micro">{PHASE_LABEL[conversation.phase] ?? conversation.phase}</div>
            ) : null}
          </div>
        </header>
        <div class="chat__scroll">
          {conversation?.phase ? <PhaseDivider label={PHASE_LABEL[conversation.phase] ?? conversation.phase} /> : null}
          {messages.length === 0
            ? (
              <div class="muted center" style="padding:40px">
                Pick a conversation or start a new one.
              </div>
            )
            : messages.map((m) => <MessageBubble key={m.id} msg={m} />)}
        </div>
        <Composer conversationId={activeId} />
      </div>
      <aside class="docpane">
        <div class="docpane__title">Active document</div>
        {quotePreview
          ? (
            <div class="doc-preview">
              <div class="row spread"><strong>{quotePreview.summary ?? "Quote"}</strong>
                <span class="tag tag--sent">{quotePreview.status ?? "draft"}</span></div>
              <div class="row" style="padding:8px 0">{fmtMoney(quotePreview.estimatedTotal)}</div>
            </div>
          )
          : <p class="micro muted">No document linked yet.</p>}
      </aside>
    </section>
  );
}
