/**
 * REQ-212 — the in-process fake Stripe's one browser-facing call, off the real deploy only:
 * `POST /dev/stripe/v1/payment_methods` tokenizes a card for a FAKE publishable key in Stripe's
 * own shape, so the public card page (REQ-213) runs the same code against the fake as against
 * Stripe. On the real deploy the route does not exist (404) unless STRIPE_DEMO_FAKE=1 (REQ-804,
 * the sales demo). A real key is never served here.
 */
import { Context, Controller, Post } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import {
  fakeStripeAllowed,
  StripeError,
  StripeGateway,
} from "@core/data/stripe-gateway/mod.ts";

@Controller("dev/stripe/v1")
export class DevStripeController {
  constructor(private gateway: StripeGateway) {}

  @Post("payment_methods")
  async paymentMethods(@Context() ctx: ExecutionContext) {
    if (!fakeStripeAllowed()) return ctx.json({ error: "not_found" }, 404);
    const auth = ctx.req.header("authorization") ?? "";
    const key = auth.replace(/^Bearer\s+/i, "").trim();
    const form = new URLSearchParams(await ctx.req.text());
    try {
      const pm = await this.gateway.createPaymentMethod(key, form);
      return ctx.json({
        id: pm.id,
        object: "payment_method",
        type: "card",
        card: {
          brand: pm.brand,
          last4: pm.last4,
          exp_month: pm.expMonth,
          exp_year: pm.expYear,
        },
        billing_details: { name: pm.name ?? null },
        livemode: false,
      });
    } catch (e) {
      if (e instanceof StripeError) {
        return ctx.json({
          error: {
            type: e.status === 402 ? "card_error" : "invalid_request_error",
            code: e.code,
            message: e.message,
          },
        }, e.status === 402 ? 402 : e.status === 401 ? 401 : 400);
      }
      throw e;
    }
  }
}
