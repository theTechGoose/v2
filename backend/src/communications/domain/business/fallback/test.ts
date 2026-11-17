/** REQ-900 — exactly one fallback arm runs when the softphone did not take the call. */
import { assertEquals } from "#std/assert";
import { selectFallback } from "./mod.ts";

Deno.test("REQ-900 selectFallback: an answered call is over — hangup regardless of config", () => {
  assertEquals(selectFallback({ mode: "agent" }, "completed"), "hangup");
  assertEquals(selectFallback({ mode: "voicemail" }, "answered"), "hangup");
});

Deno.test("REQ-900 selectFallback: no answer / busy / failed / canceled → the configured arm", () => {
  for (const status of ["no-answer", "busy", "failed", "canceled", ""]) {
    assertEquals(selectFallback({ mode: "agent" }, status), "agent");
    assertEquals(selectFallback({ mode: "voicemail" }, status), "voicemail");
    assertEquals(selectFallback({ mode: "forward", forwardTo: "+15125550000" }, status), "forward");
    assertEquals(selectFallback({ mode: "hangup" }, status), "hangup");
  }
});

Deno.test("REQ-900 selectFallback: default is voicemail; forward without a number degrades to voicemail; junk mode is voicemail", () => {
  assertEquals(selectFallback({}, "no-answer"), "voicemail");
  assertEquals(selectFallback({ mode: "forward" }, "no-answer"), "voicemail");
  assertEquals(selectFallback({ mode: "forward", forwardTo: "  " }, "no-answer"), "voicemail");
  assertEquals(selectFallback({ mode: "whatever" }, "no-answer"), "voicemail");
});
