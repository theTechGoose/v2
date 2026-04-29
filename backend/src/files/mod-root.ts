import { Module } from "#danet/core";
import { UsersModule } from "@users/mod-root.ts";
import { FilesController } from "@files/entrypoints/files-controller/mod.ts";
import { FileStore } from "@files/domain/data/file-store/mod.ts";
import { ProcessVoiceMemo } from "@files/domain/coordinators/process-voice-memo/mod.ts";
import {
  TRANSCRIPTION_CLIENT,
  type TranscriptionClient,
} from "@core/business/transcription/base/mod.ts";
import { StubTranscriptionClient } from "@core/business/transcription/implementations/stub/mod.ts";

/**
 * Pick the TranscriptionClient class at module-load time.
 *
 *   - TRANSCRIPTION_CLIENT=openai → OpenAIWhisperClient (requires OPENAI_API_KEY)
 *   - anything else (default)     → StubTranscriptionClient
 *
 * Mirrors the AGENTS_LLM_CLIENT switch in AgentsModule. The `start` deno
 * task sets `TRANSCRIPTION_CLIENT=openai` for production; tests leave it
 * unset so they get the deterministic stub.
 *
 * The OpenAI module is dynamically imported so the live SDK doesn't load
 * when the stub is selected.
 */
async function selectTranscriptionClass(): Promise<new () => TranscriptionClient> {
  if (Deno.env.get("TRANSCRIPTION_CLIENT") === "openai") {
    const { OpenAIWhisperClient } = await import(
      "@core/business/transcription/implementations/openai-whisper/mod.ts"
    );
    return OpenAIWhisperClient;
  }
  return StubTranscriptionClient;
}

const TranscriptionClass = await selectTranscriptionClass();

/**
 * FilesModule — cross-cutting blob storage consumed by paperwork (PDFs),
 * profile (W-9s), and agents (voice clips).
 *
 * Audio uploads trigger a fire-and-forget transcription via
 * ProcessVoiceMemo, which writes the transcript back onto the FileRecord.
 */
@Module({
  imports: [UsersModule],
  controllers: [FilesController],
  injectables: [
    FileStore,
    ProcessVoiceMemo,
    { token: TRANSCRIPTION_CLIENT, useClass: TranscriptionClass },
  ],
})
export class FilesModule {}
