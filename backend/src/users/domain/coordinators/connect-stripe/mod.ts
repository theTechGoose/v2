/**
 * REQ-212 — connect, read, and forget a business's own Stripe: the pair is checked for shape
 * (shared/payments/stripe-keys) and against Stripe (the account the secret belongs to), the
 * secret is sealed before it is stored, and the status never carries the secret — only its
 * prefix and last four. `secretFor` is what the charge path (REQ-213) opens the secret with.
 */
import { Injectable } from "#danet/core";
import { checkKeyPair, maskSecret } from "#payments/stripe-keys.ts";
import {
  openSecret,
  sealSecret,
  secretsKey,
  SecretsKeyMissing,
} from "@core/business/secret-box/mod.ts";
import { StripeError, StripeGateway } from "@core/data/stripe-gateway/mod.ts";
import { StripeSettingsStore } from "@users/domain/data/stripe-settings-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SquareSettingsStore } from "@users/domain/data/square-settings-store/mod.ts"; // REQ-803

export interface StripeMerchant {
  name: string;
  hasLogo: boolean;
  logoFileId?: string;
}
export type StripeStatus =
  | { connected: false; merchant: StripeMerchant }
  | {
    connected: true;
    mode: "test" | "live";
    fake: boolean;
    publishableKey: string;
    secretMasked: string;
    accountId: string;
    accountName: string;
    connectedAt: string;
    merchant: StripeMerchant;
  };
export interface StripeConnection {
  secretKey: string;
  publishableKey: string;
  mode: "test" | "live";
  fake: boolean;
  accountId: string;
  accountName: string;
}

export class StripeConnectError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

@Injectable()
export class ConnectStripe {
  constructor(
    private store: StripeSettingsStore,
    private gateway: StripeGateway,
    private identity: BusinessIdentityStore,
    private users: UserStore,
    /** REQ-803 — one card provider at a time: Stripe is refused while Square is connected */
    private squareStore: SquareSettingsStore = new SquareSettingsStore(),
  ) {}

  async merchant(userId: string): Promise<StripeMerchant> {
    const [ident, user] = await Promise.all([
      this.identity.get(userId).catch(() => null),
      this.users.get(userId).catch(() => undefined),
    ]);
    const name = ident?.businessName?.trim() || ident?.legalName?.trim() ||
      user?.name?.trim() || "";
    return {
      name,
      hasLogo: !!ident?.logoFileId,
      ...(ident?.logoFileId ? { logoFileId: ident.logoFileId } : {}),
    };
  }

  async status(userId: string): Promise<StripeStatus> {
    const [s, merchant] = await Promise.all([
      this.store.get(userId),
      this.merchant(userId),
    ]);
    if (!s) return { connected: false, merchant };
    return {
      connected: true,
      mode: s.mode,
      fake: s.fake,
      publishableKey: s.publishableKey,
      secretMasked: `${
        s.publishableKey.startsWith("pk_")
          ? s.publishableKey.replace(/^pk_((?:test|live)_).*/, "sk_$1")
          : ""
      }••••${s.secretLast4}`,
      accountId: s.accountId,
      accountName: s.accountName,
      connectedAt: s.connectedAt,
      merchant,
    };
  }

  async isConnected(userId: string): Promise<boolean> {
    return (await this.store.get(userId)) !== null;
  }

  async connect(
    userId: string,
    publishableKey: string,
    secretKey: string,
  ): Promise<StripeStatus> {
    const pk = publishableKey.trim();
    const sk = secretKey.trim();
    const pair = checkKeyPair(pk, sk);
    if (!pair.ok) {
      throw new StripeConnectError(
        422,
        pair.reason,
        `stripe keys: ${pair.reason}`,
      );
    }
    // REQ-803 — one card provider at a time
    if (await this.squareStore.get(userId).catch(() => null)) {
      throw new StripeConnectError(
        409,
        "square_connected",
        "Square is connected — disconnect it to take cards through Stripe",
      );
    }
    let key: CryptoKey;
    try {
      key = await secretsKey();
    } catch (e) {
      if (e instanceof SecretsKeyMissing) {
        throw new StripeConnectError(503, "secrets_key_missing", e.message);
      }
      throw e;
    }
    let account;
    try {
      account = await this.gateway.account(sk);
    } catch (e) {
      if (e instanceof StripeError) {
        if (e.code === "fake_key_refused") {
          throw new StripeConnectError(422, "fake_key_refused", e.message);
        }
        throw new StripeConnectError(422, "stripe_rejected", e.message);
      }
      throw e;
    }
    const now = new Date().toISOString();
    const before = await this.store.get(userId);
    await this.store.put({
      userId,
      publishableKey: pk,
      secretSealed: await sealSecret(sk, key),
      secretLast4: sk.slice(-4),
      mode: pair.mode,
      fake: pair.fake,
      accountId: account.id,
      accountName: account.name,
      connectedAt: before?.accountId === account.id ? before.connectedAt : now,
      updatedAt: now,
    });
    return this.status(userId);
  }

  async disconnect(userId: string): Promise<StripeStatus> {
    await this.store.delete(userId);
    return this.status(userId);
  }

  /** The connection with the secret OPEN — for the charge path only; null when not connected. */
  async secretFor(userId: string): Promise<StripeConnection | null> {
    const s = await this.store.get(userId);
    if (!s) return null;
    const secretKey = await openSecret(s.secretSealed, await secretsKey());
    return {
      secretKey,
      publishableKey: s.publishableKey,
      mode: s.mode,
      fake: s.fake,
      accountId: s.accountId,
      accountName: s.accountName,
    };
  }
}

export { maskSecret };
