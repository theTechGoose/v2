/**
 * REQ-212 — a business's Stripe connection: its publishable key, its secret key SEALED
 * (core/business/secret-box; never in the clear in KV), and what Stripe said about the account.
 * One record per user. All data is user-owned.
 */
import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";

const PREFIX = "stripe_settings";

export interface StripeSettings {
  userId: string;
  publishableKey: string;
  /** the secret key, sealed (secret-box `v1.…`) */
  secretSealed: string;
  secretLast4: string;
  mode: "test" | "live";
  fake: boolean;
  accountId: string;
  accountName: string;
  connectedAt: string;
  updatedAt: string;
}

@Injectable()
export class StripeSettingsStore {
  async get(userId: string): Promise<StripeSettings | null> {
    const kv = await getKv();
    const r = await kv.get<StripeSettings>([PREFIX, userId]);
    return r.value ?? null;
  }

  async put(settings: StripeSettings): Promise<StripeSettings> {
    const kv = await getKv();
    await kv.set([PREFIX, settings.userId], settings);
    return settings;
  }

  async delete(userId: string): Promise<void> {
    const kv = await getKv();
    await kv.delete([PREFIX, userId]);
  }
}
