import { Body, Context, Controller, Post } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import {
  type HandleChatInput,
  HandleChatMessage,
} from "@agents/domain/coordinators/handle-chat-message/mod.ts";
import { sseTurn } from "@agents/domain/business/chat-stream/mod.ts"; // REQ-670
import { StartConversation } from "@agents/domain/coordinators/start-conversation/mod.ts";
import { parseChatInput } from "@agents/dto/message.ts";
import { parseChatStepHint } from "#quote-flow/step-composer.ts"; // REQ-392
import { FileStore } from "@files/domain/data/file-store/mod.ts";
import { ProcessVoiceMemo } from "@files/domain/coordinators/process-voice-memo/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireSession, uiLangOf } from "@users/domain/coordinators/require-user/mod.ts";

/**
 * POST /agents/chat
 *
 * Body: { conversationId?, content?, kind?, payload? }
 *
 * If `conversationId` is omitted, a new conversation is created server-side
 * (so the very first message from the assistant page can fire without an
 * extra round-trip to /agents/conversations).
 *
 * For `kind: "voice"`, the body looks like `{ kind: "voice", payload:
 * { fileId } }` with no `content`. The controller resolves the transcript
 * synchronously: if the upload's fire-and-forget transcription is still
 * pending, it runs ProcessVoiceMemo inline (which is idempotent) and then
 * uses the transcript as `content` before handing off to the chat flow.
 *
 * POST /agents/chat/stream (REQ-670, demo-loop cycle 5, p7 — "Assistant
 * replies never stream") takes the same body and runs the same turn, answered
 * as text/event-stream: the reply's prose while the model writes it, what the
 * turn is doing meanwhile (pricing, drafting, saving), then `done` with this
 * route's JSON. A request this route refuses is refused there the same way,
 * before any stream starts. This route stays as the fallback.
 */
@Controller("agents/chat")
export class ChatController {
  // REQ-670: readonly, not private — readTurn (module-level) reads them.
  constructor(
    readonly startFlow: StartConversation,
    private chatFlow: HandleChatMessage,
    readonly files: FileStore,
    readonly voiceMemo: ProcessVoiceMemo,
    readonly users: UserStore,
    readonly sessions: SessionStore,
  ) {}

  @Post()
  async chat(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const turn = await readTurn(ctx, body, this);
    const result = await this.chatFlow.run(turn);
    return ctx.json(result);
  }

  /** REQ-670 (demo-loop cycle 5, p7): the same turn, streamed as it happens. */
  @Post("stream")
  async stream(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const turn = await readTurn(ctx, body, this);
    return sseTurn((onEvent) => this.chatFlow.run({ ...turn, onEvent }));
  }
}

/**
 * The chat turn a request asks for — the user (401 without a session), the
 * conversation (a new one when none is named), the content (a voice memo's
 * transcript, a photo's placeholder) and the guided step. Throws what the
 * route answers with (missing file, empty content) before any turn runs.
 * Module-level, not a controller method: Danet routes every method.
 */
async function readTurn(
  ctx: ExecutionContext,
  body: unknown,
  deps: {
    startFlow: StartConversation;
    files: FileStore;
    voiceMemo: ProcessVoiceMemo;
    users: UserStore;
    sessions: SessionStore;
  },
): Promise<HandleChatInput> {
  const signedIn = await requireSession(ctx, deps.sessions, deps.users);
  const user = signedIn.user;
  const dto = parseChatInput(body);

  let conversationId = dto.conversationId;
  if (!conversationId) {
    const conv = await deps.startFlow.run({ userId: user.id });
    conversationId = conv.id;
  }

  let content = dto.content;
  let payload: Record<string, unknown> | undefined;

  if (dto.kind === "voice") {
    const fileId = (dto.payload as { fileId?: unknown } | undefined)?.fileId;
    if (typeof fileId !== "string" || !fileId) {
      throw new Error("voice chat requires payload.fileId");
    }
    content = await resolveTranscript(deps.files, deps.voiceMemo, fileId, user.id);
    payload = { fileId };
  } else if (dto.kind === "image") {
    const fileId = (dto.payload as { fileId?: unknown } | undefined)?.fileId;
    if (typeof fileId !== "string" || !fileId) {
      throw new Error("image chat requires payload.fileId");
    }
    // Validate the image exists + caller owns it. Bytes are loaded by
    // HandleChatMessage on demand so they get re-attached to every
    // future LLM turn, not just this one.
    const meta = await deps.files.getOwnedMeta(fileId, user.id);
    payload = { fileId, filename: meta.filename };
    if (!content || !content.trim()) content = `[Photo attached: ${meta.filename}]`;
  }
  if (!content || !content.trim()) {
    throw new Error("chat requires non-empty content");
  }
  // REQ-392 (demo-loop cycle 2, M7): a text typed in the compact composer
  // on a guided step carries that step; junk is no step (a plain turn).
  const step = (dto.kind ?? "text") === "text"
    ? parseChatStepHint(dto.step)
    : undefined;

  return {
    userId: user.id,
    conversationId,
    content,
    kind: dto.kind,
    ...(payload ? { payload } : {}),
    ...(step ? { step } : {}),
    uiLang: uiLangOf(signedIn), // REQ-631: the assistant answers the person in HER language
  };
}

/**
 * Resolve a voice memo's transcript. Awaits the fire-and-forget job
 * if it's still pending; runs it inline if it never started; falls
 * back to a placeholder so the chat doesn't dead-end on a transcription
 * failure (the user can re-send manually). Module-level helper, not a
 * controller method — Danet's router iterates over class methods and
 * crashes on undecorated ones with "Cannot read properties of undefined
 * (reading 'length')".
 */
async function resolveTranscript(
  files: FileStore,
  voiceMemo: ProcessVoiceMemo,
  fileId: string,
  userId: string,
): Promise<string> {
  let meta = await files.getOwnedMeta(fileId, userId);
  if (meta.transcriptStatus !== "ready" && meta.transcriptStatus !== "failed") {
    await voiceMemo.run({ fileId, userId });
    meta = await files.getOwnedMeta(fileId, userId);
  }
  const text = meta.transcript?.trim();
  if (text) return text;
  return "[voice memo — transcription unavailable]";
}
