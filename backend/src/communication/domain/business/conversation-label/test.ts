import { assertEquals } from "#std/assert";
import { conversationLabel } from "./mod.ts";

Deno.test("conversationLabel: returns trimmed title when present", () => {
  assertEquals(
    conversationLabel({ id: "abc12345-xx", title: "  Acme intro  " }),
    "Acme intro",
  );
});

Deno.test("conversationLabel: falls back to short id when title missing", () => {
  assertEquals(
    conversationLabel({ id: "abc12345-de-ad-be-ef" }),
    "conversation:abc12345",
  );
});
