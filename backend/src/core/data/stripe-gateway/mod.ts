/**
 * REQ-212/213 — Stripe, from this app's side, always on the BUSINESS's own keys: the account a
 * secret key belongs to (the connect check), a PaymentIntent created and confirmed on the
 * business's secret key for a PaymentMethod the browser made with the business's publishable
 * key, and the intent read back. No Stripe Connect, no platform account: the funds settle in
 * the business's Stripe balance and never touch ours.
 *
 * Off the real deploy a fake key (`sk_test_fake_<name>` / `pk_test_fake_<name>`, REQ-212)
 * talks to the in-process fake below — the gate's lanes and a dev box run on it the way the
 * link builder's fake stands in for the CRM. On the real deploy a fake key is refused before
 * any call. A real key always goes to api.stripe.com.
 */
import { Injectable } from "#danet/core";
import { onRealDeploy } from "@core/business/real-deploy/mod.ts";
import { stripeKeyInfo } from "#payments/stripe-keys.ts";
import { brandOf, luhnValid, numberLengthFor } from "#payments/card-entry.ts";

export const STRIPE_API = "https://api.stripe.com";

export class StripeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly declineCode?: string,
  ) {
    super(message);
  }
}

export interface StripeAccount {
  id: string;
  name: string;
  mode: "test" | "live";
}
export interface StripePaymentMethod {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  name?: string;
}
export interface IntentInput {
  amountCents: number;
  currency: string;
  paymentMethodId: string;
  description: string;
  metadata: Record<string, string>;
  receiptEmail?: string;
  idempotencyKey: string;
}
export interface StripeIntent {
  id: string;
  status: string;
  clientSecret?: string;
  amount: number;
  currency: string;
  metadata: Record<string, string>;
  brand?: string;
  last4?: string;
}

// ---------------------------------------------------------------- the fake

interface FakeIntent extends StripeIntent {
  account: string;
  paymentMethodId: string;
}
interface FakeMethod extends StripePaymentMethod {
  account: string;
  number: string;
}

class FakeStripeWorld {
  paymentMethods = new Map<string, FakeMethod>();
  intents = new Map<string, FakeIntent>();
  private idem = new Map<string, string>();
  private n = 0;

  reset() {
    this.paymentMethods.clear();
    this.intents.clear();
    this.idem.clear();
    this.n = 0;
  }

  /** `sk_test_fake_acme` → "acme" */
  suffixOf(key: string): string {
    return key.trim().replace(/^(?:pk|sk|rk)_test_fake_/, "");
  }

  account(secretKey: string): StripeAccount {
    const suffix = this.suffixOf(secretKey);
    if (!suffix || suffix === "bad") {
      throw new StripeError(
        401,
        "invalid_api_key",
        "Invalid API Key provided: " + maskForMessage(secretKey),
      );
    }
    return {
      id: `acct_fake_${suffix}`,
      name: `${suffix.charAt(0).toUpperCase()}${
        suffix.slice(1)
      } (fake Stripe account)`,
      mode: "test",
    };
  }

  createPaymentMethod(
    publishableKey: string,
    form: URLSearchParams,
  ): StripePaymentMethod {
    const account = `acct_fake_${this.suffixOf(publishableKey)}`;
    const number = (form.get("card[number]") ?? "").replace(/\D/g, "");
    const brand = brandOf(number);
    if (number.length !== numberLengthFor(brand) || !luhnValid(number)) {
      throw new StripeError(
        402,
        "incorrect_number",
        "Your card number is incorrect.",
      );
    }
    const expMonth = Number(form.get("card[exp_month]"));
    const expYear = Number(form.get("card[exp_year]"));
    if (!(expMonth >= 1 && expMonth <= 12)) {
      throw new StripeError(
        402,
        "invalid_expiry_month",
        "Your card's expiration month is invalid.",
      );
    }
    if (!(expYear >= 2000)) {
      throw new StripeError(
        402,
        "invalid_expiry_year",
        "Your card's expiration year is invalid.",
      );
    }
    const cvc = form.get("card[cvc]") ?? "";
    if (!/^\d{3,4}$/.test(cvc)) {
      throw new StripeError(
        402,
        "incorrect_cvc",
        "Your card's security code is incorrect.",
      );
    }
    const pm: FakeMethod = {
      id: `pm_fake_${++this.n}_${crypto.randomUUID().slice(0, 8)}`,
      account,
      number,
      brand,
      last4: number.slice(-4),
      expMonth,
      expYear,
      ...(form.get("billing_details[name]")
        ? { name: form.get("billing_details[name]")! }
        : {}),
    };
    this.paymentMethods.set(pm.id, pm);
    return pm;
  }

  createPaymentIntent(secretKey: string, input: IntentInput): StripeIntent {
    const account = this.account(secretKey).id;
    const idemKey = `${account}:${input.idempotencyKey}`;
    const seen = this.idem.get(idemKey);
    if (seen) return this.intents.get(seen)!;
    const pm = this.paymentMethods.get(input.paymentMethodId);
    if (!pm || pm.account !== account) {
      throw new StripeError(
        400,
        "resource_missing",
        `No such PaymentMethod: '${input.paymentMethodId}'`,
      );
    }
    if (pm.number === "4000000000000002") {
      throw new StripeError(
        402,
        "card_declined",
        "Your card was declined.",
        "generic_decline",
      );
    }
    const id = `pi_fake_${++this.n}_${crypto.randomUUID().slice(0, 8)}`;
    const needs3ds = pm.number === "4000002500003155";
    const pi: FakeIntent = {
      id,
      account,
      paymentMethodId: pm.id,
      status: needs3ds ? "requires_action" : "succeeded",
      ...(needs3ds ? { clientSecret: `${id}_secret_fake` } : {}),
      amount: input.amountCents,
      currency: input.currency,
      metadata: { ...input.metadata },
      brand: pm.brand,
      last4: pm.last4,
    };
    this.intents.set(id, pi);
    this.idem.set(idemKey, id);
    return pi;
  }

  retrievePaymentIntent(secretKey: string, id: string): StripeIntent {
    const account = this.account(secretKey).id;
    const pi = this.intents.get(id);
    if (!pi || pi.account !== account) {
      throw new StripeError(
        404,
        "resource_missing",
        `No such PaymentIntent: '${id}'`,
      );
    }
    return pi;
  }

  /** the 3-D Secure challenge passed (what Stripe.js would have driven) */
  settle(id: string) {
    const pi = this.intents.get(id);
    if (!pi) throw new Error(`fake stripe: no intent ${id}`);
    pi.status = "succeeded";
    delete pi.clientSecret;
  }
}

const WORLD = new FakeStripeWorld();
export function fakeStripeWorld(): FakeStripeWorld {
  return WORLD;
}

function maskForMessage(key: string): string {
  const k = key.trim();
  return k.length > 12 ? `${k.slice(0, 8)}…${k.slice(-4)}` : "…";
}

// ---------------------------------------------------------------- the real one

async function stripeFetch(
  path: string,
  key: string,
  init: {
    method: "GET" | "POST";
    body?: URLSearchParams;
    idempotencyKey?: string;
  } = { method: "GET" },
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${key.trim()}`,
  };
  if (init.body) headers["content-type"] = "application/x-www-form-urlencoded";
  if (init.idempotencyKey) headers["idempotency-key"] = init.idempotencyKey;
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: init.method,
    headers,
    ...(init.body ? { body: init.body.toString() } : {}),
  });
  const json = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) {
    const err = (json.error ?? {}) as Record<string, string | undefined>;
    throw new StripeError(
      res.status,
      err.code ?? err.type ?? "stripe_error",
      err.message ?? `Stripe answered ${res.status}`,
      err.decline_code,
    );
  }
  return json;
}

function toIntent(j: Record<string, unknown>): StripeIntent {
  const pm =
    (j.payment_method && typeof j.payment_method === "object"
      ? j.payment_method
      : {}) as Record<string, unknown>;
  const card = (pm.card ?? {}) as Record<string, unknown>;
  return {
    id: String(j.id),
    status: String(j.status),
    ...(typeof j.client_secret === "string"
      ? { clientSecret: j.client_secret }
      : {}),
    amount: Number(j.amount),
    currency: String(j.currency),
    metadata: (j.metadata ?? {}) as Record<string, string>,
    ...(typeof card.brand === "string" ? { brand: card.brand } : {}),
    ...(typeof card.last4 === "string" ? { last4: card.last4 } : {}),
  };
}

@Injectable()
export class StripeGateway {
  /** a fake key, off the real deploy: the in-process fake answers */
  isFake(key: string): boolean {
    return stripeKeyInfo(key).fake && !onRealDeploy();
  }

  private guard(key: string) {
    if (stripeKeyInfo(key).fake && onRealDeploy()) {
      throw new StripeError(
        400,
        "fake_key_refused",
        "fake Stripe keys are refused on the real deploy",
      );
    }
  }

  async account(secretKey: string): Promise<StripeAccount> {
    this.guard(secretKey);
    if (this.isFake(secretKey)) return WORLD.account(secretKey);
    const j = await stripeFetch("/v1/account", secretKey);
    const settings = (j.settings ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    const profile = (j.business_profile ?? {}) as Record<string, unknown>;
    const name = (settings.dashboard?.display_name as string | undefined) ||
      (profile.name as string | undefined) || String(j.id);
    return { id: String(j.id), name, mode: j.livemode ? "live" : "test" };
  }

  /** The fake's tokenization only (REQ-212's dev endpoint): with a real key the browser talks
   *  to Stripe itself — a card number never passes through this app. */
  async createPaymentMethod(
    publishableKey: string,
    form: URLSearchParams,
  ): Promise<StripePaymentMethod> {
    this.guard(publishableKey);
    if (!this.isFake(publishableKey)) {
      throw new StripeError(
        400,
        "fake_only",
        "the app only tokenizes for the fake; a real key tokenizes at Stripe",
      );
    }
    return await WORLD.createPaymentMethod(publishableKey, form);
  }

  async createPaymentIntent(
    secretKey: string,
    input: IntentInput,
  ): Promise<StripeIntent> {
    this.guard(secretKey);
    if (this.isFake(secretKey)) {
      return WORLD.createPaymentIntent(secretKey, input);
    }
    const body = new URLSearchParams();
    body.set("amount", String(Math.round(input.amountCents)));
    body.set("currency", input.currency);
    body.set("payment_method", input.paymentMethodId);
    body.set("confirm", "true");
    body.set("payment_method_types[]", "card");
    body.set("description", input.description);
    for (const [k, v] of Object.entries(input.metadata)) {
      body.set(`metadata[${k}]`, v);
    }
    if (input.receiptEmail) body.set("receipt_email", input.receiptEmail);
    body.set("expand[]", "payment_method");
    const j = await stripeFetch("/v1/payment_intents", secretKey, {
      method: "POST",
      body,
      idempotencyKey: input.idempotencyKey,
    });
    return toIntent(j);
  }

  async retrievePaymentIntent(
    secretKey: string,
    id: string,
  ): Promise<StripeIntent> {
    this.guard(secretKey);
    if (this.isFake(secretKey)) {
      return WORLD.retrievePaymentIntent(secretKey, id);
    }
    const j = await stripeFetch(
      `/v1/payment_intents/${encodeURIComponent(id)}?expand[]=payment_method`,
      secretKey,
    );
    return toIntent(j);
  }
}
