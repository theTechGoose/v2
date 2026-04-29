import { assertEquals } from "#std/assert";
import { ProcessVoiceMemo } from "./mod.ts";
import { FileStore } from "@files/domain/data/file-store/mod.ts";
import { StubTranscriptionClient } from "@core/business/transcription/implementations/stub/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

function fresh() {
  const files = new FileStore();
  const transcription = new StubTranscriptionClient();
  const flow = new ProcessVoiceMemo(files, transcription);
  return { files, transcription, flow };
}

Deno.test("process-voice-memo: stamps transcript ready on success", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { files, transcription, flow } = fresh();
  transcription.setScript([{ text: "hello world" }]);

  const meta = await files.create({
    userId: "u-1",
    filename: "memo.webm",
    mimeType: "audio/webm",
    bytes: new Uint8Array([0, 1, 2, 3]),
  });
  await files.updateMeta(meta.id, "u-1", { transcriptStatus: "pending" });

  await flow.run({ fileId: meta.id, userId: "u-1" });
  const after = await files.getOwnedMeta(meta.id, "u-1");
  assertEquals(after.transcriptStatus, "ready");
  assertEquals(after.transcript, "hello world");
  await resetKv();
});

Deno.test("process-voice-memo: stamps failure when the client throws", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { files, transcription, flow } = fresh();
  transcription.setHandler(() => { throw new Error("vendor down"); });

  const meta = await files.create({
    userId: "u-1",
    filename: "memo.webm",
    mimeType: "audio/webm",
    bytes: new Uint8Array([9, 9, 9]),
  });
  await files.updateMeta(meta.id, "u-1", { transcriptStatus: "pending" });

  await flow.run({ fileId: meta.id, userId: "u-1" });
  const after = await files.getOwnedMeta(meta.id, "u-1");
  assertEquals(after.transcriptStatus, "failed");
  assertEquals(after.transcriptError, "vendor down");
  await resetKv();
});
