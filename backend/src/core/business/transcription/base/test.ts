import { assertEquals } from "#std/assert";
import type { TranscriptionRequest, TranscriptionResponse } from "./mod.ts";

// The base only exports types — confirm a request-shaped object satisfies
// the contract without runtime drift. This keeps the contract honest if a
// field is renamed or dropped.
Deno.test("transcription base: TranscriptionRequest shape compiles", () => {
  const req: TranscriptionRequest = { userId: "u-1", audioUrl: "https://example/a.mp3" };
  assertEquals(req.userId, "u-1");
});

Deno.test("transcription base: TranscriptionResponse shape compiles", () => {
  const res: TranscriptionResponse = { text: "hi" };
  assertEquals(res.text, "hi");
});
