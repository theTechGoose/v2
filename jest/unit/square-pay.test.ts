/**
 * REQ-803 — a business connects its OWN Square account in Settings (like its own Stripe,
 * REQ-212) and its customers pay invoices by card on Square's hosted checkout. The pure rules
 * in `shared/payments/square.ts` (the token's shape, the mask, the API host per environment,
 * the checkout's name and return address, when a Square order counts as paid), the card way
 * on /i/:id (`cardPayWay` → "square"), and the wiring of the settings card, the checkout
 * button, the invoice page, the portal page and both languages.
 */
import * as fs from "fs";
import * as path from "path";
import {
  FAKE_SQUARE_CHECKOUT,
  maskSquareToken,
  SQUARE_PRODUCTION_API,
  SQUARE_SANDBOX_API,
  SQUARE_VERSION,
  squareApiBase,
  squareCheckoutName,
  squareOrderPayment,
  squareReturnUrl,
  squareTokenInfo,
} from "../../shared/payments/square.ts";
import { cardPayWay } from "../../shared/payments/pay-links.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

const REAL = "EAAAEOuLQPDHcpdXrA-0123456789abcdefghijklmnopqrstuvwxyzABCD";

describe("REQ-803 square — the pure rules", () => {
  test("the API host per environment, and the Square-Version every call sends", () => {
    expect(SQUARE_PRODUCTION_API).toBe("https://connect.squareup.com");
    expect(SQUARE_SANDBOX_API).toBe("https://connect.squareupsandbox.com");
    expect(squareApiBase("production")).toBe(SQUARE_PRODUCTION_API);
    expect(squareApiBase("sandbox")).toBe(SQUARE_SANDBOX_API);
    expect(SQUARE_VERSION).toMatch(/^20\d\d-\d\d-\d\d$/);
    expect(FAKE_SQUARE_CHECKOUT).toBe("/api/dev/square/checkout");
  });

  test("a token: a real access token is ok; the fake is EAAAfake_<name>; an app id / app secret / junk is refused", () => {
    expect(squareTokenInfo(REAL)).toEqual({ ok: true, fake: false });
    expect(squareTokenInfo(`  ${REAL}  `)).toEqual({ ok: true, fake: false });
    expect(squareTokenInfo("EAAAfake_acme")).toEqual({ ok: true, fake: true });
    expect(squareTokenInfo("EAAAfake_")).toEqual({
      ok: false,
      reason: "token_invalid",
    });
    expect(squareTokenInfo("")).toEqual({ ok: false, reason: "token_invalid" });
    expect(squareTokenInfo("short")).toEqual({
      ok: false,
      reason: "token_invalid",
    });
    expect(squareTokenInfo("EAAA with spaces in it 0123456789")).toEqual({
      ok: false,
      reason: "token_invalid",
    });
    expect(squareTokenInfo("sq0idp-abcdefghijklmnopqrstuv")).toEqual({
      ok: false,
      reason: "app_id_not_token",
    });
    expect(squareTokenInfo("sq0csp-abcdefghijklmnopqrstuvwxyz0123")).toEqual({
      ok: false,
      reason: "app_id_not_token",
    });
  });

  test("the mask shows the first four and the last four, never the token", () => {
    expect(maskSquareToken(REAL)).toBe("EAAA••••ABCD");
    expect(maskSquareToken("EAAAfake_acme")).toBe("EAAA••••acme");
    expect(maskSquareToken("")).toBe("");
  });

  test("the checkout's name names the invoice and the business; the return address is /i/:id?square=return", () => {
    expect(squareCheckoutName("INV-001", "Acme Roofing")).toBe(
      "Invoice INV-001 · Acme Roofing",
    );
    expect(squareCheckoutName("INV-001", "")).toBe("Invoice INV-001");
    expect(squareCheckoutName(undefined, "Acme Roofing")).toBe(
      "Invoice · Acme Roofing",
    );
    expect(squareReturnUrl("https://documonster.com/", "inv 1")).toBe(
      "https://documonster.com/i/inv%201?square=return",
    );
  });

  test("a Square order is paid when it is COMPLETED, or its card tender covers it (nothing left due); the reference is the tender's payment id; tips are not the invoice's", () => {
    const tender = {
      id: "T1",
      type: "CARD",
      payment_id: "PAY_1",
      amount_money: { amount: 6500, currency: "USD" },
    };
    expect(
      squareOrderPayment({
        id: "O1",
        state: "COMPLETED",
        total_money: { amount: 6500, currency: "USD" },
        tenders: [tender],
      }),
    ).toEqual({ paid: true, paymentId: "PAY_1", amountCents: 6500 });
    // still OPEN, but nothing is due and a tender covers it
    expect(
      squareOrderPayment({
        id: "O1",
        state: "OPEN",
        total_money: { amount: 6500, currency: "USD" },
        net_amount_due_money: { amount: 0, currency: "USD" },
        tenders: [tender],
      }),
    ).toEqual({ paid: true, paymentId: "PAY_1", amountCents: 6500 });
    // a tip on top: the invoice is paid its own amount
    expect(
      squareOrderPayment({
        id: "O1",
        state: "COMPLETED",
        total_money: { amount: 7500, currency: "USD" },
        total_tip_money: { amount: 1000, currency: "USD" },
        tenders: [{ ...tender, amount_money: { amount: 7500 } }],
      }),
    ).toEqual({ paid: true, paymentId: "PAY_1", amountCents: 6500 });
    // no payment_id on the tender: the tender id is the payment's
    expect(
      squareOrderPayment({
        id: "O1",
        state: "COMPLETED",
        total_money: { amount: 6500 },
        tenders: [{ id: "T9", type: "CARD", amount_money: { amount: 6500 } }],
      }),
    ).toEqual({ paid: true, paymentId: "T9", amountCents: 6500 });
    // open, nothing paid
    expect(
      squareOrderPayment({
        id: "O1",
        state: "OPEN",
        total_money: { amount: 6500 },
        net_amount_due_money: { amount: 6500 },
      }),
    ).toEqual({ paid: false, reason: "open" });
    // canceled
    expect(
      squareOrderPayment({
        id: "O1",
        state: "CANCELED",
        total_money: { amount: 6500 },
        tenders: [tender],
      }),
    ).toEqual({ paid: false, reason: "canceled" });
    // a partial tender with money still due
    expect(
      squareOrderPayment({
        id: "O1",
        state: "OPEN",
        total_money: { amount: 6500 },
        net_amount_due_money: { amount: 500 },
        tenders: [{ ...tender, amount_money: { amount: 6000 } }],
      }),
    ).toEqual({ paid: false, reason: "open" });
    // completed with no tender at all is not a card payment we can name
    expect(
      squareOrderPayment({
        id: "O1",
        state: "COMPLETED",
        total_money: { amount: 6500 },
      }),
    ).toEqual({ paid: false, reason: "no_tender" });
    expect(squareOrderPayment(undefined)).toEqual({
      paid: false,
      reason: "open",
    });
  });

  test("cardPayWay: Square connected → the Square checkout (its fallback href the portal page); Stripe still wins when both are on", () => {
    expect(
      cardPayWay({
        invoiceId: "inv1",
        stripe: false,
        square: true,
        methods: [],
      }),
    ).toEqual({ kind: "square", href: "/i/inv1/pay" });
    expect(
      cardPayWay({
        invoiceId: "inv1",
        stripe: false,
        square: true,
        methods: [],
        lang: "es",
      }),
    ).toEqual({ kind: "square", href: "/i/inv1/pay?lang=es" });
    expect(
      cardPayWay({
        invoiceId: "inv1",
        stripe: true,
        square: true,
        methods: [],
      }),
    ).toEqual({ kind: "portal", href: "/i/inv1/pay" });
    // without square nothing changed (REQ-782)
    expect(cardPayWay({ invoiceId: "inv1", stripe: false, methods: [] }))
      .toBeNull();
  });
});

describe("REQ-803 the wiring", () => {
  test("the Square client talks to /me/square", () => {
    expect(exists("front-end/clients/square.ts")).toBe(true);
    const client = read("front-end/clients/square.ts");
    expect(client).toMatch(/"\/me\/square"/);
    expect(client).toMatch(/api\.put</);
    expect(client).toMatch(/api\.delete</);
  });

  test("Settings has a Card payments (Square) card next to Stripe's: token, optional location, status with the masked token, disconnect, the merchant line", () => {
    const s = read("front-end/islands/SettingsPage.tsx");
    expect(s).toMatch(/function SquarePaymentsCard\(/);
    expect(s).toMatch(/<SquarePaymentsCard /);
    // the card itself is an EditPanel (its `dataCy` prop)
    expect(s).toContain(`dataCy="square-card"`);
    for (
      const cy of [
        "square-token",
        "square-location",
        "square-connect",
        "square-status",
        "square-disconnect",
        "square-merchant",
      ]
    ) {
      expect(s).toContain(`data-cy="${cy}"`);
    }
    expect(s).toMatch(/squareClient\.connect\(/);
    expect(s).toMatch(/settings\.square\.direct/);
    // one card provider at a time: each card refreshes when the other changes
    expect(s).toMatch(/pm:card-provider/);
  });

  test("the checkout button: an island that POSTs /invoices/:id/square/checkout and goes to Square's page, naming Square", () => {
    expect(exists("front-end/islands/SquareCheckout.tsx")).toBe(true);
    const isl = read("front-end/islands/SquareCheckout.tsx");
    expect(isl).toMatch(/\/square\/checkout/);
    expect(isl).toMatch(/location\.assign\(/);
    expect(isl).toMatch(/data-cy="pay-by-card"/);
    expect(isl).toMatch(/payByCard\.square\.note/);
    expect(isl).toMatch(/stale_balance/);
    const btn = read("front-end/components/PayByCard.tsx");
    expect(btn).toMatch(/way\.kind === "square"/);
    expect(btn).toMatch(/<SquareCheckout/);
  });

  test("/i/:id reads the Square config and hands it to the card way; the return is checked; /i/:id/pay offers Square too", () => {
    const route = read("front-end/routes/i/[id].tsx");
    expect(route).toMatch(/\/square`/);
    expect(route).toMatch(/square:\s*!!square/);
    expect(route).toMatch(/square=return/);
    const pay = read("front-end/routes/i/[id]/pay.tsx");
    expect(pay).toMatch(/<SquareCheckout/);
  });

  test("every new word exists in both languages", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    const keys = [
      "settings.square",
      "settings.square.intro",
      "settings.square.direct",
      "settings.square.token",
      "settings.square.tokenPh",
      "settings.square.location",
      "settings.square.locationPh",
      "settings.square.connect",
      "settings.square.connecting",
      "settings.square.connected",
      "settings.square.disconnect",
      "settings.square.production",
      "settings.square.sandbox",
      "settings.square.sandboxNote",
      "settings.square.merchant",
      "settings.square.stripeOn",
      "settings.square.err.token_invalid",
      "settings.square.err.app_id_not_token",
      "settings.square.err.square_rejected",
      "settings.square.err.location_not_found",
      "settings.square.err.no_location",
      "settings.square.err.currency_unsupported",
      "settings.square.err.fake_token_refused",
      "settings.square.err.stripe_connected",
      "settings.square.err.secrets_key_missing",
      "settings.square.err.failed",
      "settings.stripe.err.square_connected",
      "payByCard.square.note",
      "payByCard.square.going",
      "payByCard.square.stale",
      "payByCard.square.failed",
      "payByCard.square.notCompleted",
    ];
    for (const k of keys) {
      expect([k, typeof en[k]]).toEqual([k, "string"]);
      expect([k, typeof es[k]]).toEqual([k, "string"]);
      expect(en[k]).not.toBe("");
      expect(es[k]).not.toBe("");
    }
  });
});
