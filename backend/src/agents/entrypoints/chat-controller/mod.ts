import { Body, Context, Controller, Post } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { HandleChatMessage } from "@agents/domain/coordinators/handle-chat-message/mod.ts";
import { StartConversation } from "@agents/domain/coordinators/start-conversation/mod.ts";
import { parseChatInput } from "@agents/dto/message.ts";
import { FileStore } from "@files/domain/data/file-store/mod.ts";
import { ProcessVoiceMemo } from "@files/domain/coordinators/process-voice-memo/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";

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
 */
@Controller("agents/chat")
export class ChatController {
  constructor(
    private startFlow: StartConversation,
    private chatFlow: HandleChatMessage,
    private files: FileStore,
    private voiceMemo: ProcessVoiceMemo,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  @Post()
  async chat(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const dto = parseChatInput(body);

    let conversationId = dto.conversationId;
    if (!conversationId) {
      const conv = await this.startFlow.run({ userId: user.id });
      conversationId = conv.id;
    }

    let content = dto.content;
    let payload: Record<string, unknown> | undefined;

    if (dto.kind === "voice") {
      const fileId = (dto.payload as { fileId?: unknown } | undefined)?.fileId;
      if (typeof fileId !== "string" || !fileId) {
        throw new Error("voice chat requires payload.fileId");
      }
      content = await resolveTranscript(this.files, this.voiceMemo, fileId, user.id);
      payload = { fileId };
    } else if (dto.kind === "image") {
      const fileId = (dto.payload as { fileId?: unknown } | undefined)?.fileId;
      if (typeof fileId !== "string" || !fileId) {
        throw new Error("image chat requires payload.fileId");
      }
      // Validate the image exists + caller owns it. Bytes are loaded by
      // HandleChatMessage on demand so they get re-attached to every
      // future LLM turn, not just this one.
      const meta = await this.files.getOwnedMeta(fileId, user.id);
      payload = { fileId, filename: meta.filename };
      if (!content || !content.trim()) content = `[Photo attached: ${meta.filename}]`;
    }
    if (!content || !content.trim()) {
      throw new Error("chat requires non-empty content");
    }

    const result = await this.chatFlow.run({
      userId: user.id,
      conversationId,
      content,
      kind: dto.kind,
      ...(payload ? { payload } : {}),
    });

    return ctx.json(result);
  }
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
