import type { Message } from "@communication/dto/message.ts";

export function truncateContent(
  m: Pick<Message, "content">,
  maxLength: number,
): string {
  const text = m.content ?? "";
  if (text.length <= maxLength) return text;
  if (maxLength <= 1) return text.slice(0, maxLength);
  return text.slice(0, maxLength - 1) + "…";
}
