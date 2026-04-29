import { Inject, Injectable } from "#danet/core";
import { FileStore } from "@files/domain/data/file-store/mod.ts";
import {
  TRANSCRIPTION_CLIENT,
  type TranscriptionClient,
} from "@core/business/transcription/base/mod.ts";

/**
 * ProcessVoiceMemo — fire-and-forget coordinator that fetches an audio
 * file's bytes, runs them through the wired TranscriptionClient, and
 * stamps the result back onto the FileRecord.
 *
 * Errors are caught and persisted as transcriptStatus="failed" so a
 * failed upload doesn't crash the upload handler — the file is still
 * stored and downloadable, just without a transcript.
 */
@Injectable()
export class ProcessVoiceMemo {
  constructor(
    private files: FileStore,
    @Inject(TRANSCRIPTION_CLIENT) private transcription: TranscriptionClient,
  ) {}

  async run(input: { fileId: string; userId: string }): Promise<void> {
    try {
      const meta = await this.files.getOwnedMeta(input.fileId, input.userId);
      const bytes = await this.files.readBytes(input.fileId);
      const result = await this.transcription.transcribe({
        audio:    bytes,
        mimeType: meta.mimeType,
        userId:   input.userId,
      });
      await this.files.updateMeta(input.fileId, input.userId, {
        transcriptStatus: "ready",
        transcript:       result.text,
        transcriptError:  undefined,
      });
    } catch (err) {
      const reason = (err as Error).message ?? String(err);
      try {
        await this.files.updateMeta(input.fileId, input.userId, {
          transcriptStatus: "failed",
          transcriptError:  reason,
        });
      } catch (writeErr) {
        console.error(`[process-voice-memo] failed to mark file ${input.fileId} as failed: ${(writeErr as Error).message}`);
      }
    }
  }
}
