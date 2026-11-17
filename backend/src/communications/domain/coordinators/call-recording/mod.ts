/** REQ-900 — a finished recording attaches to its call. */
import { Injectable } from "#danet/core";
import type { Call } from "@communications/dto/mod.ts";
import { CallStore } from "@communications/domain/data/call-store/mod.ts";

@Injectable()
export class CallRecording {
  constructor(private calls: CallStore) {}

  async apply(params: Record<string, string>): Promise<Call | null> {
    if ((params.RecordingStatus ?? "completed") !== "completed") return null;
    const call = params.CallSid
      ? await this.calls.findBySid(params.CallSid)
      : null;
    if (!call) return null;
    return await this.calls.patch(call.id, {
      recordingSid: params.RecordingSid,
      recordingUrl: params.RecordingUrl,
      ...(params.RecordingDuration
        ? { recordingDurationSec: Number(params.RecordingDuration) || 0 }
        : {}),
    });
  }
}
