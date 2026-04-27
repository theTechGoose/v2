/**
 * Derive a thread-list-friendly title and preview from a chat message.
 *
 * `title` comes from the very first user message in a conversation;
 * `preview` from the most recent meaningful exchange. Both are short and
 * single-line, so the threads sidebar layout doesn't jump.
 */

const TITLE_MAX = 60;
const PREVIEW_MAX = 90;

export function deriveTitleFromFirstUserMessage(text: string): string {
  const cleaned = singleLine(text).trim();
  if (cleaned.length === 0) return "New conversation";
  return cleaned.length > TITLE_MAX ? cleaned.slice(0, TITLE_MAX - 1) + "…" : cleaned;
}

export function derivePreview(text: string): string {
  const cleaned = singleLine(text).trim();
  if (cleaned.length === 0) return "";
  return cleaned.length > PREVIEW_MAX ? cleaned.slice(0, PREVIEW_MAX - 1) + "…" : cleaned;
}

function singleLine(s: string): string {
  return s.replace(/\s+/g, " ");
}
