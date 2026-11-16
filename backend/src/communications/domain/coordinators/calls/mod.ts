/** REQ-900 — the call log reads. */
import { Injectable } from "#danet/core";
import type { Call } from "@communications/dto/mod.ts";
import { CommsConfigSource } from "@communications/domain/data/config/mod.ts";
import { CallStore } from "@communications/domain/data/call-store/mod.ts";

@Injectable()
export class Calls {
  constructor(private calls: CallStore, private cfgSource: CommsConfigSource) {}

  list(limit = 100): Promise<Call[]> {
    return this.calls.list(this.cfgSource.get().from || "dev", limit);
  }

  get(id: string): Promise<Call> {
    return this.calls.get(id);
  }
}
