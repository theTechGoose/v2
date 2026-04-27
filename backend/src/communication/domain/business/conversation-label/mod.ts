import type { Conversation } from "@communication/dto/conversation.ts";

export function conversationLabel(c: Pick<Conversation, "title" | "id">): string {
  if (c.title && c.title.trim().length > 0) return c.title.trim();
  return `conversation:${c.id.slice(0, 8)}`;
}
