import type { MessageChannel } from "@communication/dto/message.ts";

export function requiresAddress(channel: MessageChannel): boolean {
  return channel === "email" || channel === "text" || channel === "phone";
}

export function supportsSubject(channel: MessageChannel): boolean {
  return channel === "email";
}

export function channelLabel(channel: MessageChannel): string {
  return channel === "in_person" ? "in person" : channel;
}
