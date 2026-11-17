/**
 * REQ-670 (demo-loop cycle 5, p7 — "Assistant replies never stream"; the
 * backlog's c1-nc-6, c2-nc-stream, c4-nc-no-streaming): the assistant's reply
 * as it is written. The chat awaited the whole JSON turn and then showed the
 * reply at once, under a typing bubble of three dots and no words (pairs 3
 * and 7, on both sides of the demo).
 *
 * POST /agents/chat/stream answers text/event-stream
 * (backend/src/agents/domain/business/chat-stream/mod.ts):
 *
 *   delta     {text}   more of the reply — appended to the pending bubble
 *   text      {text}   the reply so far, rewritten — replaces it
 *   progress  {stage}  what the turn is doing (pricing / drafting / saving) —
 *                      the prose so far is dropped, the stage is named
 *   done      {conversation, newMessages}  the whole turn, as POST /agents/chat
 *   error     {message, name}              the turn failed
 *
 * The pending bubble is DOM like any other, so the demo stage mirrors it.
 */
import { TimeoutError } from "../../shared/quote-flow/chat-timeout.ts";

export type ChatStage = "pricing" | "drafting" | "saving";

export type ChatStreamEvent =
  | { type: "delta"; text: string }
  | { type: "text"; text: string }
  | { type: "progress"; stage: ChatStage };

export interface SseFrame {
  event: string;
  data: string;
}

/** Whole frames out of what has arrived so far; `rest` is an unfinished frame
 *  to prepend to the next read. CRLF or LF; comment lines (": …") skipped;
 *  several data lines joined with "\n". */
export function parseSse(buffer: string): { frames: SseFrame[]; rest: string } {
  const text = buffer.replace(/\r\n?/g, "\n");
  const blocks = text.split("\n\n");
  const rest = blocks.pop() ?? "";
  const frames: SseFrame[] = [];
  for (const block of blocks) {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (!line || line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    if (data.length) frames.push({ event, data: data.join("\n") });
  }
  return { frames, rest };
}

/** What the pending reply bubble shows: the prose so far, else the stage. */
export interface PendingReply {
  text: string;
  stage: ChatStage | null;
}

export const NO_REPLY_YET: PendingReply = { text: "", stage: null };

/** The pending bubble after one event: a delta appends, a text replaces, a
 *  stage clears the prose and names itself. */
export function pendingReply(
  state: PendingReply,
  event: ChatStreamEvent,
): PendingReply {
  if (event.type === "delta") {
    return { ...state, text: state.text + event.text };
  }
  if (event.type === "text") return { ...state, text: event.text };
  return { text: "", stage: event.stage };
}

/** The words the pending bubble shows while no prose has arrived. */
export function pendingLabelKey(stage: ChatStage | null): string {
  return `asstChat.reply.${stage ?? "thinking"}`;
}

const STAGES = new Set<string>(["pricing", "drafting", "saving"]);

/** One frame as a turn event; anything else (done / error / unknown) → null. */
function eventOf(frame: SseFrame): ChatStreamEvent | null {
  let data: { text?: unknown; stage?: unknown };
  try {
    data = JSON.parse(frame.data);
  } catch {
    return null;
  }
  if (
    (frame.event === "delta" || frame.event === "text") &&
    typeof data?.text === "string"
  ) {
    return { type: frame.event, text: data.text };
  }
  if (
    frame.event === "progress" && typeof data?.stage === "string" &&
    STAGES.has(data.stage)
  ) {
    return { type: "progress", stage: data.stage as ChatStage };
  }
  return null;
}

/**
 * Read the turn's stream to its end: each event to `onEvent` as it arrives,
 * resolving with `done`'s turn. An `error` event rejects with its message — a
 * TimeoutError when the server's turn timed out, so the chat shows its
 * friendly message and Retry — and so does a stream that ends without `done`
 * (never a silent, empty turn).
 */
export async function readChatStream<T>(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      const { frames, rest } = parseSse(done ? `${buffer}\n\n` : buffer);
      buffer = rest;
      for (const frame of frames) {
        if (frame.event === "done") return JSON.parse(frame.data) as T;
        if (frame.event === "error") {
          let err: { message?: string; name?: string } = {};
          try {
            err = JSON.parse(frame.data);
          } catch { /* not JSON — the generic message below */ }
          const message = err.message || "The assistant could not answer";
          throw err.name === "TimeoutError"
            ? new TimeoutError(message)
            : new Error(message);
        }
        const event = eventOf(frame);
        if (event) onEvent(event);
      }
      if (done) break;
    }
  } finally {
    // done / error came — nothing more is read from this response
    reader.cancel().catch(() => {});
  }
  throw new Error("The assistant's reply was cut off");
}
