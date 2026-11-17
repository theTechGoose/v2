/**
 * REQ-920 — a line's texting registration (A2P 10DLC), with every Twilio SID.
 *   ["comms_a2p", lineId]                       → A2pRegistration
 *   ["comms_a2p_by_subaccount", subaccountSid]  → lineId (the texting gate and the status webhook)
 */
import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import type { A2pRegistration } from "@communications/dto/mod.ts";

const PREFIX = "comms_a2p";
const BY_SUB = "comms_a2p_by_subaccount";

@Injectable()
export class A2pStore {
  async get(lineId: string): Promise<A2pRegistration | null> {
    const kv = await getKv();
    return (await kv.get<A2pRegistration>([PREFIX, lineId])).value ?? null;
  }

  async findBySubaccount(
    subaccountSid: string,
  ): Promise<A2pRegistration | null> {
    if (!subaccountSid) return null;
    const kv = await getKv();
    const id = (await kv.get<string>([BY_SUB, subaccountSid])).value;
    return id ? await this.get(id) : null;
  }

  async save(reg: A2pRegistration): Promise<A2pRegistration> {
    const kv = await getKv();
    const next = { ...reg, updatedAt: new Date().toISOString() };
    const res = await kv.atomic()
      .set([PREFIX, next.lineId], next)
      .set([BY_SUB, next.subaccountSid], next.lineId)
      .commit();
    if (!res.ok) throw new Error("a2p registration write failed");
    return next;
  }
}
