import { assertEquals } from "#std/assert";
import { StubTranscriptionClient } from "./mod.ts";

Deno.test("StubTranscriptionClient: default returns deterministic placeholder", async () => {
  const client = new StubTranscriptionClient();
  const out = await client.transcribe({ audio: new Uint8Array(), userId: "u-1" });
  assertEquals(out.text, "(stub transcript)");
  assertEquals(out.language, "en");
});

Deno.test("StubTranscriptionClient: echoes provided language hint", async () => {
  const client = new StubTranscriptionClient();
  const out = await client.transcribe({ audioUrl: "https://x", language: "es", userId: "u-1" });
  assertEquals(out.language, "es");
});

Deno.test("StubTranscriptionClient: setScript pops one response per call, in order", async () => {
  const client = new StubTranscriptionClient();
  client.setScript([
    { text: "first",  language: "en" },
    { text: "second", language: "en", durationSec: 1.5 },
  ]);
  const a = await client.transcribe({ audioUrl: "https://x", userId: "u-1" });
  const b = await client.transcribe({ audioUrl: "https://x", userId: "u-1" });
  assertEquals(a.text, "first");
  assertEquals(b.text, "second");
  assertEquals(b.durationSec, 1.5);
});

Deno.test("StubTranscriptionClient: setHandler can branch on the request", async () => {
  const client = new StubTranscriptionClient();
  client.setHandler((req) => ({
    text: req.audioUrl?.endsWith("hello.webm") ? "hello world" : "",
    language: "en",
  }));
  const a = await client.transcribe({ audioUrl: "https://x/hello.webm", userId: "u-1" });
  const b = await client.transcribe({ audioUrl: "https://x/silent.webm", userId: "u-1" });
  assertEquals(a.text, "hello world");
  assertEquals(b.text, "");
});

Deno.test("StubTranscriptionClient: reset() clears script + handler", async () => {
  const client = new StubTranscriptionClient();
  client.setScript([{ text: "scripted" }]);
  client.setHandler(() => ({ text: "from-handler" }));
  client.reset();
  const out = await client.transcribe({ audioUrl: "https://x", userId: "u-1" });
  assertEquals(out.text, "(stub transcript)");
});
