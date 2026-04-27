import type { Message, MessageRole } from "@communication/dto/message.ts";

export function isFromUser(m: Pick<Message, "role">): boolean {
  return m.role === "user";
}

export function isFromAssistant(m: Pick<Message, "role">): boolean {
  return m.role === "assistant";
}

export function rolePrefix(role: MessageRole): string {
  return role === "user" ? "U:" : role === "assistant" ? "A:" : "S:";
}
