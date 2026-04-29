import { assertEquals, assertRejects } from "#std/assert";
import { OpenAIWhisperClient } from "./mod.ts";

Deno.test("openai-whisper: throws when OPENAI_API_KEY is unset", async () => {
  Deno.env.delete("OPENAI_API_KEY");
  const client = new OpenAIWhisperClient();
  await assertRejects(
    () => client.transcribe({ audio: new Uint8Array([0, 1, 2]), userId: "u-1" }),
    Error,
    "OPENAI_API_KEY not set",
  );
});

Deno.test("openai-whisper: posts multipart to /audio/transcriptions with model + response_format", async () => {
  Deno.env.set("OPENAI_API_KEY", "test-key");
  Deno.env.set("OPENAI_BASE_URL", "https://api.openai.test/v1");
  Deno.env.set("OPENAI_TRANSCRIPTION_MODEL", "whisper-1");
  const client = new OpenAIWhisperClient();

  let capturedUrl: string | null = null;
  let capturedAuth: string | null = null;
  let capturedFormFields: Record<string, string> = {};

  client.fetchOverride = async (input: Request | URL | string, init?: RequestInit) => {
    capturedUrl = String(input);
    const headers = new Headers(init?.headers ?? {});
    capturedAuth = headers.get("authorization");
    const form = init?.body as FormData;
    for (const [k, v] of form.entries()) {
      capturedFormFields[k] = typeof v === "string" ? v : `<blob:${(v as Blob).type}>`;
    }
    return new Response(
      JSON.stringify({ text: "hello world", language: "en", duration: 1.25 }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const res = await client.transcribe({
    audio: new Uint8Array([0, 1, 2]),
    mimeType: "audio/webm",
    language: "en",
    userId: "u-1",
  });

  assertEquals(res.text, "hello world");
  assertEquals(res.language, "en");
  assertEquals(res.durationSec, 1.25);
  assertEquals(capturedUrl, "https://api.openai.test/v1/audio/transcriptions");
  assertEquals(capturedAuth, "Bearer test-key");
  assertEquals(capturedFormFields.model, "whisper-1");
  assertEquals(capturedFormFields.response_format, "verbose_json");
  assertEquals(capturedFormFields.language, "en");

  Deno.env.delete("OPENAI_API_KEY");
  Deno.env.delete("OPENAI_BASE_URL");
  Deno.env.delete("OPENAI_TRANSCRIPTION_MODEL");
});

Deno.test("openai-whisper: surfaces non-2xx as a thrown error", async () => {
  Deno.env.set("OPENAI_API_KEY", "test-key");
  const client = new OpenAIWhisperClient();
  client.fetchOverride = async () =>
    new Response("bad audio", { status: 400 });
  await assertRejects(
    () => client.transcribe({ audio: new Uint8Array([0]), userId: "u-1" }),
    Error,
    "openai whisper 400",
  );
  Deno.env.delete("OPENAI_API_KEY");
});
