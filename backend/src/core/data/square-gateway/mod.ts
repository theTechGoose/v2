/**
 * REQ-803 — Square, from this app's side, always on the BUSINESS's own access token: the
 * seller's locations (the connect check, which also tells which environment the token belongs
 * to), a payment link (Square's hosted checkout) for an invoice's exact balance, and the order
 * behind it read back to learn whether it was paid. No OAuth platform app, no application fee:
 * the money settles in the business's Square balance and never touches ours.
 *
 * Off the real deploy a fake token (`EAAAfake_<name>`) talks to the in-process fake below — its
 * payment link points at a dev-only checkout page this app serves (`/api/dev/square/checkout`,
 * dev-square-controller). On the real deploy a fake token is refused before any call. A real
 * token always goes to Square: production first, the sandbox host when production says 401.
 */
import { Injectable } from "#danet/core";
import {
  type EnvReader,
  onRealDeploy,
} from "@core/business/real-deploy/mod.ts";
import {
  FAKE_SQUARE_CHECKOUT,
  SQUARE_VERSION,
  squareApiBase,
  type SquareEnvironment,
  type SquareOrderLike,
  squareTokenInfo,
} from "#payments/square.ts";

export class SquareError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface SquareLocation {
  id: string;
  name: string;
  businessName?: string;
  status: string;
  currency?: string;
  merchantId?: string;
}
export interface PaymentLinkInput {
  idempotencyKey: string;
  /** what the customer reads on the checkout */
  name: string;
  /** INTEGER CENTS */
  amountCents: number;
  currency: string;
  locationId: string;
  redirectUrl: string;
  note?: string;
}
export interface SquarePaymentLink {
  id: string;
  url: string;
  orderId: string;
}

/**
 * REQ-318's real-vs-fake switch as the Square seam reads it: the process env by default. A test
 * pins its own reader here (or on one gateway's `env`) instead of flipping DENO_DEPLOY — parallel
 * test files share one process env, and a flip races every other file.
 */
export const squareEnv: { reader: EnvReader } = { reader: Deno.env };

// ---------------------------------------------------------------- the fake

export interface FakeLink extends PaymentLinkInput {
  id: string;
  orderId: string;
  /** the fake seller (the token's name) */
  account: string;
}
interface FakeOrder extends SquareOrderLike {
  id: string;
  account: string;
  linkId: string;
}

class FakeSquareWorld {
  links = new Map<string, FakeLink>();
  orders = new Map<string, FakeOrder>();
  private idem = new Map<string, string>();
  private n = 0;

  reset() {
    this.links.clear();
    this.orders.clear();
    this.idem.clear();
    this.n = 0;
  }

  /** `EAAAfake_acme` → "acme" */
  accountOf(token: string): string {
    const suffix = token.trim().replace(/^EAAAfake_/, "");
    if (!suffix || suffix === "bad") {
      throw new SquareError(
        401,
        "UNAUTHORIZED",
        "This request could not be authorized.",
      );
    }
    return suffix;
  }

  locations(token: string): SquareLocation[] {
    const a = this.accountOf(token);
    const cap = `${a.charAt(0).toUpperCase()}${a.slice(1)}`;
    const businessName = `${cap} (fake Square seller)`;
    return [
      {
        id: `LFAKE_${a}_closed`,
        name: `${cap} Old Shop (fake)`,
        businessName,
        status: "INACTIVE",
        currency: "USD",
        merchantId: `MFAKE_${a}`,
      },
      {
        id: `LFAKE_${a}_main`,
        name: `${cap} Main St (fake)`,
        businessName,
        status: "ACTIVE",
        currency: "USD",
        merchantId: `MFAKE_${a}`,
      },
    ];
  }

  createPaymentLink(token: string, input: PaymentLinkInput): SquarePaymentLink {
    const account = this.accountOf(token);
    const idemKey = `${account}:${input.idempotencyKey}`;
    const seen = this.idem.get(idemKey);
    if (seen) return this.view(this.links.get(seen)!);
    if (!this.locations(token).some((l) => l.id === input.locationId)) {
      throw new SquareError(
        400,
        "NOT_FOUND",
        `Location \`${input.locationId}\` not found.`,
      );
    }
    const id = `sqlink_fake_${++this.n}_${crypto.randomUUID().slice(0, 8)}`;
    const orderId = `sqorder_fake_${this.n}_${crypto.randomUUID().slice(0, 8)}`;
    const link: FakeLink = { ...input, id, orderId, account };
    this.links.set(id, link);
    this.orders.set(orderId, {
      id: orderId,
      account,
      linkId: id,
      state: "OPEN",
      total_money: { amount: input.amountCents, currency: input.currency },
      net_amount_due_money: {
        amount: input.amountCents,
        currency: input.currency,
      },
      tenders: [],
    });
    this.idem.set(idemKey, id);
    return this.view(link);
  }

  private view(link: FakeLink): SquarePaymentLink {
    return {
      id: link.id,
      url: `${FAKE_SQUARE_CHECKOUT}/${link.id}`,
      orderId: link.orderId,
    };
  }

  retrieveOrder(token: string, orderId: string): SquareOrderLike {
    const account = this.accountOf(token);
    const o = this.orders.get(orderId);
    if (!o || o.account !== account) {
      throw new SquareError(404, "NOT_FOUND", `Order ${orderId} not found.`);
    }
    const { account: _a, linkId: _l, ...order } = o;
    return structuredClone(order);
  }

  /** the customer paid on the fake checkout: the order is COMPLETED with one card tender */
  pay(linkId: string): { paymentId: string; redirectUrl: string } {
    const link = this.links.get(linkId);
    if (!link) throw new Error(`fake square: no link ${linkId}`);
    const o = this.orders.get(link.orderId)!;
    if (o.state !== "COMPLETED") {
      const paymentId = `sqpay_fake_${++this.n}_${
        crypto.randomUUID().slice(0, 8)
      }`;
      o.state = "COMPLETED";
      o.net_amount_due_money = { amount: 0, currency: link.currency };
      o.tenders = [{
        id: paymentId,
        type: "CARD",
        payment_id: paymentId,
        amount_money: { amount: link.amountCents, currency: link.currency },
      }];
    }
    return {
      paymentId: String(o.tenders![0].payment_id),
      redirectUrl: link.redirectUrl,
    };
  }
}

const WORLD = new FakeSquareWorld();
export function fakeSquareWorld(): FakeSquareWorld {
  return WORLD;
}

// ---------------------------------------------------------------- the real one

async function squareFetch(
  env: SquareEnvironment,
  path: string,
  token: string,
  init: { method: "GET" | "POST"; body?: unknown } = { method: "GET" },
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token.trim()}`,
    "square-version": SQUARE_VERSION,
    accept: "application/json",
  };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${squareApiBase(env)}${path}`, {
    method: init.method,
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const json = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) {
    const errs = Array.isArray(json.errors)
      ? json.errors as Array<Record<string, string | undefined>>
      : [];
    const first = errs[0] ?? {};
    throw new SquareError(
      res.status,
      first.code ?? first.category ?? "SQUARE_ERROR",
      first.detail ?? `Square answered ${res.status}`,
    );
  }
  return json;
}

function toLocation(j: Record<string, unknown>): SquareLocation {
  return {
    id: String(j.id),
    name: String(j.name ?? j.id),
    ...(typeof j.business_name === "string"
      ? { businessName: j.business_name }
      : {}),
    status: String(j.status ?? ""),
    ...(typeof j.currency === "string" ? { currency: j.currency } : {}),
    ...(typeof j.merchant_id === "string" ? { merchantId: j.merchant_id } : {}),
  };
}

@Injectable()
export class SquareGateway {
  /** where the real-deploy switch is read (REQ-318); unset = `squareEnv.reader` */
  env?: EnvReader;

  /** a fake token, off the real deploy: the in-process fake answers */
  isFake(token: string): boolean {
    const info = squareTokenInfo(token);
    return info.ok && info.fake && !onRealDeploy(this.env ?? squareEnv.reader);
  }

  private guard(token: string) {
    const info = squareTokenInfo(token);
    if (info.ok && info.fake && onRealDeploy(this.env ?? squareEnv.reader)) {
      throw new SquareError(
        400,
        "fake_token_refused",
        "fake Square tokens are refused on the real deploy",
      );
    }
  }

  /** The seller's locations, and the environment the token belongs to (production is asked
   *  first; a 401 there sends the same token to the sandbox host). */
  async locations(
    token: string,
  ): Promise<{ environment: SquareEnvironment; locations: SquareLocation[] }> {
    this.guard(token);
    if (this.isFake(token)) {
      return { environment: "sandbox", locations: WORLD.locations(token) };
    }
    const list = (j: Record<string, unknown>) =>
      (Array.isArray(j.locations) ? j.locations : []).map((l) =>
        toLocation(l as Record<string, unknown>)
      );
    try {
      const j = await squareFetch("production", "/v2/locations", token);
      return { environment: "production", locations: list(j) };
    } catch (e) {
      if (!(e instanceof SquareError) || e.status !== 401) throw e;
      const j = await squareFetch("sandbox", "/v2/locations", token);
      return { environment: "sandbox", locations: list(j) };
    }
  }

  async createPaymentLink(
    token: string,
    env: SquareEnvironment,
    input: PaymentLinkInput,
  ): Promise<SquarePaymentLink> {
    this.guard(token);
    if (this.isFake(token)) return WORLD.createPaymentLink(token, input);
    const j = await squareFetch(
      env,
      "/v2/online-checkout/payment-links",
      token,
      {
        method: "POST",
        body: {
          idempotency_key: input.idempotencyKey,
          quick_pay: {
            name: input.name,
            price_money: {
              amount: Math.round(input.amountCents),
              currency: input.currency,
            },
            location_id: input.locationId,
          },
          checkout_options: { redirect_url: input.redirectUrl },
          ...(input.note ? { payment_note: input.note } : {}),
        },
      },
    );
    const link = (j.payment_link ?? {}) as Record<string, unknown>;
    if (typeof link.url !== "string" || typeof link.order_id !== "string") {
      throw new SquareError(502, "bad_reply", "Square sent no checkout link");
    }
    return {
      id: String(link.id),
      url: link.url,
      orderId: link.order_id,
    };
  }

  async retrieveOrder(
    token: string,
    env: SquareEnvironment,
    orderId: string,
  ): Promise<SquareOrderLike> {
    this.guard(token);
    if (this.isFake(token)) return WORLD.retrieveOrder(token, orderId);
    const j = await squareFetch(
      env,
      `/v2/orders/${encodeURIComponent(orderId)}`,
      token,
    );
    return (j.order ?? {}) as SquareOrderLike;
  }
}
