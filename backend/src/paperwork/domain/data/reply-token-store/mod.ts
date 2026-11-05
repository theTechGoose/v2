/**
 * REQ-175 — the opaque token behind a Reply-To address: one per
 * (contractor, customer), minted on first use, resolved by the inbound
 * webhook. The address carries only the token; the ids stay in KV.
 */
import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";

const PREFIX = "reply-token";
const BY_PAIR = "reply-token-by";

export interface ReplyToken {
  token: string;
  userId: string;
  customerId: string;
  createdAt: string;
}

function mint(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(
    bytes,
    (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36],
  ).join("");
}

@Injectable()
export class ReplyTokenStore {
  /** the token for this customer's replies — minted once, then reused */
  async forCustomer(userId: string, customerId: string): Promise<string> {
    const kv = await getKv();
    const have = await kv.get<string>([BY_PAIR, userId, customerId]);
    if (have.value) return have.value;
    const row: ReplyToken = {
      token: mint(),
      userId,
      customerId,
      createdAt: new Date().toISOString(),
    };
    await kv.atomic()
      .set([PREFIX, row.token], row)
      .set([BY_PAIR, userId, customerId], row.token)
      .commit();
    return row.token;
  }

  /** who a token belongs to — null when it is not ours */
  async resolve(token: string): Promise<ReplyToken | null> {
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(token)) return null;
    const kv = await getKv();
    return (await kv.get<ReplyToken>([PREFIX, token])).value ?? null;
  }
}
