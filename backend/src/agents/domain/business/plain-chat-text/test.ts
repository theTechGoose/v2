import { assert, assertEquals } from "#std/assert";
import { toPlainChatText } from "./mod.ts";

/**
 * REQ-262 (demo M25): the chat bubble renders text as-is (white-space:
 * pre-wrap, no markdown renderer), so the model's "- **English:** …" showed
 * its asterisks. Every assistant chat reply is plain text.
 */

Deno.test("REQ-262 toPlainChatText: the demo's bilingual markdown list comes out clean", () => {
  const md = "Here are the job details:\n\n" +
    "- **English:** Repaint kitchen walls, 2 coats\n" +
    "- **Spanish:** Repintar las paredes de la cocina, 2 capas";
  assertEquals(
    toPlainChatText(md),
    "Here are the job details:\n\n" +
      "• English: Repaint kitchen walls, 2 coats\n" +
      "• Spanish: Repintar las paredes de la cocina, 2 capas",
  );
});

Deno.test("REQ-262 toPlainChatText: headings, bold, italics, code and links lose their syntax", () => {
  const out = toPlainChatText(
    "### Job details\n__Total__: *$1,800*\nUse `Re-open the quote`. See [the quote](https://x.test/q/1).",
  );
  assertEquals(
    out,
    "Job details\nTotal: $1,800\nUse Re-open the quote. See the quote (https://x.test/q/1).",
  );
});

Deno.test("REQ-262 toPlainChatText: numbered lists stay, '*' bullets become '•'", () => {
  assertEquals(
    toPlainChatText("1. Prep\n2. Paint\n* Trim\n  + Doors"),
    "1. Prep\n2. Paint\n• Trim\n  • Doors",
  );
});

Deno.test("REQ-262 toPlainChatText: plain text and arithmetic are left alone", () => {
  const s = "Got it — 3 * 4 rooms at $250 each, 10% off.";
  assertEquals(toPlainChatText(s), s);
  assertEquals(toPlainChatText(""), "");
});

Deno.test("REQ-262 toPlainChatText: no asterisks survive a bold-heavy reply", () => {
  const out = toPlainChatText("**Done!** I updated **both** languages.");
  assert(!out.includes("*"), out);
  assertEquals(out, "Done! I updated both languages.");
});
