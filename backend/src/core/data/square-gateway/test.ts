/**
 * REQ-803 — the Square gateway, always on the BUSINESS's own access token: the in-process fake
 * (locations, a payment link to a fake checkout page, the order paid or left open), the real
 * deploy's refusal of a fake token, and the real HTTP calls (with `fetch` stubbed): the
 * environment inferred from which Square host accepts the token, the headers, the payment
 * link's body, the order read back.
 */
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "#std/assert";
import { fakeSquareWorld, SquareError, SquareGateway } from "./mod.ts";
import type { EnvReader } from "@core/business/real-deploy/mod.ts";

// The real-deploy switch is read from the gateway's own `env` — never the process's, which
// parallel test files share (REQ-318).
const OFF: EnvReader = { get: () => undefined };
const ON: EnvReader = { get: (k) => (k === "DENO_DEPLOY" ? "1" : undefined) };
function gateway(env: EnvReader = OFF): SquareGateway {
  const g = new SquareGateway();
  g.env = env;
  return g;
}

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}
async function withFetch(
  answer: (c: Call) => Response,
  fn: (calls: Call[]) => Promise<void>,
) {
  const calls: Call[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const h = new Headers(init?.headers);
    const c: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(h.entries()),
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
    };
    calls.push(c);
    return Promise.resolve(answer(c));
  }) as typeof fetch;
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = real;
  }
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const TOKEN = "EAAAEOuLQPDHcpdXrA-0123456789abcdefghijklmnopqrstuvwxyzABCD";

Deno.test("REQ-803 square-gateway fake — the locations are named after the token; a bad token is 401; the fake is sandbox", async () => {
  fakeSquareWorld().reset();
  const gw = gateway();
  assertEquals(gw.isFake("EAAAfake_acme"), true);
  assertEquals(gw.isFake(TOKEN), false);
  const r = await gw.locations("EAAAfake_acme");
  assertEquals(r.environment, "sandbox");
  assertEquals(r.locations.map((l) => [l.id, l.status, l.currency]), [
    ["LFAKE_acme_closed", "INACTIVE", "USD"],
    ["LFAKE_acme_main", "ACTIVE", "USD"],
  ]);
  assertEquals(r.locations[1].businessName, "Acme (fake Square seller)");
  const e = await assertRejects(
    () => gw.locations("EAAAfake_bad"),
    SquareError,
  );
  assertEquals([e.status, e.code], [401, "UNAUTHORIZED"]);
});

Deno.test("REQ-803 square-gateway — on the real deploy a fake token is refused before any call", async () => {
  const gw = gateway(ON);
  assertEquals(gw.isFake("EAAAfake_acme"), false);
  await withFetch(() => json(500, {}), async (calls) => {
    const e = await assertRejects(
      () => gw.locations("EAAAfake_acme"),
      SquareError,
    );
    assertEquals(e.code, "fake_token_refused");
    assertEquals(calls.length, 0, "nothing left the box");
  });
});

Deno.test("REQ-803 square-gateway fake — a payment link for the exact amount, on the business's location, to a fake checkout page; paid, its order is COMPLETED with a card tender; the same idempotency key is the same link", async () => {
  const world = fakeSquareWorld();
  world.reset();
  const gw = gateway();
  const input = {
    idempotencyKey: "k1",
    name: "Invoice INV-001 · Acme Roofing",
    amountCents: 6500,
    currency: "USD",
    locationId: "LFAKE_acme_main",
    redirectUrl: "http://localhost:9999/i/inv1?square=return",
  };
  const link = await gw.createPaymentLink("EAAAfake_acme", "sandbox", input);
  assert(link.id.startsWith("sqlink_fake_"), link.id);
  assert(link.orderId.startsWith("sqorder_fake_"), link.orderId);
  assertEquals(link.url, `/api/dev/square/checkout/${link.id}`);
  const again = await gw.createPaymentLink("EAAAfake_acme", "sandbox", input);
  assertEquals(again.id, link.id, "idempotent");
  const stored = world.links.get(link.id)!;
  assertEquals(
    [stored.amountCents, stored.name, stored.redirectUrl, stored.locationId],
    [6500, input.name, input.redirectUrl, "LFAKE_acme_main"],
  );

  const open = await gw.retrieveOrder(
    "EAAAfake_acme",
    "sandbox",
    link.orderId,
  );
  assertEquals(open.state, "OPEN");
  assertEquals(open.net_amount_due_money?.amount, 6500);

  const paid = world.pay(link.id);
  assert(paid.paymentId.startsWith("sqpay_fake_"));
  assertEquals(paid.redirectUrl, input.redirectUrl);
  const done = await gw.retrieveOrder(
    "EAAAfake_acme",
    "sandbox",
    link.orderId,
  );
  assertEquals(done.state, "COMPLETED");
  assertEquals(done.tenders?.[0]?.payment_id, paid.paymentId);
  assertEquals(done.tenders?.[0]?.amount_money?.amount, 6500);

  // another seller's token cannot read this order
  const e = await assertRejects(
    () => gw.retrieveOrder("EAAAfake_other", "sandbox", link.orderId),
    SquareError,
  );
  assertEquals(e.status, 404);
  // a location that is not the seller's is refused
  const bad = await assertRejects(
    () =>
      gw.createPaymentLink("EAAAfake_acme", "sandbox", {
        ...input,
        idempotencyKey: "k2",
        locationId: "LFAKE_other_main",
      }),
    SquareError,
  );
  assertEquals(bad.status, 400);
});

Deno.test("REQ-803 square-gateway real — the environment is the host that accepts the token: production first, sandbox when production says 401; the headers carry the token and the Square-Version", async () => {
  const gw = gateway();
  // production accepts
  await withFetch(
    (c) =>
      c.url.startsWith("https://connect.squareup.com/")
        ? json(200, {
          locations: [{
            id: "L1",
            name: "Main St",
            business_name: "Acme Roofing LLC",
            status: "ACTIVE",
            currency: "USD",
            merchant_id: "M1",
          }],
        })
        : json(500, {}),
    async (calls) => {
      const r = await gw.locations(TOKEN);
      assertEquals(r.environment, "production");
      assertEquals(r.locations, [{
        id: "L1",
        name: "Main St",
        businessName: "Acme Roofing LLC",
        status: "ACTIVE",
        currency: "USD",
        merchantId: "M1",
      }]);
      assertEquals(calls.length, 1);
      assertEquals(calls[0].url, "https://connect.squareup.com/v2/locations");
      assertEquals(calls[0].headers["authorization"], `Bearer ${TOKEN}`);
      assertEquals(calls[0].headers["square-version"], "2025-01-23");
    },
  );
  // production says 401, sandbox accepts
  await withFetch(
    (c) =>
      c.url.startsWith("https://connect.squareup.com/")
        ? json(401, {
          errors: [{
            category: "AUTHENTICATION_ERROR",
            code: "UNAUTHORIZED",
            detail: "This request could not be authorized.",
          }],
        })
        : json(200, {
          locations: [{
            id: "LS",
            name: "Default Test Account",
            status: "ACTIVE",
            currency: "USD",
          }],
        }),
    async (calls) => {
      const r = await gw.locations(TOKEN);
      assertEquals(r.environment, "sandbox");
      assertEquals(calls.map((c) => c.url), [
        "https://connect.squareup.com/v2/locations",
        "https://connect.squareupsandbox.com/v2/locations",
      ]);
    },
  );
  // neither accepts: Square's own words
  await withFetch(
    () =>
      json(401, {
        errors: [{
          category: "AUTHENTICATION_ERROR",
          code: "UNAUTHORIZED",
          detail: "This request could not be authorized.",
        }],
      }),
    async () => {
      const e = await assertRejects(() => gw.locations(TOKEN), SquareError);
      assertEquals([e.status, e.code], [401, "UNAUTHORIZED"]);
      assertStringIncludes(e.message, "could not be authorized");
    },
  );
});

Deno.test("REQ-803 square-gateway real — the payment link is quick_pay for the exact amount on the location, with the redirect; the order is read back on the same host", async () => {
  const gw = gateway();
  await withFetch(
    (c) =>
      c.method === "POST"
        ? json(200, {
          payment_link: {
            id: "PL1",
            version: 1,
            url: "https://square.link/u/abc",
            long_url: "https://checkout.square.site/merchant/M1/checkout/PL1",
            order_id: "ORD1",
          },
        })
        : json(200, {
          order: {
            id: "ORD1",
            state: "COMPLETED",
            total_money: { amount: 6500, currency: "USD" },
            tenders: [{
              id: "T1",
              type: "CARD",
              payment_id: "PAY1",
              amount_money: { amount: 6500, currency: "USD" },
            }],
          },
        }),
    async (calls) => {
      const link = await gw.createPaymentLink(TOKEN, "sandbox", {
        idempotencyKey: "inv1:1:6500:x",
        name: "Invoice INV-001 · Acme Roofing",
        amountCents: 6500,
        currency: "USD",
        locationId: "L1",
        redirectUrl: "https://documonster.com/i/inv1?square=return",
        note: "INV-001",
      });
      assertEquals(link, {
        id: "PL1",
        url: "https://square.link/u/abc",
        orderId: "ORD1",
      });
      assertEquals(
        calls[0].url,
        "https://connect.squareupsandbox.com/v2/online-checkout/payment-links",
      );
      assertEquals(calls[0].headers["content-type"], "application/json");
      assertEquals(calls[0].body, {
        idempotency_key: "inv1:1:6500:x",
        quick_pay: {
          name: "Invoice INV-001 · Acme Roofing",
          price_money: { amount: 6500, currency: "USD" },
          location_id: "L1",
        },
        checkout_options: {
          redirect_url: "https://documonster.com/i/inv1?square=return",
        },
        payment_note: "INV-001",
      });
      const order = await gw.retrieveOrder(TOKEN, "sandbox", "ORD1");
      assertEquals(
        calls[1].url,
        "https://connect.squareupsandbox.com/v2/orders/ORD1",
      );
      assertEquals(order.state, "COMPLETED");
      assertEquals(order.tenders?.[0]?.payment_id, "PAY1");
    },
  );
});
