/**
 * REQ-262 (demo M25) — chat replies are plain text. The chat bubble renders
 * the message verbatim (white-space: pre-wrap, no markdown renderer), so a
 * model reply like "- **English:** …" showed its asterisks to the contractor.
 * The prompts ask for plain text; this is the guarantee, applied to every
 * assistant chat reply before it is stored.
 *
 * Strips: **bold** / __bold__, *italic* / _italic_ (only when hugging a
 * word, so "3 * 4" survives), `code`, ``` fences, "# " headings,
 * [text](url) links (→ "text (url)"). "-" / "*" / "+" bullets become "•";
 * numbered lists are already plain and stay.
 */
export function toPlainChatText(text: string): string {
  if (!text) return "";
  return text
    .replace(/```[a-zA-Z0-9_-]*\n?([\s\S]*?)```/g, "$1")
    .split("\n")
    .map((line) =>
      line
        .replace(/^(\s*)#{1,6}\s+/, "$1")
        .replace(/^(\s*)[-*+]\s+/, "$1• ")
        .replace(/^(\s*)>\s?/, "$1")
    )
    .join("\n")
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)")
    .replace(/\*\*(\S(?:[^*\n]*\S)?)\*\*/g, "$1")
    .replace(/__(\S(?:[^_\n]*\S)?)__/g, "$1")
    .replace(/(^|[^\w*])\*(\S(?:[^*\n]*\S)?)\*(?![\w*])/g, "$1$2")
    .replace(/(^|[^\w_])_(\S(?:[^_\n]*\S)?)_(?![\w_])/g, "$1$2")
    .replace(/`([^`\n]+)`/g, "$1");
}
