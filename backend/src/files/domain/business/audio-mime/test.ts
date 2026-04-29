import { assertEquals } from "#std/assert";
import { isAudioMime } from "./mod.ts";

Deno.test("audio-mime: common audio types are recognized", () => {
  assertEquals(isAudioMime("audio/webm"), true);
  assertEquals(isAudioMime("audio/mp4"), true);
  assertEquals(isAudioMime("audio/mpeg"), true);
  assertEquals(isAudioMime("audio/wav"), true);
  assertEquals(isAudioMime("audio/ogg"), true);
});

Deno.test("audio-mime: case + whitespace are normalized", () => {
  assertEquals(isAudioMime("AUDIO/WEBM"), true);
  assertEquals(isAudioMime("  audio/mp4  "), true);
});

Deno.test("audio-mime: non-audio types reject", () => {
  assertEquals(isAudioMime("image/png"), false);
  assertEquals(isAudioMime("video/mp4"), false);
  assertEquals(isAudioMime("application/pdf"), false);
  assertEquals(isAudioMime("text/plain"), false);
});

Deno.test("audio-mime: empty / nullish reject", () => {
  assertEquals(isAudioMime(""), false);
  assertEquals(isAudioMime(undefined), false);
  assertEquals(isAudioMime(null), false);
});
