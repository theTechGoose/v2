import { Body, Context, Controller, Post } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { HandleChatMessage } from "@agents/domain/coordinators/handle-chat-message/mod.ts";
import { StartConversation } from "@agents/domain/coordinators/start-conversation/mod.ts";
import { parseChatInput } from "@agents/dto/message.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/entrypoints/auth-helpers.ts";

/**
 * POST /agents/chat
 *
 * Body: { conversationId?, content, kind? }
 *
 * If `conversationId` is omitted, a new conversation is created server-side
 * (so the very first message from the assistant page can fire without an
 * extra round-trip to /agents/conversations).
 */
@Controller("agents/chat")
export class ChatController {
  constructor(
    private startFlow: StartConversation,
    private chatFlow: HandleChatMessage,
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

    const result = await this.chatFlow.run({
      userId: user.id,
      conversationId,
      content: dto.content,
      kind: dto.kind,
    });

    return ctx.json(result);
  }
}
