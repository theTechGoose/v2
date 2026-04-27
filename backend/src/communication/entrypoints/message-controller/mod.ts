import { Body, Context, Controller, Delete, Get, Param, Post, Put, Query } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { MessageStore } from "@communication/domain/data/message-store/mod.ts";
import { ConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { parseCreateMessage, parseUpdateMessage } from "@communication/dto/message.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/entrypoints/auth-helpers.ts";

/**
 * Messages don't carry their own userId — ownership is inherited via
 * `conversationId`. The controller resolves the conversation through
 * ConversationStore.getOwned() before any read or write to enforce access.
 */
@Controller("messages")
export class MessageController {
  constructor(
    private store: MessageStore,
    private conversations: ConversationStore,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  @Post()
  async create(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const dto = parseCreateMessage(body);
    await this.conversations.getOwned(dto.conversationId, user.id);   // ownership gate
    return await this.store.create(dto);
  }

  @Get()
  async list(@Context() ctx: ExecutionContext, @Query("conversationId") conversationId?: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    if (!conversationId) {
      // Listing every message globally is dangerous; force a conversation filter.
      throw new Error("conversationId query param is required");
    }
    await this.conversations.getOwned(conversationId, user.id);
    return await this.store.listByConversation(conversationId);
  }

  @Get(":id")
  async get(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const msg = await this.store.get(id);
    await this.conversations.getOwned(msg.conversationId, user.id);
    return msg;
  }

  @Put(":id")
  async update(@Context() ctx: ExecutionContext, @Param("id") id: string, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const existing = await this.store.get(id);
    await this.conversations.getOwned(existing.conversationId, user.id);
    return await this.store.update(id, parseUpdateMessage(body));
  }

  @Delete(":id")
  async delete(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const existing = await this.store.get(id);
    await this.conversations.getOwned(existing.conversationId, user.id);
    await this.store.delete(id);
    return { ok: true };
  }
}
