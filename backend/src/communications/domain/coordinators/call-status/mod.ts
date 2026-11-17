/** REQ-900 — Twilio's call status callback, for our leg or a dialed child leg (ParentCallSid). */
import { Injectable } from "#danet/core";
import type { Call, CallStatus as Status } from "@communications/dto/mod.ts";
import { CallStore } from "@communications/domain/data/call-store/mod.ts";

const KNOWN: Set<string> = new Set([
  "queued",
  "initiated",
  "ringing",
  "in-progress",
  "completed",
  "busy",
  "no-answer",
  "failed",
  "canceled",
]);

function isoOf(ts: string | undefined): string {
  const d = ts ? new Date(ts) : new Date();
  return (isNaN(d.getTime()) ? new Date() : d).toISOString();
}

@Injectable()
export class CallStatus {
  constructor(private calls: CallStore) {}

  async apply(params: Record<string, string>): Promise<Call | null> {
    const status = params.CallStatus ?? "";
    if (!KNOWN.has(status)) return null;
    const call =
      (params.CallSid ? await this.calls.findBySid(params.CallSid) : null) ??
        (params.ParentCallSid
          ? await this.calls.findBySid(params.ParentCallSid)
          : null);
    if (!call) return null;
    const at = isoOf(params.Timestamp);
    const ended = ["completed", "busy", "no-answer", "failed", "canceled"]
      .includes(status);
    return await this.calls.patch(call.id, {
      status: status as Status,
      ...(status === "in-progress" ? { startedAt: at } : {}),
      ...(ended ? { endedAt: at } : {}),
      ...(params.CallDuration
        ? { durationSec: Number(params.CallDuration) || 0 }
        : {}),
    });
  }
}
