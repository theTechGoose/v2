import { assertEquals } from "#std/assert";
import { deviceFromUa } from "./mod.ts";

Deno.test("deviceFromUa: empty/unknown", () => {
  assertEquals(deviceFromUa(""), "unknown");
  assertEquals(deviceFromUa("Curl/7.0"), "unknown");
});

Deno.test("deviceFromUa: desktop UAs", () => {
  assertEquals(deviceFromUa("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome"), "desktop");
  assertEquals(deviceFromUa("Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari"), "desktop");
  assertEquals(deviceFromUa("Mozilla/5.0 (X11; Linux x86_64) Firefox"), "desktop");
});

Deno.test("deviceFromUa: mobile UAs", () => {
  assertEquals(deviceFromUa("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari"), "mobile");
  assertEquals(deviceFromUa("Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit ... Mobile Safari"), "mobile");
  assertEquals(deviceFromUa("Mozilla/5.0 (iPod touch; CPU iPhone OS 16) Safari"), "mobile");
});

Deno.test("deviceFromUa: tablet UAs", () => {
  assertEquals(deviceFromUa("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Safari"), "tablet");
  // Android without "mobile" → tablet (e.g. tablet UAs)
  assertEquals(deviceFromUa("Mozilla/5.0 (Linux; Android 13; SM-T970) AppleWebKit ... Safari"), "tablet");
  assertEquals(deviceFromUa("Some Tablet UA"), "tablet");
});
