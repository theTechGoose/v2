/** REQ-901 — the <Connect> action after a relay session: store the outcome, hang up. */
import { Injectable } from "#danet/core";
import { hangup } from "@communications/domain/business/twiml/mod.ts";
import { CallStore } from "@communications/domain/data/call-store/mod.ts";

@Injectable()
export class RelayDone {
  constructor(private calls: CallStore) {}

  async handle(params: Record<string, string>): Promise<string> {
    const call = params.CallSid
      ? await this.calls.findBySid(params.CallSid)
      : null;
    if (call) {
      await this.calls.patch(call.id, {
        relayStatus: params.SessionStatus,
        ...(params.HandoffData ? { handoffData: params.HandoffData } : {}),
      });
    }
    return hangup();
  }
}
