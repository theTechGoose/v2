/**
 * REQ-803 — the fake Square checkout page is a dev-only route: off the real deploy it names
 * what is being paid and the amount, Pay completes the fake order and heads back to the
 * invoice, Cancel heads back unpaid; on the real deploy every one of its routes is a 404
 * (exactly like dev-stripe-controller). The switch is read from the controller's own `env`.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import type { ExecutionContext } from "#danet/core";
import type { EnvReader } from "@core/business/real-deploy/mod.ts";
import {
  fakeSquareWorld,
  SquareGateway,
} from "@core/data/square-gateway/mod.ts";
import { DevSquareController } from "./mod.ts";

const OFF: EnvReader = { get: () => undefined };
const ON: EnvReader = { get: (k) => (k === "DENO_DEPLOY" ? "1" : undefined) };
const ctx = {
  json: (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status }),
} as unknown as ExecutionContext;

function controller(env: EnvReader) {
  const c = new DevSquareController();
  c.env = env;
  return c;
}

async function mkLink(key: string) {
  const gw = new SquareGateway();
  gw.env = OFF;
  return await gw.createPaymentLink("EAAAfake_acme", "sandbox", {
    idempotencyKey: key,
    name: "Invoice INV-009 · Acme Roofing",
    amountCents: 12345,
    currency: "USD",
    locationId: "LFAKE_acme_main",
    redirectUrl: "http://localhost:1/i/x?square=return",
  });
}

Deno.test("REQ-803 /dev/square — off the real deploy: the page, Pay completes the fake order and goes back, Cancel goes back unpaid", async () => {
  fakeSquareWorld().reset();
  const link = await mkLink("dev-ctl-1");
  const c = controller(OFF);
  const page = c.page(ctx, link.id);
  assertEquals(page.status, 200);
  const html = await page.text();
  assertStringIncludes(html, "Invoice INV-009 · Acme Roofing");
  assertStringIncludes(html, "$123.45");

  const cancel = c.cancel(ctx, link.id);
  assertStringIncludes(
    await cancel.text(),
    "http://localhost:1/i/x?square=return",
  );
  assertEquals(
    fakeSquareWorld().orders.get(link.orderId)!.state,
    "OPEN",
    "cancel pays nothing",
  );

  const pay = c.pay(ctx, link.id);
  assertStringIncludes(
    await pay.text(),
    "http://localhost:1/i/x?square=return",
  );
  assertEquals(fakeSquareWorld().orders.get(link.orderId)!.state, "COMPLETED");

  const missing = c.page(ctx, "sqlink_nope");
  assertEquals(missing.status, 404);
  await missing.body?.cancel();
});

Deno.test("REQ-803 /dev/square — on the real deploy none of it exists (404), and nothing is paid", async () => {
  fakeSquareWorld().reset();
  const link = await mkLink("dev-ctl-2");
  const c = controller(ON);
  for (
    const r of [
      c.page(ctx, link.id),
      c.pay(ctx, link.id),
      c.cancel(ctx, link.id),
    ]
  ) {
    assertEquals(r.status, 404);
    await r.body?.cancel();
  }
  assert(fakeSquareWorld().orders.get(link.orderId)!.state === "OPEN");
});
