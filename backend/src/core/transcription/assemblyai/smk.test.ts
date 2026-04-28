import { assert, assertEquals } from "#std/assert";
import { AssemblyAITranscriptionClient } from "./mod.ts";

/**
 * Smoke tests for AssemblyAITranscriptionClient — we monkey-patch the
 * global fetch to intercept the SDK's HTTP traffic, assert the request
 * shape, and return canned responses for the create + poll endpoints.
 * No real AssemblyAI traffic; no API key needed in CI.
 *
 * The SDK accepts no `fetch` override (unlike `npm:openai`), so swapping
 * `globalThis.fetch` is the cleanest seam. We restore it in a finally
 * so a thrown assertion never leaks the patch into other tests.
 */

interface CapturedCall {
  url: string;
  method: string;
  body: unknown;
}

async function withMockedFetch<T>(
  handler: (call: CapturedCall) => Response,
  fn: (calls: CapturedCall[]) => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  const calls: CapturedCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input as RequestInfo, init);
    let body: unknown = undefined;
    if (req.method !== "GET" && req.method !== "HEAD") {
      const text = await req.text();
      try { body = JSON.parse(text); } catch { body = text; }
    }
    const call: CapturedCall = { url: req.url, method: req.method, body };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

function completedTranscript(text: string): Record<string, unknown> {
  return {
    id: "tr-test",
    status: "completed",
    text,
    language_code: "en",
    audio_duration: 4,
    words: [
      { text: "hello", start: 0,    end: 500,  confidence: 0.99 },
      { text: "world", start: 500, end: 1000, confidence: 0.97 },
    ],
    error: null,
  };
}

Deno.test("AssemblyAITranscriptionClient: constructor throws when no API key is provided", () => {
  Deno.env.delete("ASSEMBLYAI_API_KEY");
  let threw = false;
  try { new AssemblyAITranscriptionClient(); } catch { threw = true; }
  assertEquals(threw, true);
});

Deno.test("AssemblyAITranscriptionClient: transcribe(audioUrl) submits + polls + maps response", async () => {
  await withMockedFetch(
    (call) => {
      // Submit endpoint creates the transcript job.
      if (call.method === "POST" && call.url.endsWith("/v2/transcript")) {
        return new Response(JSON.stringify({ id: "tr-test", status: "queued" }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      // Polling endpoint returns the completed transcript on the first try.
      if (call.method === "GET" && call.url.includes("/v2/transcript/tr-test")) {
        return new Response(JSON.stringify(completedTranscript("hello world")), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "unexpected " + call.method + " " + call.url }), { status: 500 });
    },
    async (calls) => {
      const client = new AssemblyAITranscriptionClient({ apiKey: "key-test-1234" });
      const out = await client.transcribe({
        audioUrl: "https://example.com/clip.webm",
        language: "en",
        userId: "u-1",
      });
      assertEquals(out.text, "hello world");
      assertEquals(out.language, "en");
      assertEquals(out.durationSec, 4);
      assertEquals(out.words?.length, 2);
      assertEquals(out.words?.[0], { text: "hello", startMs: 0, endMs: 500, confidence: 0.99 });

      // First call must be the submit POST carrying our audioUrl + language hint.
      const submit = calls.find((c) => c.method === "POST" && c.url.endsWith("/v2/transcript"));
      assert(submit, "expected a POST to /v2/transcript");
      const submitBody = submit.body as Record<string, unknown>;
      assertEquals(submitBody.audio_url, "https://example.com/clip.webm");
      assertEquals(submitBody.language_code, "en");
    },
  );
});

Deno.test("AssemblyAITranscriptionClient: throws when neither audio nor audioUrl is provided", async () => {
  // No fetch should fire — validation happens before any network call.
  Deno.env.delete("ASSEMBLYAI_API_KEY");
  const client = new AssemblyAITranscriptionClient({ apiKey: "key-test-1234" });
  let threw = false;
  try { await client.transcribe({ userId: "u-1" }); } catch { threw = true; }
  assertEquals(threw, true);
});

Deno.test("AssemblyAITranscriptionClient: surfaces vendor error status as a thrown error", async () => {
  await withMockedFetch(
    (call) => {
      if (call.method === "POST" && call.url.endsWith("/v2/transcript")) {
        return new Response(JSON.stringify({ id: "tr-err", status: "queued" }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      if (call.method === "GET" && call.url.includes("/v2/transcript/tr-err")) {
        return new Response(JSON.stringify({
          id: "tr-err", status: "error", text: null, error: "audio decode failed",
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("unexpected", { status: 500 });
    },
    async () => {
      const client = new AssemblyAITranscriptionClient({ apiKey: "key-test-1234" });
      let caught: Error | null = null;
      try {
        await client.transcribe({ audioUrl: "https://x/bad.webm", userId: "u-1" });
      } catch (e) {
        caught = e as Error;
      }
      assert(caught, "expected throw on vendor error status");
      assert(caught!.message.includes("audio decode failed"));
    },
  );
});
