/**
 * REQ-803 — connect, read, and forget a business's OWN Square: the access token is checked for
 * shape (shared/payments/square) and against Square (`GET /v2/locations` — which also tells the
 * environment: production, else sandbox), the location is the one pasted (it must be one of the
 * seller's ACTIVE locations) or the first ACTIVE one, the token is sealed before it is stored,
 * and the status never carries the token — only its first and last four. `tokenFor` is what the
 * checkout and the return (public-controller) open the token with.
 *
 * One card provider at a time: while Stripe is connected Square is refused (409
 * `stripe_connected`), and ConnectStripe refuses Stripe while Square is (409
 * `square_connected`) — the business disconnects one to use the other.
 */
import { Injectable } from "#danet/core";
import {
  maskSquareToken,
  type SquareEnvironment,
  squareTokenInfo,
} from "#payments/square.ts";
import {
  openSecret,
  sealSecret,
  secretsKey,
  SecretsKeyMissing,
} from "@core/business/secret-box/mod.ts";
import {
  squareEnv,
  SquareError,
  SquareGateway,
  type SquareLocation,
} from "@core/data/square-gateway/mod.ts";
import { SquareSettingsStore } from "@users/domain/data/square-settings-store/mod.ts";
import { StripeSettingsStore } from "@users/domain/data/stripe-settings-store/mod.ts";
import {
  ConnectStripe,
  type StripeMerchant,
} from "@users/domain/coordinators/connect-stripe/mod.ts";

export type SquareStatus =
  | {
    connected: false;
    merchant: StripeMerchant;
    /** the other card provider that is on (one at a time) */
    otherProvider: "stripe" | null;
  }
  | {
    connected: true;
    environment: SquareEnvironment;
    fake: boolean;
    tokenMasked: string;
    locationId: string;
    locationName: string;
    sellerName: string;
    connectedAt: string;
    merchant: StripeMerchant;
    otherProvider: null;
  };
export interface SquareConnection {
  token: string;
  environment: SquareEnvironment;
  fake: boolean;
  locationId: string;
  locationName: string;
  sellerName: string;
}

export class SquareConnectError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

@Injectable()
export class ConnectSquare {
  constructor(
    private store: SquareSettingsStore,
    private gateway: SquareGateway,
    private stripeStore: StripeSettingsStore,
    private stripe: ConnectStripe,
  ) {}

  /** the merchant the customer sees — the same business name + logo as Stripe's preview */
  merchant(userId: string): Promise<StripeMerchant> {
    return this.stripe.merchant(userId);
  }

  async status(userId: string): Promise<SquareStatus> {
    const [s, merchant, stripeOn] = await Promise.all([
      this.store.get(userId),
      this.merchant(userId),
      this.stripeStore.get(userId).then((x) => !!x).catch(() => false),
    ]);
    if (!s) {
      return {
        connected: false,
        merchant,
        otherProvider: stripeOn ? "stripe" : null,
      };
    }
    return {
      connected: true,
      environment: s.environment,
      fake: s.fake,
      tokenMasked: s.tokenMasked,
      locationId: s.locationId,
      locationName: s.locationName,
      sellerName: s.sellerName,
      connectedAt: s.connectedAt,
      merchant,
      otherProvider: null,
    };
  }

  async isConnected(userId: string): Promise<boolean> {
    return (await this.store.get(userId)) !== null;
  }

  async connect(
    userId: string,
    accessToken: string,
    locationId?: string,
  ): Promise<SquareStatus> {
    const token = (accessToken ?? "").trim();
    const wanted = (locationId ?? "").trim();
    const info = squareTokenInfo(token);
    if (!info.ok) {
      throw new SquareConnectError(
        422,
        info.reason,
        `square token: ${info.reason}`,
      );
    }
    if (await this.stripeStore.get(userId).catch(() => null)) {
      throw new SquareConnectError(
        409,
        "stripe_connected",
        "Stripe is connected — disconnect it to take cards through Square",
      );
    }
    let key: CryptoKey;
    try {
      key = await secretsKey(squareEnv.reader);
    } catch (e) {
      if (e instanceof SecretsKeyMissing) {
        throw new SquareConnectError(503, "secrets_key_missing", e.message);
      }
      throw e;
    }
    let found: { environment: SquareEnvironment; locations: SquareLocation[] };
    try {
      found = await this.gateway.locations(token);
    } catch (e) {
      if (e instanceof SquareError) {
        if (e.code === "fake_token_refused") {
          throw new SquareConnectError(422, "fake_token_refused", e.message);
        }
        throw new SquareConnectError(422, "square_rejected", e.message);
      }
      throw e;
    }
    const active = found.locations.filter((l) => l.status === "ACTIVE");
    const location = wanted ? active.find((l) => l.id === wanted) : active[0];
    if (!location) {
      throw new SquareConnectError(
        422,
        wanted ? "location_not_found" : "no_location",
        wanted
          ? `no active Square location ${wanted} on this account`
          : "this Square account has no active location",
      );
    }
    if (location.currency && location.currency !== "USD") {
      throw new SquareConnectError(
        422,
        "currency_unsupported",
        `the location takes ${location.currency}; invoices are in USD`,
      );
    }
    const now = new Date().toISOString();
    const before = await this.store.get(userId);
    await this.store.put({
      userId,
      tokenSealed: await sealSecret(token, key),
      tokenMasked: maskSquareToken(token),
      environment: found.environment,
      fake: info.fake,
      locationId: location.id,
      locationName: location.name,
      sellerName: location.businessName || location.name,
      ...(location.merchantId ? { merchantId: location.merchantId } : {}),
      connectedAt: before?.locationId === location.id
        ? before.connectedAt
        : now,
      updatedAt: now,
    });
    return this.status(userId);
  }

  async disconnect(userId: string): Promise<SquareStatus> {
    await this.store.delete(userId);
    return this.status(userId);
  }

  /** The connection with the token OPEN — for the checkout and the return only; null when not
   *  connected, or while Stripe is (Stripe keeps the card, as it always did). */
  async tokenFor(userId: string): Promise<SquareConnection | null> {
    const s = await this.store.get(userId);
    if (!s) return null;
    if (await this.stripeStore.get(userId).catch(() => null)) return null;
    const token = await openSecret(
      s.tokenSealed,
      await secretsKey(squareEnv.reader),
    );
    return {
      token,
      environment: s.environment,
      fake: s.fake,
      locationId: s.locationId,
      locationName: s.locationName,
      sellerName: s.sellerName,
    };
  }
}
