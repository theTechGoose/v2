/**
 * REQ-900/901 — the call log.
 *   ["comms_call", id]                       → Call
 *   ["comms_call_by_sid", providerSid]       → id (Twilio callbacks)
 *   ["comms_call_by_peer", peer, createdAt, id] → id
 */
import { Injectable } from "#danet/core";
import { getKv, indexedIds, readMany } from "@core/data/kv/mod.ts";
import { NotFoundError } from "@core/data/repository/mod.ts";
import type { Call, CallTranscriptTurn } from "@communications/dto/mod.ts";

const PREFIX = "comms_call";
const BY_SID = "comms_call_by_sid";
const BY_PEER = "comms_call_by_peer";

export type CreateCallInput =
  & Omit<Call, "id" | "createdAt" | "updatedAt" | "transcript">
  & { transcript?: CallTranscriptTurn[] };
export type CallPatch = Partial<
  Omit<
    Call,
    | "id"
    | "createdAt"
    | "updatedAt"
    | "transcript"
    | "providerSid"
    | "line"
    | "peer"
    | "direction"
  >
>;

@Injectable()
export class CallStore {
  async create(input: CreateCallInput): Promise<Call> {
    const kv = await getKv();
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const call: Call = {
      transcript: [],
      ...input,
      id,
      createdAt,
      updatedAt: createdAt,
    };
    await kv.atomic()
      .set([PREFIX, id], call)
      .set([BY_SID, input.providerSid], id)
      .set([BY_PEER, input.peer, createdAt, id], id)
      .commit();
    return call;
  }

  async get(id: string): Promise<Call> {
    const kv = await getKv();
    const r = await kv.get<Call>([PREFIX, id]);
    if (!r.value) throw new NotFoundError(PREFIX, id);
    return r.value;
  }

  async findBySid(providerSid: string): Promise<Call | null> {
    const kv = await getKv();
    const idx = await kv.get<string>([BY_SID, providerSid]);
    if (!idx.value) return null;
    return (await kv.get<Call>([PREFIX, idx.value])).value ?? null;
  }

  async patch(id: string, patch: CallPatch): Promise<Call> {
    const kv = await getKv();
    const existing = await this.get(id);
    const defined = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    const updated: Call = {
      ...existing,
      ...defined,
      updatedAt: new Date().toISOString(),
    };
    await kv.set([PREFIX, id], updated);
    return updated;
  }

  async appendTranscript(id: string, turn: CallTranscriptTurn): Promise<Call> {
    const kv = await getKv();
    const existing = await this.get(id);
    // an interrupted agent turn replaces the one it interrupted
    const transcript =
      turn.interrupted && existing.transcript.at(-1)?.role === "agent"
        ? [...existing.transcript.slice(0, -1), turn]
        : [...existing.transcript, turn];
    const updated: Call = {
      ...existing,
      transcript,
      updatedAt: new Date().toISOString(),
    };
    await kv.set([PREFIX, id], updated);
    return updated;
  }

  async listByPeer(peer: string): Promise<Call[]> {
    const kv = await getKv();
    const ids = await indexedIds(kv, [BY_PEER, peer]);
    const recs = await readMany<Call>(kv, ids.map((id) => [PREFIX, id]));
    return recs.filter((c): c is Call => !!c);
  }

  /** the log on a line, newest first */
  async list(line: string, limit = 100): Promise<Call[]> {
    const kv = await getKv();
    const out: Call[] = [];
    for await (const e of kv.list<Call>({ prefix: [PREFIX] })) {
      if (e.value.line === line) out.push(e.value);
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(
      0,
      limit,
    );
  }
}
