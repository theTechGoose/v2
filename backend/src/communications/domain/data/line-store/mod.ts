/**
 * REQ-903..905 — a customer's line.
 *   ["comms_line", id]                        → Line (secrets sealed, REQ-212)
 *   ["comms_line_by_user", userId]            → id of the user's latest line
 *   ["comms_line_by_subaccount", subSid]      → id
 *   ["comms_line_by_number", number]          → id while active
 */
import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import { NotFoundError } from "@core/data/repository/mod.ts";
import {
  openSecret,
  sealSecret,
  secretsKey,
} from "@core/business/secret-box/mod.ts";
import type { Line } from "@communications/dto/mod.ts";

const PREFIX = "comms_line";
const BY_USER = "comms_line_by_user";
const BY_SUB = "comms_line_by_subaccount";
const BY_NUMBER = "comms_line_by_number";

export interface CreateLineInput {
  userId: string;
  subaccountSid: string;
  number: string;
  numberSid: string;
  apiKeySid: string;
  twimlAppSid: string;
  friendlyName?: string;
  /** plain; sealed before it is written */
  authToken: string;
  /** plain; sealed before it is written */
  apiKeySecret: string;
}

export interface LineSecrets {
  authToken: string;
  apiKeySecret: string;
}

@Injectable()
export class LineStore {
  async get(id: string): Promise<Line> {
    const kv = await getKv();
    const r = await kv.get<Line>([PREFIX, id]);
    if (!r.value) throw new NotFoundError(PREFIX, id);
    return r.value;
  }

  private async byIndex(key: Deno.KvKey): Promise<Line | null> {
    const kv = await getKv();
    const idx = await kv.get<string>(key);
    if (!idx.value) return null;
    return (await kv.get<Line>([PREFIX, idx.value])).value ?? null;
  }

  /** the user's latest line, whatever its status */
  findByUser(userId: string): Promise<Line | null> {
    return this.byIndex([BY_USER, userId]);
  }

  async findActiveByUser(userId: string): Promise<Line | null> {
    const line = await this.findByUser(userId);
    return line?.status === "active" ? line : null;
  }

  findBySubaccount(subaccountSid: string): Promise<Line | null> {
    return this.byIndex([BY_SUB, subaccountSid]);
  }

  findByNumber(number: string): Promise<Line | null> {
    return this.byIndex([BY_NUMBER, number]);
  }

  async create(input: CreateLineInput): Promise<Line> {
    const kv = await getKv();
    const key = await secretsKey();
    const now = new Date().toISOString();
    const { authToken, apiKeySecret, ...rest } = input;
    const line: Line = {
      id: crypto.randomUUID(),
      kind: "subaccount",
      ...rest,
      status: "active",
      authTokenSealed: await sealSecret(authToken, key),
      apiKeySecretSealed: await sealSecret(apiKeySecret, key),
      createdAt: now,
      updatedAt: now,
    };
    const res = await kv.atomic()
      .set([PREFIX, line.id], line)
      .set([BY_USER, line.userId], line.id)
      .set([BY_SUB, line.subaccountSid], line.id)
      .set([BY_NUMBER, line.number], line.id)
      .commit();
    if (!res.ok) throw new Error("line write failed");
    return line;
  }

  async open(line: Line): Promise<LineSecrets> {
    const key = await secretsKey();
    return {
      authToken: await openSecret(line.authTokenSealed, key),
      apiKeySecret: await openSecret(line.apiKeySecretSealed, key),
    };
  }

  /** REQ-920b: the number now sits on the main account with its own key and app; the subaccount index goes */
  async markMain(
    id: string,
    input: {
      apiKeySid: string;
      apiKeySecret: string;
      twimlAppSid: string;
      messagingServiceSid: string;
      campaignUsecase: string;
    },
  ): Promise<Line> {
    const kv = await getKv();
    const key = await secretsKey();
    const line = await this.get(id);
    const next: Line = {
      ...line,
      kind: "main",
      subaccountSid: "",
      apiKeySid: input.apiKeySid,
      twimlAppSid: input.twimlAppSid,
      messagingServiceSid: input.messagingServiceSid,
      campaignUsecase: input.campaignUsecase,
      authTokenSealed: await sealSecret("", key),
      apiKeySecretSealed: await sealSecret(input.apiKeySecret, key),
      updatedAt: new Date().toISOString(),
    };
    const tx = kv.atomic().set([PREFIX, id], next);
    if (line.subaccountSid) tx.delete([BY_SUB, line.subaccountSid]);
    const res = await tx.commit();
    if (!res.ok) throw new Error("line write failed");
    return next;
  }

  async markReleased(id: string): Promise<Line> {
    const kv = await getKv();
    const line = await this.get(id);
    if (line.status === "released") return line;
    const now = new Date().toISOString();
    const next: Line = {
      ...line,
      status: "released",
      releasedAt: now,
      updatedAt: now,
    };
    const res = await kv.atomic()
      .set([PREFIX, id], next)
      .delete([BY_NUMBER, line.number])
      .commit();
    if (!res.ok) throw new Error("line write failed");
    return next;
  }
}
