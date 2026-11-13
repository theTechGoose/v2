/**
 * REQ-670 (demo-loop cycle 5, p7 — "Assistant replies never stream"; the
 * backlog's c1-nc-6, c2-nc-stream, c4-nc-no-streaming): a chat turn as it
 * happens. POST /agents/chat ran the whole turn — the model, the tools, the
 * re-asks, the price checks — and answered once, so the chat showed dots and
 * then the whole reply at once. POST /agents/chat/stream answers with these
 * events instead, then the same whole turn.
 *
 *   delta     {text}   more of the reply, appended to what the bubble shows
 *   text      {text}   the reply so far, rewritten (shaping changed it)
 *   progress  {stage}  what the turn is doing — pricing, drafting the quote,
 *                      saving a change; the prose shown so far is dropped
 *   done      {conversation, newMessages}  the whole turn (= the JSON route)
 *   error     {message, name}              the turn failed
 */
import type {
  LLMStreamSink,
  LLMToolName,
} from "@agents/domain/business/llm/base/mod.ts";

export type ChatStage = "pricing" | "drafting" | "saving";

export type ChatTurnEvent =
  | { type: "delta"; text: string }
  | { type: "text"; text: string }
  | { type: "progress"; stage: ChatStage };

export type TurnEmit = (event: ChatTurnEvent) => void;

export interface TurnChannel {
  /** What the turn is doing now — said once in a row; it clears the prose. */
  stage(stage: ChatStage): void;
  /** A sink for one model call's prose. The bubble shows `shape(raw so far)`
   *  — the stored reply's own shaping (plain text) — so it never ends on
   *  something the stored reply won't say. A tool call starting is drafting
   *  (create_quote) or saving (anything else). */
  prose(shape: (raw: string) => string): LLMStreamSink;
}

/** The turn's event channel over `emit`. A listener that throws (a client
 *  that went away) never breaks the turn. */
export function turnChannel(emit: TurnEmit): TurnChannel {
  const send = (event: ChatTurnEvent) => {
    try {
      emit(event);
    } catch {
      // the listener is gone — the turn goes on and is saved either way
    }
  };
  /** what the bubble shows now */
  let shown = "";
  let current: ChatStage | undefined;
  const stage = (next: ChatStage) => {
    if (next === current) return;
    current = next;
    shown = "";
    send({ type: "progress", stage: next });
  };
  return {
    stage,
    prose(shape) {
      let raw = "";
      return {
        text(delta: string) {
          raw += delta;
          const next = shape(raw);
          if (!next.trim() || next === shown) return;
          send(
            next.startsWith(shown)
              ? { type: "delta", text: next.slice(shown.length) }
              : { type: "text", text: next },
          );
          shown = next;
        },
        tool(name: LLMToolName) {
          stage(name === "create_quote" ? "drafting" : "saving");
        },
      };
    },
  };
}

/** One server-sent event: its name, its JSON on one data line (JSON escapes
 *  every newline), a blank line after. */
export function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  // never buffered or re-encoded on the way (proxies, CDNs, nginx)
  "cache-control": "no-cache, no-transform",
  "x-accel-buffering": "no",
};

/**
 * The turn as a text/event-stream: the headers go out at once, each event as
 * the turn emits it, then `done` with the turn's result — or `error`
 * ({message, name}; a TimeoutError keeps its name, so the chat offers its
 * Retry). The turn runs to its end when the client goes away mid-stream: its
 * messages are saved either way, as on the JSON route.
 */
export function sseTurn<T>(run: (emit: TurnEmit) => Promise<T>): Response {
  const enc = new TextEncoder();
  let open = true;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(enc.encode(sseFrame(event, data)));
        } catch {
          open = false;
        }
      };
      const close = () => {
        if (!open) return;
        open = false;
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      };
      let turn: Promise<T>;
      try {
        turn = run((e) =>
          send(
            e.type,
            e.type === "progress" ? { stage: e.stage } : { text: e.text },
          )
        );
      } catch (err) {
        turn = Promise.reject(err);
      }
      turn.then(
        (result) => send("done", result),
        (err) => {
          console.error("[chat-stream] turn failed:", err);
          send("error", {
            message: err instanceof Error ? err.message : String(err),
            name: err instanceof Error ? err.name : "Error",
          });
        },
      ).finally(close);
    },
    cancel() {
      open = false;
    },
  });
  return new Response(body, { status: 200, headers: SSE_HEADERS });
}
