/** REQ-900 — the call log reads. */
import { Injectable } from "#danet/core";
import type { Call } from "@communications/dto/mod.ts";
import { CommsConfigSource } from "@communications/domain/data/config/mod.ts";
import { envLine, type ResolvedLine } from "@communications/domain/business/line-resolution/mod.ts";
import { CallStore } from "@communications/domain/data/call-store/mod.ts";

@Injectable()
export class Calls {
  constructor(private calls: CallStore, private cfgSource: CommsConfigSource) {}

  /** `on`: the line whose log this is; the env line when absent */
  list(limit = 100, on?: ResolvedLine): Promise<Call[]> {
    return this.calls.list((on ?? envLine(this.cfgSource.get())).number || "dev", limit);
  }

  get(id: string): Promise<Call> {
    return this.calls.get(id);
  }
}
