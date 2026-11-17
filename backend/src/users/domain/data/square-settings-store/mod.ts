/**
 * REQ-803 — a business's Square connection: its access token SEALED (core/business/secret-box;
 * never in the clear in KV), the location its checkouts run on, and what Square said about the
 * seller. One record per user. All data is user-owned.
 */
import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import type { SquareEnvironment } from "#payments/square.ts";

const PREFIX = "square_settings";

export interface SquareSettings {
  userId: string;
  /** the access token, sealed (secret-box `v1.…`) */
  tokenSealed: string;
  /** `EAAA••••WXYZ` */
  tokenMasked: string;
  environment: SquareEnvironment;
  fake: boolean;
  locationId: string;
  locationName: string;
  /** the seller's business name on Square (the location's `business_name`) */
  sellerName: string;
  merchantId?: string;
  connectedAt: string;
  updatedAt: string;
}

@Injectable()
export class SquareSettingsStore {
  async get(userId: string): Promise<SquareSettings | null> {
    const kv = await getKv();
    const r = await kv.get<SquareSettings>([PREFIX, userId]);
    return r.value ?? null;
  }

  async put(settings: SquareSettings): Promise<SquareSettings> {
    const kv = await getKv();
    await kv.set([PREFIX, settings.userId], settings);
    return settings;
  }

  async delete(userId: string): Promise<void> {
    const kv = await getKv();
    await kv.delete([PREFIX, userId]);
  }
}
